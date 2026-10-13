// Stress eval runner: configs A, B, C over the stress haystacks at each size.
//   A  whole notebook in context, claude-sonnet-5-5, Messages API (same prompt rules as evals/run.ts config A)
//   B  agent + tools (server/agent.ts runAgent), claude-sonnet-5-5
//   C  agent + tools, claude-haiku-5-5
//
// The Core agent reads its notebook once at import, from NOTEBOOK_PATH (server/notebook.ts). So each size runs
// in its own child process with NOTEBOOK_PATH set; with several sizes, this script spawns itself once per size.
//
// Run (from app/):
//   npx tsx --env-file-if-exists=.env.local evals/stress/run-stress.ts --sizes 50,250,1000 [--config A,B,C] [--only s01,s05]
//        [--concurrency 3] [--max-spend 10]
//   npx tsx evals/stress/run-stress.ts --report      # rebuild RESULTS.md / results.json from evals/stress/raw, no API calls
//   npx tsx evals/stress/run-stress.ts --regrade     # re-grade stored answers with the current grader, then report
//
// Writes evals/stress/raw/<size>-<config>.json (answers, traces, grades), evals/stress/results.json, evals/stress/RESULTS.md.

import Anthropic from "@anthropic-ai/sdk";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Notebook } from "../../src/shared/types.ts";
import { buildStressValidIds, gradeStress, type StressGrade } from "./grade-stress.ts";
import { CATEGORIES, type StressCategory, type StressQuestion } from "./questions.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "../..");
const rawDir = join(here, "raw");
mkdirSync(rawDir, { recursive: true });

type ConfigId = "A" | "B" | "C";
const CONFIGS: Record<ConfigId, { label: string; model: string }> = {
  A: { label: "Whole notebook in context · Sonnet", model: "claude-sonnet-5-5" },
  B: { label: "Agent + tools · Sonnet", model: "claude-sonnet-5-5" },
  C: { label: "Agent + tools · Haiku", model: "claude-haiku-5-5" },
};
// Published per-MTok prices (claude-api skill, cached 2026-10-06). Cache writes are 5-minute TTL.
const SONNET = { in: 2.0, out: 10.0, cache_write: 2.5, cache_read: 0.2 };
const A_CONTEXT_LIMIT = 1_000_000; // Sonnet 5.5 context window
const A_HEADROOM = 20_000; // room for the question and the answer
const A_MAX_COST_PER_Q = 1.5;
// The 15 questions run in every cell the budget allowed (all six categories), for like-for-like comparison.
const CORE = [
  "needle_overnight_rest", "needle_postcure_gap", "needle_print_restart",
  "agg_mean_viscosity", "agg_per_person_counts", "agg_whitford_uts", "agg_mixer2_count", "agg_highdil_uts",
  "hop_restart_parent", "hop_best_parent",
  "contra_ines_target", "contra_find_all",
  "abstain_whitfield_44",
  "confound_winter_mixer", "confound_prewarm",
];

// ---------- args ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}
const flag = (n: string) => process.argv.includes(`--${n}`);
const configIds = (arg("config") ?? "A,B,C").split(",").map((s) => s.trim().toUpperCase()) as ConfigId[];
const only = arg("only")?.split(",").map((s) => s.trim());
const concurrency = Number(arg("concurrency") ?? 3);
const maxSpend = Number(arg("max-spend") ?? 10);
// Per-question budget for the agent configs (Agent SDK maxBudgetUsd via AGENT_MAX_BUDGET_USD). A run that hits it
// stops with error_max_budget_usd and is graded on whatever answer it produced (usually none).
const CAP: Record<"B" | "C", number> = { B: Number(arg("cap-b") ?? 0.3), C: Number(arg("cap-c") ?? 0.1) };

// ---------- raw records ----------

