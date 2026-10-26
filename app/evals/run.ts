// Eval runner: three configs over evals/questions.json.
//   A  whole notebook in context, claude-sonnet-5-5, Messages API
//   B  agent + tools (server/agent.ts runAgent), claude-sonnet-5-5
//   C  agent + tools, claude-haiku-5-5
//
// Run:  npx tsx --env-file-if-exists=.env.local evals/run.ts [--config A,B,C] [--only q01,q05] [--concurrency 3]
// Writes evals/raw/<config>.json (full transcripts + grades), evals/results.json (EvalResults), evals/RESULTS.md.
// Re-running with --only merges into the existing raw files, so one question can be re-run without paying for the rest.

import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { EvalConfigResult, EvalQuestionResult, EvalResults, Notebook } from "../src/shared/types.ts";
import type { EvalQuestion } from "./build-questions.ts";
import { buildLegitNumbers, buildValidIds, grade, judgeHero, type Grade, type JudgeVerdict } from "./graders.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const nb: Notebook = JSON.parse(readFileSync(join(appRoot, "data/notebook.json"), "utf8"));
const questions: EvalQuestion[] = JSON.parse(readFileSync(join(here, "questions.json"), "utf8")).questions;

type ConfigId = "A" | "B" | "C";

const CONFIGS: Record<ConfigId, { label: string; model: string }> = {
  A: { label: "Whole notebook in context · Sonnet", model: "claude-sonnet-5-5" },
  B: { label: "Agent + tools · Sonnet", model: "claude-sonnet-5-5" },
  C: { label: "Agent + tools · Haiku", model: "claude-haiku-5-5" },
};

// Published per-MTok prices (claude-api skill, cached 2026-10-06). Cache writes are 5-minute TTL (1.25x input).
const PRICE = {
  "claude-sonnet-5-5": { in: 2.0, out: 10.0, cache_write: 2.5, cache_read: 0.2 },
  // Haiku 5.5 has two rate cards; ≤ 100K-token prompts are $0.10 / $0.50, longer ones $0.50 / $2.50.
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cache_write: 0.125, cache_read: 0.01 },
} as const;

// ---------- args ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.split("=")[1];
}
const configIds = (arg("config") ?? "A,B,C").split(",").map((s) => s.trim().toUpperCase()) as ConfigId[];
const only = arg("only")?.split(",").map((s) => s.trim());
const concurrency = Number(arg("concurrency") ?? 3);
// --regrade: no model calls; re-grade the stored answers in evals/raw with the current graders.
// --rejudge: with --regrade, also re-run the hero judge (a few Haiku calls).
const regrade = process.argv.includes("--regrade");
const rejudge = process.argv.includes("--rejudge");
const selected = only ? questions.filter((q) => only.includes(q.id)) : questions;
if (!selected.length) throw new Error(`no questions match --only ${only}`);

// ---------- raw records ----------

interface RawRecord {
  qid: string;
  config: ConfigId;
  model: string;
  question: string;
  answer: string;
  citations: string[];
  proposals_json: string;
  tool_calls: number | null;
  usage?: Record<string, number>;
  cost_usd: number;
  latency_s: number;
  stop_reason?: string;
  error?: string;
  grade: Grade;
  judge?: JudgeVerdict;
  ran_at: string;
}
interface RawFile {
  config: ConfigId;
  label: string;
  model: string;
  status: "ran" | "not_run";
  status_note?: string;
  records: Record<string, RawRecord>;
}

const rawDir = join(here, "raw");
mkdirSync(rawDir, { recursive: true });
const rawPath = (c: ConfigId) => join(rawDir, `${c}.json`);
function loadRaw(c: ConfigId): RawFile | null {
  return existsSync(rawPath(c)) ? (JSON.parse(readFileSync(rawPath(c), "utf8")) as RawFile) : null;
}

// ---------- shared ----------

