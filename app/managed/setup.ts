// One-time setup (and re-run after changing agents.ts): environment, the four agents, the notebook files.
// Agents are updated in place, so every change is a new version, not a new agent.
// Ids go to managed/.state.json (gitignored). Run: npm run managed:setup

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { notebook } from "../server/notebook.ts";
import { COORDINATOR, SUBAGENTS, agentBody, type AgentSpec } from "./agents.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = join(HERE, ".state.json");
const ENV_NAME = "common-bench";

export interface ManagedState {
  environment_id: string;
  agents: Record<AgentSpec["key"], { id: string; version: number }>;
  files: { name: string; sha: string; file_id: string }[];
}

export function loadState(): ManagedState {
  if (!existsSync(STATE_PATH)) throw new Error("No managed/.state.json. Run `npm run managed:setup` first.");
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

// ---------- the notebook as files the analyst can script against ----------

const csv = (rows: Record<string, unknown>[]) => {
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
};

export function notebookFiles(): { name: string; body: string }[] {
  const trials = notebook.trials.map((t) => ({
    id: t.id,
    date: t.date,
    owner: t.owners.join("+"),
    campaign: t.campaign,
    parent: t.parent,
    ...t.inputs,
    viscosity_pa_s: t.outputs.viscosity_pa_s,
    porosity_pct: t.outputs.porosity_pct,
    uts_mpa: t.outputs.uts_mpa,
    elongation_pct: t.outputs.elongation_pct,
    fracture: t.outputs.fracture,
    flex_strength_mpa: t.outputs.flex_strength_mpa,
    flex_modulus_mpa: t.outputs.flex_modulus_mpa,
    viability_pct: t.outputs.viability_pct,
    tensile_pass: t.guardrails.tensile,
    bend_pass: t.guardrails.bend,
    porosity_pass: t.guardrails.porosity,
    cytotox_pass: t.guardrails.cytotox,
    pass_all: t.pass_all,
    meets_objective: t.meets_objective,
    excluded: t.excluded,
    excluded_reason: t.excluded_reason ?? "",
  }));
  const logs = notebook.trials.flatMap((t) =>
    t.log.map((e) => ({
      trial_id: t.id,
      id: e.id,
      t: e.t,
      step: e.step,
      device: e.device,
      source: e.source,
      actor: e.actor,
      event: e.event,
      value: e.value ?? "",
      unit: e.unit ?? "",
      backfilled: e.backfilled ?? false,
    })),
  );
  const g = notebook.project.guardrails.map((x) => `- ${x.label}: ${x.plain}; ${x.checks.map((c) => `${c.metric} ${c.op} ${c.threshold} ${c.unit}`).join(", ")}`);
  const readme = [
    `# ${notebook.project.name} (synthetic data)`,
    `Objective: ${notebook.project.objective.label}. Guardrails:`,
    ...g,
    "",
    "## trials.csv",
    "One row per trial. Inputs: diluent_wt and photoinit_wt (wt %), degas_min (0 = not degassed), rest_h (hours between mixing and printing), mix_rpm, mix_min, postcure_min.",
    "Outputs: viscosity_pa_s, porosity_pct, uts_mpa (tensile), flex_strength_mpa and flex_modulus_mpa (3-pt bend), viability_pct (cells alive). *_pass columns are the guardrails.",
    "excluded = the owner left the trial out of their conclusions; excluded_reason is their reason.",
    "",
    "## logs.csv",
    "One row per logged event. source: mhs (device driver), worksheet (logged by hand), manual. actor: a person id or device. backfilled = imported later from instrument exports.",
    "A step missing from a trial's log was not done (e.g. no degas rows = not degassed).",
    "",
    "## ledger.json",
    "Team findings, dead ends and open questions with owner, evidence ids and status.",
  ].join("\n");
  return [
    { name: "trials.csv", body: csv(trials) },
    { name: "logs.csv", body: csv(logs) },
    { name: "ledger.json", body: JSON.stringify(notebook.ledger, null, 2) },
    { name: "README.md", body: readme + "\n" },
  ];
}

// ---------- setup ----------

async function main() {
  const client = new Anthropic();
  const prev: Partial<ManagedState> = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};

  // Environment: reuse by name. Limited networking with nothing allowed: the agents only need the mounted files.
  let envId = prev.environment_id;
  if (!envId) {
    for await (const e of client.beta.environments.list()) if (e.name === ENV_NAME) envId = e.id;
  }
  if (!envId) {
    const env = await client.beta.environments.create({ name: ENV_NAME, config: { type: "cloud", networking: { type: "limited" } } });
    envId = env.id;
    console.log(`created environment ${envId}`);
  } else console.log(`environment ${envId}`);

  // Files: upload only what changed.
  const files: ManagedState["files"] = [];
  for (const f of notebookFiles()) {
    const sha = createHash("sha256").update(f.body).digest("hex").slice(0, 16);
    const had = prev.files?.find((p) => p.name === f.name && p.sha === sha);
    if (had) {
      files.push(had);
      continue;
    }
    const up = await client.files.upload({ file: await toFile(Buffer.from(f.body), f.name) });
    files.push({ name: f.name, sha, file_id: up.id });
    console.log(`uploaded ${f.name} → ${up.id}`);
  }

  // Agents: subagents first (the coordinator's roster references them), update in place when they exist.
  const agents = {} as ManagedState["agents"];
  const upsert = async (spec: AgentSpec, roster?: string[]) => {
    const body = agentBody(spec, roster);
    const existing = prev.agents?.[spec.key];
    const a = existing
      ? await client.beta.agents.update(existing.id, { ...body, version: existing.version } as never)
      : await client.beta.agents.create(body as never);
    agents[spec.key] = { id: a.id, version: a.version };
    console.log(`${existing ? "updated" : "created"} ${spec.name} ${a.id} v${a.version}`);
  };
  for (const s of SUBAGENTS) await upsert(s);
  await upsert(COORDINATOR, SUBAGENTS.map((s) => agents[s.key].id));

  writeFileSync(STATE_PATH, JSON.stringify({ environment_id: envId, agents, files } satisfies ManagedState, null, 2) + "\n");
  console.log(`wrote ${STATE_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