interface TraceLite {
  tool: string;
  input: unknown;
  status: string;
  summary: string;
}
interface RawRecord {
  qid: string;
  template: string;
  category: StressCategory;
  config: ConfigId;
  model: string;
  question: string;
  answer: string;
  tool_calls: number | null;
  trace?: TraceLite[];
  usage?: Record<string, number>;
  cost_usd: number;
  latency_s: number;
  stop_reason?: string;
  error?: string;
  grade: StressGrade;
  ran_at: string;
}
interface RawFile {
  size: number;
  config: ConfigId;
  label: string;
  model: string;
  status: "ran" | "doesnt_fit" | "skipped_cost" | "not_run";
  status_note?: string;
  context_tokens?: number;
  records: Record<string, RawRecord>;
}
const rawPath = (size: number, c: ConfigId) => join(rawDir, `${size}-${c}.json`);
const loadRaw = (size: number, c: ConfigId): RawFile | null => (existsSync(rawPath(size, c)) ? JSON.parse(readFileSync(rawPath(size, c), "utf8")) : null);
const saveRaw = (f: RawFile) => writeFileSync(rawPath(f.size, f.config), JSON.stringify(f, null, 1));

function sizesOnDisk(): number[] {
  return readdirSync(here)
    .map((f) => /^questions-(\d+)\.json$/.exec(f)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
    .sort((a, b) => a - b);
}
const loadQuestions = (size: number): StressQuestion[] => JSON.parse(readFileSync(join(here, `questions-${size}.json`), "utf8")).questions;
const notebookPath = (size: number) => join(here, "data", `notebook-${size}.json`);

function totalSpend(): number {
  let s = 0;
  for (const f of readdirSync(rawDir)) {
    if (!f.endsWith(".json")) continue;
    const raw: RawFile = JSON.parse(readFileSync(join(rawDir, f), "utf8"));
    for (const r of Object.values(raw.records)) s += r.cost_usd;
  }
  return s;
}

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

// ---------- one size (runs in its own process) ----------

async function runSize(size: number) {
  const nbFile = notebookPath(size);
  if (!existsSync(nbFile)) throw new Error(`missing ${nbFile}; run evals/stress/generate-haystack.ts first`);
  // Must be set before server/agent.ts (and so server/notebook.ts) is imported.
  process.env.NOTEBOOK_PATH = nbFile;
  const nb: Notebook = JSON.parse(readFileSync(nbFile, "utf8"));
  const questions = loadQuestions(size);
  const selected = only ? questions.filter((q) => only.includes(q.id) || only.includes(q.template)) : questions;
  if (!selected.length) throw new Error(`no questions match --only ${only}`);
  const validIds = buildStressValidIds(nb);
  const client = new Anthropic();
  const spentBefore = totalSpend();
  let spentNow = 0;
  const overBudget = () => spentBefore + spentNow > maxSpend;
  console.log(`size ${size}: ${selected.length} questions · configs ${configIds.join(",")} · spend so far $${spentBefore.toFixed(2)} (cap $${maxSpend})`);

  const finish = (q: StressQuestion, p: Omit<RawRecord, "grade" | "ran_at" | "qid" | "template" | "category" | "question">): RawRecord => {
    const grade = gradeStress(q, p.answer, validIds);
    spentNow += p.cost_usd;
    console.log(
      `  ${size} ${p.config} ${q.id} ${q.category.padEnd(13)} ${grade.correct ? "ok  " : "FAIL"} $${p.cost_usd.toFixed(4)} ${p.latency_s.toFixed(1)}s` +
        `${p.tool_calls !== null ? ` tools=${p.tool_calls}` : ""}${p.error ? `  ERR ${p.error.slice(0, 120)}` : ""}${grade.diagnosis ? "  " + grade.diagnosis.slice(0, 220) : ""}`,
    );
    return { qid: q.id, template: q.template, category: q.category, question: q.question, ...p, grade, ran_at: new Date().toISOString() };
  };

  for (const c of configIds) {
    const existing = loadRaw(size, c);
    const raw: RawFile =
      existing && existing.status === "ran" ? existing : { size, config: c, label: CONFIGS[c].label, model: CONFIGS[c].model, status: "ran", records: {} };

    if (c === "A") {
      const ctx = JSON.stringify({ meta: nb.meta, project: nb.project, people: nb.people, trials: nb.trials, ledger: nb.ledger });
      const system: Anthropic.TextBlockParam[] = [
        { type: "text", text: SYSTEM_A },
        { type: "text", text: `<notebook>\n${ctx}\n</notebook>`, cache_control: { type: "ephemeral" } },
      ];
      const tokens = await countTokens(client, system, ctx.length);
      const n = selected.length;
      const estPerQ = (tokens * SONNET.cache_write + (n - 1) * tokens * SONNET.cache_read) / 1e6 / n + 0.01;
      raw.context_tokens = tokens;
      console.log(`config A · context ${tokens.toLocaleString()} tokens · est $${estPerQ.toFixed(3)}/question`);
      if (tokens + A_HEADROOM > A_CONTEXT_LIMIT) {
        saveRaw({ ...raw, status: "doesnt_fit", status_note: `${tokens.toLocaleString()} tokens > ${A_CONTEXT_LIMIT.toLocaleString()}-token context window`, records: {} });
        console.log(`config A: doesn't fit`);
        continue;
      }
      if (estPerQ > A_MAX_COST_PER_Q) {
        saveRaw({ ...raw, status: "skipped_cost", status_note: `est $${estPerQ.toFixed(2)}/question > $${A_MAX_COST_PER_Q}`, records: {} });
        continue;
      }
      const runOne = async (q: StressQuestion): Promise<RawRecord | null> => {
        if (overBudget()) return null;
        const t0 = Date.now();
        try {
          const msg = await client.messages
            .stream({ model: CONFIGS.A.model, max_tokens: 16000, output_config: { effort: "medium" }, system, messages: [{ role: "user", content: q.question }] })
            .finalMessage();
          const u = msg.usage;
          const cw = u.cache_creation_input_tokens ?? 0;
          const cr = u.cache_read_input_tokens ?? 0;
          const cost = (u.input_tokens * SONNET.in + u.output_tokens * SONNET.out + cw * SONNET.cache_write + cr * SONNET.cache_read) / 1e6;
          const answer = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
          return finish(q, {
            config: "A",
            model: CONFIGS.A.model,
            answer,
            tool_calls: 0,
            usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_creation_input_tokens: cw, cache_read_input_tokens: cr },
            cost_usd: cost,
            latency_s: (Date.now() - t0) / 1000,
            stop_reason: msg.stop_reason ?? undefined,
          });
        } catch (e) {
          return finish(q, { config: "A", model: CONFIGS.A.model, answer: "", tool_calls: 0, cost_usd: 0, latency_s: (Date.now() - t0) / 1000, error: errText(e) });
        }
      };
      // first question alone so the notebook is written to the cache once; the rest read it
      const [first, ...rest] = selected;
      const recs = [await runOne(first), ...(await pool(rest, concurrency, runOne))];
      for (const r of recs) if (r) raw.records[r.qid] = r;
      saveRaw(raw);
    } else {
      const agentMod = await import(pathToFileURL(join(appRoot, "server/agent.ts")).href);
      const loaded: Notebook = (await import(pathToFileURL(join(appRoot, "server/notebook.ts")).href)).notebook;
      if (loaded.trials.length !== size) throw new Error(`agent loaded ${loaded.trials.length} trials, expected ${size} (NOTEBOOK_PATH not honored?)`);
      process.env.AGENT_MAX_BUDGET_USD = String(CAP[c as "B" | "C"]);
      console.log(`config ${c} · per-question cap $${CAP[c as "B" | "C"]}`);
      const runOne = async (q: StressQuestion): Promise<RawRecord | null> => {
        if (overBudget()) return null;
        const t0 = Date.now();
        try {
          const r = await agentMod.runAgent({ question: q.question, model: CONFIGS[c].model, approvals: "record" });
          const trace = new Map<string, TraceLite>();
          for (const e of r.events as { type: string; step?: { id: string; tool?: string; input?: unknown; status: string; summary?: string } }[]) {
            if (e.type === "trace" && e.step) trace.set(e.step.id, { tool: e.step.tool ?? "", input: e.step.input, status: e.step.status, summary: (e.step.summary ?? "").slice(0, 300) });
          }
          const errEv = (r.events as { type: string; message?: string }[]).find((e) => e.type === "error");
          return finish(q, {
            config: c,
            model: r.model ?? CONFIGS[c].model,
            answer: r.answer ?? "",
            tool_calls: Array.isArray(r.tool_calls) ? r.tool_calls.length : null,
            trace: [...trace.values()],
            cost_usd: r.cost_usd ?? 0,
            latency_s: (r.ms ?? Date.now() - t0) / 1000,
            error: errEv?.message,
          });
        } catch (e) {
          // A run stopped by maxBudgetUsd throws before reporting its cost; book the cap so the spend total stays honest.
          const capped = /maximum budget/i.test(errText(e));
          return finish(q, { config: c, model: CONFIGS[c].model, answer: "", tool_calls: null, cost_usd: capped ? CAP[c as "B" | "C"] : 0, latency_s: (Date.now() - t0) / 1000, error: capped ? `stopped at the $${CAP[c as "B" | "C"]} per-question budget before answering` : errText(e) });
        }
      };
      const recs = await pool(selected, concurrency, runOne);
      for (const r of recs) if (r) raw.records[r.qid] = r;
      raw.status_note = `per-question budget $${CAP[c as "B" | "C"]} (Agent SDK maxBudgetUsd)`;
      saveRaw(raw);
    }
    console.log(`size ${size} config ${c}: spent $${spentNow.toFixed(3)} so far this run · total $${(spentBefore + spentNow).toFixed(2)}`);
    if (overBudget()) {
      console.log(`spend cap $${maxSpend} reached; stopping`);
      break;
    }
  }
}