const client = new Anthropic();
const validIds = buildValidIds(nb);
const legit = buildLegitNumbers(nb);
let judgeSpend = 0;

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function finishRecord(q: EvalQuestion, partial: Omit<RawRecord, "grade" | "judge" | "ran_at">): Promise<RawRecord> {
  const g = grade({ q, answer: partial.answer, citations: partial.citations, proposalsJson: partial.proposals_json }, { validIds, legit });
  let judge: JudgeVerdict | undefined;
  if (q.category === "hero" && partial.answer) {
    judge = await judgeHero(client, q.question, partial.answer, partial.proposals_json);
    judgeSpend += judge.cost_usd;
  }
  const rec: RawRecord = { ...partial, grade: g, judge, ran_at: new Date().toISOString() };
  const mark = g.correct ? "ok  " : "FAIL";
  console.log(`  ${partial.config} ${q.id} ${mark} $${partial.cost_usd.toFixed(4)} ${partial.latency_s.toFixed(1)}s${g.diagnosis ? "  " + g.diagnosis : ""}${judge ? `  judge ${judge.score}/4` : ""}`);
  return rec;
}

// ---------- config A: whole notebook in context ----------

// The landscape block (map-lens grids and fitted coefficients for the UI) is left out: it's derived for drawing the map,
// not lab records. Everything a scientist wrote or an instrument logged is in: project, people, trials (with logs,
// curves and pores), and the ledger.
const notebookForContext = JSON.stringify({ meta: nb.meta, project: nb.project, people: nb.people, trials: nb.trials, ledger: nb.ledger });

const SYSTEM_A = `You are the project analyst for a lab team's shared notebook. The team is developing a 3D-printing denture resin. The full project notebook is below as JSON: the objective and guardrails, the people, every trial with its inputs, outputs, notes and instrument log, and the findings ledger.

How to answer:
- Use only the notebook. If it doesn't contain what was asked, say plainly that it's not in the notebook. Don't guess.
- Cite every trial, log entry or ledger item you rely on, inline, in square brackets: [T08], [T09-L05], [L2]. One id per bracket pair is clearest.
- Never state a number that isn't in the notebook or computed directly from it. Show what a computed number was computed from.
- Before blaming the chemistry, check the logs for unintended protocol differences between trials. Gaps between logged steps are data. Revisit excluded outliers.
- Credit the people whose work you build on, by name.
- Say what's uncertain.
- If you propose an experiment, propose the cheapest one that settles the question, with a control arm. You can't write to the notebook; describe any experiment or ledger change as a proposal for a human to approve.
- Lookups and aggregations: answer briefly and stop. Only decision questions ("has anyone tried…", "should I…", "what next") get a proposed experiment and ledger change.
- Decision answers: at most 140 words. Plain text: no headings, no bold, no tables, no lists.

The person asking is Shreya (id shreya, current member). Address them as "you"; credit their work by name where it matters.`;
// Same answer rules, asker and effort as configs B and C (server/prompt.ts, AGENT_EFFORT=medium), so the comparison isolates tools vs. context.

async function runA(q: EvalQuestion): Promise<RawRecord> {
  const model = CONFIGS.A.model;
  const p = PRICE[model as keyof typeof PRICE];
  const t0 = Date.now();
  try {
    const msg = await client.messages
      .stream({
        model,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        system: [
          { type: "text", text: SYSTEM_A },
          { type: "text", text: `<notebook>\n${notebookForContext}\n</notebook>`, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: q.question }],
      })
      .finalMessage();
    const latency_s = (Date.now() - t0) / 1000;
    const u = msg.usage;
    const cache_w = u.cache_creation_input_tokens ?? 0;
    const cache_r = u.cache_read_input_tokens ?? 0;
    const cost_usd = (u.input_tokens * p.in + u.output_tokens * p.out + cache_w * p.cache_write + cache_r * p.cache_read) / 1e6;
    const answer = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
    return finishRecord(q, {
      qid: q.id,
      config: "A",
      model,
      question: q.question,
      answer,
      citations: [],
      proposals_json: "",
      tool_calls: 0,
      usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_creation_input_tokens: cache_w, cache_read_input_tokens: cache_r },
      cost_usd,
      latency_s,
      stop_reason: msg.stop_reason ?? undefined,
      error: msg.stop_reason === "refusal" ? "refusal" : undefined,
    });
  } catch (e) {
    return finishRecord(q, errorPartial(q, "A", model, e, t0));
  }
}

function errorPartial(q: EvalQuestion, config: ConfigId, model: string, e: unknown, t0: number): Omit<RawRecord, "grade" | "judge" | "ran_at"> {
  const msg = e instanceof Anthropic.APIError ? `API ${e.status}: ${e.message}` : String(e);
  return { qid: q.id, config, model, question: q.question, answer: "", citations: [], proposals_json: "", tool_calls: null, cost_usd: 0, latency_s: (Date.now() - t0) / 1000, error: msg };
}

