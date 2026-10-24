// System prompt for the notebook agent: project facts (generated from notebook.json),
// the lab-notebook-analyst Skill, and the harness protocol.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PersonId } from "../src/shared/types.ts";
import { nextTrialId, notebook, person } from "./notebook.ts";

export const SKILL_PATH = fileURLToPath(new URL("../skills/lab-notebook-analyst/SKILL.md", import.meta.url));

/** The Skill body without its YAML frontmatter. */
export function skillBody(): string {
  return readFileSync(SKILL_PATH, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

/** Where the team's own map (fitted from included trials) puts the pass/fail wall. */
function teamWall(): string {
  const walls = notebook.landscape.lenses.team.boundary.map((b) => b.diluent).filter((d): d is number => d !== null);
  if (!walls.length) return "";
  const w = walls.sort((a, b) => a - b)[walls.length >> 1];
  return `The team's search map, fitted from the trials the team included, shows a pass/fail wall (the "barrier") at about ${w}% diluent.`;
}

function projectFacts(): string {
  const p = notebook.project;
  const o = p.objective;
  const guard = p.guardrails
    .map((g) => `- ${g.label}: ${g.checks.map((c) => `${c.metric} ${c.op} ${c.threshold} ${c.unit}`).join(" and ")} (${g.plain.toLowerCase()})`)
    .join("\n");
  const people = notebook.people
    .map((x) => `- ${x.name} (id ${x.id}): ${x.role}; joined ${x.joined}${x.left ? `, left ${x.left}` : ""}`)
    .join("\n");
  const sop = p.sop.stations
    .map((s) => `${s.label}${s.in_sop ? "" : " (not in SOP " + p.sop.version + ")"} [${s.device}, ${s.source === "mhs" ? "device-logged" : s.source}]`)
    .join(" → ");
  return [
    `Project: ${p.name}. ${p.synthetic_label}. Today is ${p.now.slice(0, 10)}.`,
    `Objective: ${o.label} (from about ${o.baseline}). ${o.why}`,
    `Guardrails (all must pass):\n${guard}`,
    `People:\n${people}`,
    `Process stations: ${sop}`,
    `Trials T01–T${String(notebook.trials.length).padStart(2, "0")}. Log ids look like T09-L07; ledger ids like L2.`,
    teamWall(),
  ].join("\n\n");
}

const PROTOCOL = `How this session works
- First turn: finish the investigation with the read tools, then write your answer once, as your final message. Don't write text before or between tool calls; nobody sees it. Never stop to offer a check; do it.
- The screen streams your final message and turns each [id] into a link. Bracket every existing id every time: [T08], [T09-L07], [L2]. A bare id or a markdown link is a broken citation.
- Lookups and aggregations: answer briefly and stop. Only decision questions ("has anyone tried…", "should I…", "what next") get a proposed experiment and ledger change, described in the answer.
- Don't call propose_ledger_update or draft_trial in the first turn. If your answer proposed something, you'll then be asked to file it: one propose_ledger_update call with all ledger changes and one draft_trial call, issued together, matching your answer exactly. A person approves or rejects each card.
- Decision answers follow the Skill's "Shape of a decision answer": one sentence, one three-column evidence table, then lines starting "Hypothesis:", "Uncertain:" and "Proposal:". No headings, no bold, no bullet lists, no other tables.`;

/** Static part first (cacheable across runs), then the per-run part. */
export function buildSystemPrompt(asker: PersonId): { static: string; dynamic: string } {
  const who = person(asker);
  return {
    static: [
      "You are the notebook analyst for a lab team's shared project workspace. You answer questions about the team's trials using only the notebook tools.",
      projectFacts(),
      skillBody(),
      PROTOCOL,
    ].join("\n\n"),
    dynamic:
      `The person asking is ${who.name} (id ${asker}, ${who.status} member). Address them as "you"; credit their work by name where it matters. ` +
      `The next free trial id is ${nextTrialId()}.`,
  };
}

export const FILE_PROPOSALS_PROMPT =
  "File the proposals from your answer now: one propose_ledger_update call with every ledger change and one draft_trial call, " +
  "issued together, matching your answer exactly (same recipes, owners and wording). Skip any kind you didn't propose. " +
  "If your answer proposed nothing, reply with just: NONE. After the tools return, reply with one short line.";