function errText(e: unknown): string {
  return e instanceof Anthropic.APIError ? `API ${e.status}: ${e.message}` : String(e instanceof Error ? e.message : e);
}

async function countTokens(client: Anthropic, system: Anthropic.TextBlockParam[], chars: number): Promise<number> {
  try {
    const r = await client.messages.countTokens({ model: CONFIGS.A.model, system, messages: [{ role: "user", content: "?" }] });
    return r.input_tokens;
  } catch (e) {
    // Too big to count: estimate from the chars-per-token ratio measured on the 50-trial notebook.
    const ref = loadRaw(50, "A")?.context_tokens;
    const refChars = existsSync(notebookPath(50)) ? JSON.stringify(pickCtx(JSON.parse(readFileSync(notebookPath(50), "utf8")))).length : 0;
    const ratio = ref && refChars ? refChars / ref : 1.9;
    console.log(`  count_tokens failed (${errText(e).slice(0, 100)}); estimating at ${ratio.toFixed(2)} chars/token`);
    return Math.round(chars / ratio);
  }
}
const pickCtx = (nb: Notebook) => ({ meta: nb.meta, project: nb.project, people: nb.people, trials: nb.trials, ledger: nb.ledger });

// Same answer rules, asker and effort as evals/run.ts config A (and the agent's prompt), so the comparison isolates tools vs. context.
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