// ---------- configs B and C: the Core agent ----------

type RunAgent = (opts: { question: string; model: string; approvals: "record"; onEvent?: (e: unknown) => void }) => Promise<{
  answer: string;
  citations?: unknown[];
  proposals?: unknown[];
  tool_calls?: unknown;
  cost_usd?: number;
  ms?: number;
  model?: string;
  events?: unknown[];
}>;

async function loadAgent(): Promise<{ runAgent: RunAgent } | { error: string }> {
  // EVAL_AGENT_PATH lets the runner be smoke-tested against a stub agent.
  const p = process.env.EVAL_AGENT_PATH ?? join(appRoot, "server/agent.ts");
  if (!existsSync(p)) return { error: "server/agent.ts doesn't exist yet" };
  try {
    const mod = await import(pathToFileURL(p).href);
    if (typeof mod.runAgent !== "function") return { error: "server/agent.ts has no runAgent export" };
    return { runAgent: mod.runAgent as RunAgent };
  } catch (e) {
    return { error: `importing server/agent.ts threw: ${String(e).slice(0, 300)}` };
  }
}

function citationIds(cs: unknown[] | undefined): string[] {
  if (!cs) return [];
  return cs.map((c) => (typeof c === "string" ? c : (c as { id?: string })?.id ?? "")).filter(Boolean);
}

async function runAgentConfig(config: "B" | "C", runAgent: RunAgent, q: EvalQuestion): Promise<RawRecord> {
  const model = CONFIGS[config].model;
  const t0 = Date.now();
  try {
    const r = await runAgent({ question: q.question, model, approvals: "record" });
    const latency_s = (r.ms ?? Date.now() - t0) / 1000;
    const tc = Array.isArray(r.tool_calls) ? r.tool_calls.length : typeof r.tool_calls === "number" ? r.tool_calls : null;
    return finishRecord(q, {
      qid: q.id,
      config,
      model: r.model ?? model,
      question: q.question,
      answer: r.answer ?? "",
      citations: citationIds(r.citations),
      proposals_json: r.proposals && r.proposals.length ? JSON.stringify(r.proposals) : "",
      tool_calls: tc,
      cost_usd: r.cost_usd ?? 0,
      latency_s,
    });
  } catch (e) {
    return finishRecord(q, errorPartial(q, config, model, e, t0));
  }
}

// ---------- results ----------

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

function summarize(c: ConfigId, raw: RawFile | null): EvalConfigResult {
  const base = CONFIGS[c];
  const recs = raw ? questions.map((q) => raw.records[q.id]).filter(Boolean) : [];
  if (!raw || raw.status === "not_run" || !recs.length) {
    return { id: c, label: `${base.label} (not run)`, model: base.model, n: 0, accuracy: 0, citation_validity: 0, abstention: 0, wrong_numbers: 0, hero_pass: false, cost_per_q_usd: 0, p50_latency_s: 0 };
  }
  const abst = recs.filter((r) => questions.find((q) => q.id === r.qid)!.should_abstain);
  const hero = recs.find((r) => questions.find((q) => q.id === r.qid)!.category === "hero");
  return {
    id: c,
    label: base.label,
    model: base.model,
    n: recs.length,
    accuracy: r3(recs.filter((r) => r.grade.correct).length / recs.length),
    citation_validity: r3(recs.filter((r) => r.grade.citations_valid).length / recs.length),
    abstention: abst.length ? r3(abst.filter((r) => r.grade.abstained && r.grade.correct).length / abst.length) : 0,
    wrong_numbers: recs.reduce((s, r) => s + r.grade.wrong_numbers.length, 0),
    hero_pass: !!hero?.grade.hero?.pass,
    cost_per_q_usd: r4(recs.reduce((s, r) => s + r.cost_usd, 0) / recs.length),
    p50_latency_s: Math.round(median(recs.map((r) => r.latency_s)) * 10) / 10,
  };
}

function perQuestion(raw: RawFile | null): EvalQuestionResult[] {
  if (!raw || raw.status === "not_run") return [];
  return questions
    .map((q) => raw.records[q.id])
    .filter(Boolean)
    .map((r) => {
      const notes = [r.error ? `error: ${r.error}` : "", r.grade.diagnosis, r.judge ? `judge ${r.judge.score}/4` : ""].filter(Boolean).join(" · ");
      return {
        qid: r.qid,
        config: r.config,
        correct: r.grade.correct,
        citations_valid: r.grade.citations_valid,
        abstained: r.grade.abstained,
        cost_usd: r4(r.cost_usd),
        latency_s: Math.round(r.latency_s * 10) / 10,
        ...(notes ? { notes } : {}),
      };
    });
}

function autoNotes(raws: Record<ConfigId, RawFile | null>, configs: EvalConfigResult[]): string[] {
  const notes: string[] = [];
  for (const c of ["A", "B", "C"] as ConfigId[]) {
    const raw = raws[c];
    if (!raw || raw.status === "not_run") notes.push(`Config ${c} (${CONFIGS[c].label}) was not run${raw?.status_note ? `: ${raw.status_note}` : ""}.`);
  }
  for (const c of configs.filter((x) => x.n > 0)) {
    const raw = raws[c.id]!;
    const fails = questions.map((q) => raw.records[q.id]).filter((r) => r && !r.grade.correct).map((r) => r.qid);
    const hero = Object.values(raw.records).find((r) => r.judge);
    const unprompted = questions.map((q) => raw.records[q.id]).filter((r) => r?.grade.unprompted_proposals).map((r) => r.qid);
    notes.push(
      `${c.id}: ${Math.round(c.accuracy * c.n)}/${c.n} correct${fails.length ? ` (missed ${fails.join(", ")})` : ""}; ${c.wrong_numbers} number(s) not traceable to the data; hero ${c.hero_pass ? "passed" : "failed"}${hero?.judge ? `, judge ${hero.judge.score}/4` : ""}${unprompted.length ? `; filed T15/ledger proposals on ${unprompted.length} question(s) that didn't ask for one (${unprompted.join(", ")})` : ""}.`,
    );
  }
  const spend = (["A", "B", "C"] as ConfigId[]).map((c) => {
    const recs = Object.values(raws[c]?.status === "ran" ? raws[c]!.records : {});
    return { c, run: recs.reduce((s, r) => s + r.cost_usd, 0), judge: recs.reduce((s, r) => s + (r.judge?.cost_usd ?? 0), 0) };
  });
  const tot = spend.reduce((s, x) => s + x.run + x.judge, 0);
  notes.push(
    `Spend for the answers on record: ${spend.filter((x) => x.run > 0).map((x) => `${x.c} $${x.run.toFixed(2)}`).join(", ") || "none"}; hero judge $${spend.reduce((s, x) => s + x.judge, 0).toFixed(4)}; total $${tot.toFixed(2)}.`,
  );
  const manualPath = join(here, "notes.json");
  if (existsSync(manualPath)) notes.push(...(JSON.parse(readFileSync(manualPath, "utf8")) as string[]));
  return notes;
}

function writeResults() {
  const raws = { A: loadRaw("A"), B: loadRaw("B"), C: loadRaw("C") } as Record<ConfigId, RawFile | null>;
  const configs = (["A", "B", "C"] as ConfigId[]).map((c) => summarize(c, raws[c]));
  const results: EvalResults = {
    generated_at: new Date().toISOString(),
    question_count: questions.length,
    configs,
    per_question: (["A", "B", "C"] as ConfigId[]).flatMap((c) => perQuestion(raws[c])),
    notes: autoNotes(raws, configs),
  };
  writeFileSync(join(here, "results.json"), JSON.stringify(results, null, 2) + "\n");
  writeFileSync(join(here, "RESULTS.md"), renderMarkdown(results, raws));
  return results;
}