The person asking is Greeshma N. (id greeshma, current member). Address them as "you"; credit their work by name where it matters.`;

// ---------- report ----------

interface Cell {
  size: number;
  config: ConfigId;
  status: RawFile["status"];
  note?: string;
  context_tokens?: number;
  n: number;
  accuracy: number;
  citation_validity: number;
  abstention: string; // "k/n"
  wrong_numbers: number;
  wrong_answers: number; // failed with a confident, unhedged answer
  declined: number; // failed safely: said it couldn't answer, or a hedged partial answer
  core: { n: number; correct: number }; // the 15 core questions (same set in every cell where run)
  cost_per_q_usd: number;
  p50_latency_s: number;
  tool_calls_per_q: number | null;
  by_category: Record<string, { n: number; correct: number }>;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

function regradeAll() {
  for (const size of sizesOnDisk()) {
    const nb: Notebook = JSON.parse(readFileSync(notebookPath(size), "utf8"));
    const ids = buildStressValidIds(nb);
    const qs = new Map(loadQuestions(size).map((q) => [q.id, q]));
    for (const c of ["A", "B", "C"] as ConfigId[]) {
      const raw = loadRaw(size, c);
      if (!raw) continue;
      for (const r of Object.values(raw.records)) {
        const q = qs.get(r.qid);
        if (q) r.grade = gradeStress(q, r.answer, ids);
      }
      saveRaw(raw);
    }
  }
}

function writeReport() {
  const sizes = sizesOnDisk();
  const cells: Cell[] = [];
  const perQ: Record<string, unknown>[] = [];
  const qBySize = new Map(sizes.map((s) => [s, loadQuestions(s)]));
  for (const size of sizes) {
    for (const c of ["A", "B", "C"] as ConfigId[]) {
      const raw = loadRaw(size, c);
      const qs = qBySize.get(size)!;
      const recs = raw ? qs.map((q) => raw.records[q.id]).filter(Boolean) : [];
      const byCat: Cell["by_category"] = {};
      for (const cat of CATEGORIES) {
        const rs = recs.filter((r) => r.category === cat);
        if (rs.length) byCat[cat] = { n: rs.length, correct: rs.filter((r) => r.grade.correct).length };
      }
      const abst = recs.filter((r) => qs.find((q) => q.id === r.qid)!.should_abstain);
      const agent = recs.filter((r) => r.tool_calls !== null);
      cells.push({
        size,
        config: c,
        status: raw?.status ?? "not_run",
        ...(raw?.status_note ? { note: raw.status_note } : {}),
        ...(raw?.context_tokens ? { context_tokens: raw.context_tokens } : {}),
        n: recs.length,
        accuracy: recs.length ? r3(recs.filter((r) => r.grade.correct).length / recs.length) : 0,
        citation_validity: recs.length ? r3(recs.filter((r) => r.grade.citations_valid).length / recs.length) : 0,
        abstention: `${abst.filter((r) => r.grade.correct).length}/${abst.length}`,
        wrong_numbers: recs.reduce((s, r) => s + r.grade.wrong_numbers.length, 0),
        wrong_answers: recs.filter((r) => r.grade.failure === "wrong").length,
        declined: recs.filter((r) => r.grade.failure === "declined").length,
        core: { n: recs.filter((r) => CORE.includes(r.template)).length, correct: recs.filter((r) => CORE.includes(r.template) && r.grade.correct).length },
        cost_per_q_usd: recs.length ? r4(recs.reduce((s, r) => s + r.cost_usd, 0) / recs.length) : 0,
        p50_latency_s: Math.round(median(recs.map((r) => r.latency_s)) * 10) / 10,
        tool_calls_per_q: c === "A" ? 0 : agent.length ? Math.round((agent.reduce((s, r) => s + (r.tool_calls ?? 0), 0) / agent.length) * 10) / 10 : null,
        by_category: byCat,
      });
      for (const r of recs)
        perQ.push({
          size,
          qid: r.qid,
          template: r.template,
          category: r.category,
          config: c,
          correct: r.grade.correct,
          failure: r.grade.failure,
          citations_valid: r.grade.citations_valid,
          wrong_numbers: r.grade.wrong_numbers.length,
          tool_calls: r.tool_calls,
          cost_usd: r4(r.cost_usd),
          latency_s: Math.round(r.latency_s * 10) / 10,
          ...(r.grade.diagnosis || r.error ? { diagnosis: [r.error, r.grade.diagnosis].filter(Boolean).join(" · ").slice(0, 300) } : {}),
        });
    }
  }
  const notesPath = join(here, "notes.json");
  const findings: string[] = existsSync(notesPath) ? JSON.parse(readFileSync(notesPath, "utf8")) : [];
  const spend = r3(totalSpend());
  const results = {
    generated_at: new Date().toISOString(),
    sizes,
    configs: (["A", "B", "C"] as ConfigId[]).map((id) => ({ id, ...CONFIGS[id] })),
    categories: CATEGORIES,
    question_templates: (qBySize.get(sizes[0]) ?? []).map((q) => ({ template: q.template, category: q.category, question: q.question })),
    cells,
    per_question: perQ,
    findings,
    spend_usd: spend,
  };
  writeFileSync(join(here, "results.json"), JSON.stringify(results, null, 1) + "\n");
  writeFileSync(join(here, "RESULTS.md"), renderMd(results, qBySize));
  return results;
}

function renderMd(res: { generated_at: string; sizes: number[]; cells: Cell[]; per_question: Record<string, unknown>[]; findings: string[]; spend_usd: number }, qBySize: Map<number, StressQuestion[]>): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const L: string[] = [];
  L.push("# Stress eval results", "");
  L.push(
    `Generated ${res.generated_at} · sizes ${res.sizes.join(", ")} trials · ${qBySize.get(res.sizes[0])?.length ?? 0} questions per size (\`evals/stress/questions-<size>.json\`, built by \`evals/stress/generate-haystack.ts\` from seeded synthetic notebooks) · n = 1 per question per config · total API spend on record $${res.spend_usd.toFixed(2)}.`,
    "",
  );
  if (res.findings.length) {
    L.push("## Findings", "");
    for (const f of res.findings) L.push(`- ${f}`);
    L.push("");
  }
  L.push("## Size × config", "");
  L.push("| Trials | Config | Status | Context | Core 15 | All questions run | Citation validity | Declines correctly | Confidently wrong | Gave up / hedged | Tool calls / q | Cost / q | p50 latency |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const c of res.cells) {
    const ctx = c.context_tokens ? `${Math.round(c.context_tokens / 1000)}K tok` : c.config === "A" ? "–" : "tools";
    if (c.status !== "ran" || !c.n) {
      L.push(`| ${c.size} | ${c.config} · ${CONFIGS[c.config].label} | ${c.status === "doesnt_fit" ? "**doesn't fit**" : c.status === "skipped_cost" ? "skipped: cost" : "not run"}${c.note ? ` (${c.note})` : ""} | ${ctx} | – | – | – | – | – | – | – | – | – |`);
      continue;
    }
    L.push(
      `| ${c.size} | ${c.config} · ${CONFIGS[c.config].label} | ran | ${ctx} | **${c.core.correct}/${c.core.n}** | ${Math.round(c.accuracy * c.n)}/${c.n} (${pct(c.accuracy)}) | ${pct(c.citation_validity)} | ${c.abstention} | ${c.wrong_answers} | ${c.declined} | ${c.tool_calls_per_q ?? "–"} | $${c.cost_per_q_usd.toFixed(4)} | ${c.p50_latency_s.toFixed(1)} s |`,
    );
  }
  L.push("");
  L.push("## By category (correct / asked)", "");
  L.push(`| Trials | Config | ${CATEGORIES.join(" | ")} |`);
  L.push(`|---|---|${CATEGORIES.map(() => "---").join("|")}|`);
  for (const c of res.cells.filter((x) => x.status === "ran" && x.n)) {
    L.push(`| ${c.size} | ${c.config} | ${CATEGORIES.map((k) => (c.by_category[k] ? `${c.by_category[k].correct}/${c.by_category[k].n}` : "–")).join(" | ")} |`);
  }
  L.push("");
  L.push("## Per question", "");
  const ran = res.cells.filter((x) => x.status === "ran" && x.n);
  L.push(`| Q | Template | Category | ${ran.map((c) => `${c.size}·${c.config}`).join(" | ")} |`);
  L.push(`|---|---|---|${ran.map(() => "---").join("|")}|`);
  const base = qBySize.get(res.sizes[0]) ?? [];
  for (const q of base) {
    const cells = ran.map((c) => {
      const r = res.per_question.find((p) => p.size === c.size && p.config === c.config && p.template === q.template);
      if (!r) return "–";
      return `${r.correct ? "✓" : r.failure === "wrong" ? "✗" : "–✗"}${r.citations_valid ? "" : " c✗"}`;
    });
    L.push(`| ${q.id} | ${CORE.includes(q.template) ? "● " : ""}${q.template} | ${q.category} | ${cells.join(" | ")} |`);
  }
  L.push("");
  L.push("`✓` correct · `✗` confidently wrong · `–✗` gave up or hedged (said it couldn't answer) · `c✗` citation problem (an id that doesn't exist, or the required evidence not cited) · `–` not run. Core-15 templates are marked ●.", "");
  L.push("## How it's graded", "");
  L.push("- **Data:** `generate-haystack.ts` (seed 11) writes one notebook per size in the same `Notebook` shape as `data/notebook.json`: 8 people (Cooper and Greeshma plus six fictional colleagues, two of them named Dana), 15 campaigns, ~15 log entries and 1–3 notes per trial, and a findings ledger. `data/notebook.json` is never modified.");
  L.push("- **Planted at every size:** an overnight rest (T09-like), a >24 h post-cure delay and an aborted print (log only), a loaner mixer in winter 2025–26 (log device field only), two same-recipe trials that differ only by an unlogged pre-warm habit (notes only), three notes that contradict their own measurements, two people named Dana, lookalike ids, a superseded ledger finding, and four abstention traps with a tempting near-match.");
  L.push("- **Expected answers** are computed by `questions.ts` from the generated notebook, and each planted fact is re-derived and asserted unique.");
  L.push("- **Accuracy:** every expected number within tolerance (counts exact; means ±0.01 Pa·s or ±0.06 MPa; hours ±0.25), every required concept or id named, per-person counts next to the right name. Abstention traps: the answer must say it isn't in the notebook.");
  L.push("- **Citation validity:** every bracketed id exists in that size's notebook, and the required evidence ids are cited (a log id counts for its trial).");
  L.push("- **Confidently wrong vs. gave up:** a failed answer is *confidently wrong* when it states an answer without hedging (wrong number, wrong trial, answered an abstention trap). It *gave up / hedged* when it says it couldn't find or compute the answer, or stopped at the per-question budget. The first is the dangerous kind.");
  L.push("- **Core 15:** the same 15 questions (all six categories) in every cell the budget allowed; use this column to compare cells. \"All questions run\" differs per cell: C ran all 29 at every size; A and B ran 25 at 50 trials; A ran the core 15 plus the 4 harder probes at 250; B ran the core 15 at 250 and only the 7 questions it still passed at 250 when run at 1,000.");
  L.push("- **Agent budget:** B and C ran with the Agent SDK's `maxBudgetUsd` per question (B $0.25–0.30, C $0.10; size 50 ran before the cap existed and no question there exceeded $0.20).");
  L.push("- **Cost:** A from `usage` at published Sonnet 5.5 prices ($2 in / $10 out / $2.50 cache write / $0.20 cache read per MTok; the notebook is prompt-cached, first question writes it). B and C from the Agent SDK's `total_cost_usd`.");
  L.push("- **A doesn't fit** when the notebook plus 20K tokens of headroom exceeds the 1M-token window (token count from `count_tokens`, or estimated from chars/token when the request is too large to count).");
  L.push("");
  L.push("## Failures", "");
  for (const p of res.per_question.filter((x) => !x.correct || !x.citations_valid)) {
    L.push(`- **${p.size} ${p.config} ${p.qid}** (${p.template}): ${String(p.diagnosis ?? "").replace(/\|/g, "/")}`);
  }
  L.push("");
  return L.join("\n");
}