function renderMarkdown(res: EvalResults, raws: Record<ConfigId, RawFile | null>): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const L: string[] = [];
  L.push("# Eval results", "");
  L.push(`Generated ${res.generated_at} · ${res.question_count} questions (\`evals/questions.json\`, built from \`data/notebook.json\` by \`evals/build-questions.ts\`) · n = 1 per question per config.`, "");
  L.push("| Config | Model | n | Accuracy | Citation validity | Abstention | Wrong numbers | Hero pass | Cost / question | p50 latency |");
  L.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const c of res.configs) {
    if (c.n === 0) {
      L.push(`| ${c.id} · ${c.label} | \`${c.model}\` | 0 | – | – | – | – | – | – | – |`);
      continue;
    }
    L.push(
      `| ${c.id} · ${c.label} | \`${c.model}\` | ${c.n} | ${pct(c.accuracy)} | ${pct(c.citation_validity)} | ${raws[c.id] && questions.some((q) => q.should_abstain && raws[c.id]!.records[q.id]) ? pct(c.abstention) : "–"} | ${c.wrong_numbers} | ${c.hero_pass ? "yes" : "no"} | $${c.cost_per_q_usd.toFixed(4)} | ${c.p50_latency_s.toFixed(1)} s |`,
    );
  }
  L.push("");
  L.push("## How it's graded", "");
  L.push("- **Accuracy:** every expected number appears within tolerance and every required concept is named (regex). For abstention questions: the answer says it isn't in the notebook and states no untraceable numbers. For the hero: also names the degassing confound and T09 and proposes a control arm.");
  L.push("- **Citation validity:** share of answers whose bracketed ids (plus structured citations and ids inside proposals) all exist in the notebook (T01–T14, Txx-Lnn, L1–L3; L4/T15* allowed only in the hero) *and* include the question's required evidence ids.");
  L.push("- **Abstention:** share of the two \"not in the notebook\" questions answered that way.");
  L.push("- **Wrong numbers:** numbers with a unit (Pa·s, MPa, %, h, min, $, …) or a decimal point that match no notebook value, simple group statistic, log gap, or code-computed estimate at the precision stated. A lenient heuristic: derived percentages (\"a 30% drop\") can be flagged, and a wrong number that happens to equal some other notebook value is missed. Flagged strings are listed per question below.");
  L.push("- **Hero judge:** `claude-haiku-5-5` with forced tool use scores the proposal on 4 criteria (control arm, cheapest experiment, credit to Shreya, uncertainty stated). Reported, not part of accuracy.");
  L.push("- **Cost:** A from `usage` at published prices (Sonnet 5.5 $2 in / $10 out / $2.50 cache write / $0.20 cache read per MTok; the notebook block is prompt-cached). B and C use `cost_usd` reported by the agent.");
  L.push("");
  L.push("## Per question", "");
  L.push("| Q | Category | " + res.configs.filter((c) => c.n > 0).map((c) => c.id).join(" | ") + " |");
  L.push("|---|---|" + res.configs.filter((c) => c.n > 0).map(() => "---").join("|") + "|");
  for (const q of questions) {
    const cells = res.configs
      .filter((c) => c.n > 0)
      .map((c) => {
        const r = raws[c.id]?.records[q.id];
        if (!r) return "–";
        const parts = [r.grade.correct ? "✓" : "✗", r.grade.citations_valid ? "" : "cite✗", r.grade.wrong_numbers.length ? `#${r.grade.wrong_numbers.length}` : "", r.judge ? `judge ${r.judge.score}/4` : ""].filter(Boolean);
        return parts.join(" ");
      });
    L.push(`| ${q.id} | ${q.category} | ${cells.join(" | ")} |`);
  }
  L.push("");
  L.push("## Failures and flags", "");
  for (const c of res.configs.filter((x) => x.n > 0)) {
    for (const q of questions) {
      const r = raws[c.id]?.records[q.id];
      if (!r) continue;
      if (r.grade.diagnosis || r.error) L.push(`- **${c.id} ${q.id}** (${q.category}): ${[r.error, r.grade.diagnosis].filter(Boolean).join(" · ")}`);
    }
  }
  L.push("");
  const heroRecs = res.configs.filter((c) => c.n > 0).map((c) => raws[c.id]?.records["q14"]).filter((r): r is RawRecord => !!r?.judge);
  if (heroRecs.length) {
    L.push("## Hero judge (claude-haiku-5-5)", "");
    L.push("| Config | Control arm | Cheapest experiment | Credits Shreya | Uncertainty stated | Score |");
    L.push("|---|---|---|---|---|---|");
    for (const r of heroRecs) {
      const j = r.judge!;
      const cell = (x: { pass: boolean; evidence: string }) => `${x.pass ? "✓" : "✗"} ${x.evidence.replace(/\|/g, "/").slice(0, 120)}`;
      L.push(`| ${r.config} | ${cell(j.control_arm)} | ${cell(j.cheapest_experiment)} | ${cell(j.credits_shreya)} | ${cell(j.uncertainty_stated)} | ${j.score}/4 |`);
    }
    L.push("");
  }
  L.push("## Notes", "");
  for (const n of res.notes) L.push(`- ${n}`);
  L.push("");
  return L.join("\n");
}

// ---------- main ----------

async function regradeAll() {
  for (const c of ["A", "B", "C"] as ConfigId[]) {
    const raw = loadRaw(c);
    if (!raw || raw.status !== "ran") continue;
    for (const q of questions) {
      const r = raw.records[q.id];
      if (!r) continue;
      r.grade = grade({ q, answer: r.answer, citations: r.citations, proposalsJson: r.proposals_json }, { validIds, legit });
      if (rejudge && q.category === "hero" && r.answer) {
        r.judge = await judgeHero(client, q.question, r.answer, r.proposals_json);
        judgeSpend += r.judge.cost_usd;
      }
      console.log(`  ${c} ${q.id} ${r.grade.correct ? "ok  " : "FAIL"}${r.grade.diagnosis ? "  " + r.grade.diagnosis : ""}${r.judge ? `  judge ${r.judge.score}/4` : ""}`);
    }
    writeFileSync(rawPath(c), JSON.stringify(raw, null, 2));
  }
}

async function main() {
  if (regrade) {
    await regradeAll();
    const res = writeResults();
    console.log(`judge spend: $${judgeSpend.toFixed(4)}`);
    for (const c of res.configs) console.log(`${c.id} n=${c.n} acc=${c.accuracy} cite=${c.citation_validity} abst=${c.abstention} wrong#=${c.wrong_numbers} hero=${c.hero_pass} $/q=${c.cost_per_q_usd} p50=${c.p50_latency_s}s`);
    return;
  }
  console.log(`questions: ${selected.map((q) => q.id).join(", ")} · configs: ${configIds.join(", ")} · concurrency ${concurrency}`);
  for (const c of configIds) {
    if (!(c in CONFIGS)) throw new Error(`unknown config ${c}`);
    const existing = loadRaw(c);
    const raw: RawFile = existing && existing.status === "ran" ? existing : { config: c, label: CONFIGS[c].label, model: CONFIGS[c].model, status: "ran", records: {} };
    let recs: RawRecord[];
    if (c === "A") {
      console.log(`config A · ${CONFIGS.A.model} · whole notebook in context`);
      // First question alone so the notebook prefix is written to the cache once, then the rest read it.
      const [first, ...rest] = selected;
      recs = [await runA(first), ...(await pool(rest, concurrency, runA))];
    } else {
      const agent = await loadAgent();
      if ("error" in agent) {
        console.log(`config ${c} not run: ${agent.error}`);
        if (!existing || existing.status !== "ran") {
          writeFileSync(rawPath(c), JSON.stringify({ config: c, label: CONFIGS[c].label, model: CONFIGS[c].model, status: "not_run", status_note: agent.error, records: {} } satisfies RawFile, null, 2));
        }
        continue;
      }
      console.log(`config ${c} · ${CONFIGS[c].model} · agent + tools`);
      recs = await pool(selected, concurrency, (q) => runAgentConfig(c as "B" | "C", agent.runAgent, q));
    }
    for (const r of recs) raw.records[r.qid] = r;
    writeFileSync(rawPath(c), JSON.stringify(raw, null, 2));
    const spend = recs.reduce((s, r) => s + r.cost_usd, 0);
    console.log(`config ${c}: spent $${spend.toFixed(4)} this run`);
  }
  // configs never touched get a not_run placeholder so results.json always lists A, B, C
  for (const c of ["A", "B", "C"] as ConfigId[]) {
    if (!loadRaw(c)) writeFileSync(rawPath(c), JSON.stringify({ config: c, label: CONFIGS[c].label, model: CONFIGS[c].model, status: "not_run", status_note: "not requested yet", records: {} } satisfies RawFile, null, 2));
  }
  const res = writeResults();
  console.log(`judge spend this run: $${judgeSpend.toFixed(4)}`);
  console.log("");
  for (const c of res.configs) console.log(`${c.id} n=${c.n} acc=${c.accuracy} cite=${c.citation_validity} abst=${c.abstention} wrong#=${c.wrong_numbers} hero=${c.hero_pass} $/q=${c.cost_per_q_usd} p50=${c.p50_latency_s}s`);
  console.log("wrote evals/results.json, evals/RESULTS.md, evals/raw/*.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