// ---------- main ----------

async function main() {
  if (flag("regrade")) {
    regradeAll();
    writeReport();
    console.log("regraded; wrote evals/stress/RESULTS.md and results.json");
    return;
  }
  if (flag("report")) {
    const r = writeReport();
    console.log(`wrote evals/stress/RESULTS.md and results.json · spend on record $${r.spend_usd}`);
    return;
  }
  const sizeArg = arg("size");
  if (sizeArg) {
    await runSize(Number(sizeArg));
    return;
  }
  const sizes = (arg("sizes") ?? sizesOnDisk().join(",")).split(",").map(Number);
  const passThrough = process.argv.slice(2).filter((a, i, all) => !(a === "--sizes" || all[i - 1] === "--sizes" || a.startsWith("--sizes=")));
  for (const size of sizes) {
    // one child per size: server/notebook.ts reads NOTEBOOK_PATH once, at import
    const r = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--size", String(size), ...passThrough], {
      stdio: "inherit",
      env: { ...process.env, NOTEBOOK_PATH: notebookPath(size) },
    });
    if (r.status !== 0) console.log(`size ${size} exited with ${r.status}`);
    if (totalSpend() > maxSpend) {
      console.log(`spend cap $${maxSpend} reached`);
      break;
    }
  }
  const res = writeReport();
  console.log(`wrote evals/stress/RESULTS.md and results.json · spend on record $${res.spend_usd}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
