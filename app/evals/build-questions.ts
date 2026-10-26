// Generates evals/questions.json from data/notebook.json.
// Every expected number is computed here from the notebook, so the eval can't drift from the data.
// Run: npx tsx evals/build-questions.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Notebook, Trial, TrialOutputs } from "../src/shared/types.ts";
import { estimateRecipe } from "../src/shared/surrogate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const nb: Notebook = JSON.parse(readFileSync(join(here, "../data/notebook.json"), "utf8"));

// ---------- question schema ----------

export interface ExpectedNumber {
  label: string;
  values: number[]; // any one of these counts (e.g. a mean with or without the excluded trial)
  tol: number; // absolute tolerance
  unit?: string;
}

export interface Concept {
  label: string;
  patterns: string[]; // case-insensitive regex sources; any one matching counts
}

export interface EvalQuestion {
  id: string;
  category: "lookup" | "aggregation" | "log_timing" | "protocol_diff" | "ledger" | "abstain" | "hero";
  question: string;
  should_abstain: boolean;
  expected: {
    summary: string; // the expected answer in one line, for humans
    numbers: ExpectedNumber[];
    // other acceptable ways to give the numbers (e.g. ranges instead of means); a full match of any set also counts
    alt_number_sets?: ExpectedNumber[][];
    required_ids: string[]; // every one must be cited
    any_of_ids?: string[][]; // for each group, at least one must be cited
    concepts: Concept[]; // every one must appear
  };
  allowed_extra_ids?: string[]; // proposed ids that are valid only for this question (hero: L4, T15*)
  extra_legit_numbers?: number[]; // code-computed numbers that are fair to state (e.g. surrogate estimates)
}

// ---------- helpers ----------

const T = (id: string): Trial => {
  const t = nb.trials.find((x) => x.id === id);
  if (!t) throw new Error(`no trial ${id}`);
  return t;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r2 = (x: number) => Math.round(x * 100) / 100;
const out = (ts: Trial[], k: keyof TrialOutputs) => ts.map((t) => t.outputs[k] as number);
const logById = (id: string) => {
  for (const t of nb.trials) for (const l of t.log) if (l.id === id) return l;
  throw new Error(`no log ${id}`);
};
const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3.6e6;
const personName = (id: string) => nb.people.find((p) => p.id === id)!.name;

const q: EvalQuestion[] = [];

// q01 lookup: T14 viscosity
{
  const t = T("T14");
  q.push({
    id: "q01",
    category: "lookup",
    question: "What was T14's viscosity?",
    should_abstain: false,
    expected: {
      summary: `T14: ${t.outputs.viscosity_pa_s} Pa·s`,
      numbers: [{ label: "T14 viscosity", values: [t.outputs.viscosity_pa_s], tol: 0.005, unit: "Pa·s" }],
      required_ids: ["T14"],
      concepts: [],
    },
  });
}

// q02 lookup: who ran T09, and when
{
  const t = T("T09");
  const owner = personName(t.owners[0]); // "Cooper Shea"
  const [y, m, d] = t.date.split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  q.push({
    id: "q02",
    category: "lookup",
    question: "Who ran T09, and on what date?",
    should_abstain: false,
    expected: {
      summary: `${owner}, ${t.date}`,
      numbers: [],
      required_ids: ["T09"],
      concepts: [
        { label: `owner ${owner}`, patterns: [owner.split(" ")[0]] },
        {
          label: `date ${t.date}`,
          patterns: [t.date, `${month.slice(0, 3)}[a-z]*\\.?\\s+${d}(st|nd|rd|th)?,?\\s+${y}`, `${d}\\s+${month.slice(0, 3)}[a-z]*\\.?,?\\s+${y}`],
        },
      ],
    },
  });
}

// q03 lookup: T08 porosity and porosity guardrail
{
  const t = T("T08");
  const g = nb.project.guardrails.find((x) => x.id === "porosity")!;
  q.push({
    id: "q03",
    category: "lookup",
    question: "What porosity did T08 have, and did it pass the porosity guardrail?",
    should_abstain: false,
    expected: {
      summary: `${t.outputs.porosity_pct}% vs ≤ ${g.checks[0].threshold}% limit: ${t.guardrails.porosity ? "pass" : "fail"}`,
      numbers: [{ label: "T08 porosity", values: [t.outputs.porosity_pct], tol: 0.005, unit: "%" }],
      required_ids: ["T08"],
      concepts: [
        t.guardrails.porosity
          ? { label: "passed", patterns: ["\\bpass(ed|es)?\\b"] }
          : { label: "failed", patterns: ["\\bfail(ed|s)?\\b", "did not pass", "didn't pass", "does not pass", "doesn't pass", "not pass"] },
      ],
    },
  });
}

// q04 lookup: excluded trials
{
  const ex = nb.trials.filter((t) => t.excluded);
  q.push({
    id: "q04",
    category: "lookup",
    question: "Which trials were excluded from the team's conclusions, and why?",
    should_abstain: false,
    expected: {
      summary: ex.map((t) => `${t.id}: ${t.excluded_reason}`).join("; "),
      numbers: [],
      required_ids: ex.map((t) => t.id),
      concepts: [{ label: "reason: anomalous / lucky specimen", patterns: ["anomal", "lucky", "fluke"] }],
    },
  });
}

// q05 aggregation: mean UTS of Cooper's campaign B, with and without the excluded trial
{
  const b = nb.trials.filter((t) => t.campaign === "B");
  const bIncl = b.filter((t) => !t.excluded);
  const all = r2(mean(out(b, "uts_mpa")));
  const incl = r2(mean(out(bIncl, "uts_mpa")));
  q.push({
    id: "q05",
    category: "aggregation",
    question: "What was the mean tensile strength (UTS) of Cooper's campaign B, with and without the excluded trial?",
    should_abstain: false,
    expected: {
      summary: `All ${b.length} (${b.map((t) => t.id).join(", ")}): ${all} MPa; without ${b.filter((t) => t.excluded).map((t) => t.id).join(", ")}: ${incl} MPa`,
      numbers: [
        { label: `mean UTS, all ${b.length} campaign B trials`, values: [all], tol: 0.1, unit: "MPa" },
        { label: `mean UTS, ${bIncl.length} included campaign B trials`, values: [incl], tol: 0.1, unit: "MPa" },
      ],
      required_ids: [],
      any_of_ids: [b.filter((t) => t.excluded).map((t) => t.id)],
      concepts: [],
    },
  });
}

// q06 aggregation: strength at ≥ 30% diluent, by degassing
{
  const hi = nb.trials.filter((t) => t.inputs.diluent_wt >= 30);
  const deg = hi.filter((t) => t.inputs.degas_min > 0);
  const und = hi.filter((t) => t.inputs.degas_min === 0);
  const undIncl = und.filter((t) => !t.excluded);
  const mDeg = r2(mean(out(deg, "uts_mpa")));
  const mUnd = r2(mean(out(und, "uts_mpa")));
  const mUndIncl = r2(mean(out(undIncl, "uts_mpa")));
  q.push({
    id: "q06",
    category: "aggregation",
    question: "At 30% diluent or above, how does tensile strength (UTS) compare between degassed and undegassed trials?",
    should_abstain: false,
    expected: {
      summary: `Degassed (${deg.map((t) => t.id).join(", ")}): mean ${mDeg} MPa; undegassed (${und.map((t) => t.id).join(", ")}): mean ${mUnd} MPa (${mUndIncl} without excluded T09)`,
      numbers: [
        { label: `mean UTS degassed ≥30% (n=${deg.length})`, values: [mDeg], tol: 0.1, unit: "MPa" },
        { label: `mean UTS undegassed ≥30% (n=${und.length}, or ${undIncl.length} excl. T09)`, values: [mUnd, mUndIncl], tol: 0.1, unit: "MPa" },
      ],
      alt_number_sets: [
        // the question says "compare", not "mean": the two ranges answer it too
        [
          { label: "degassed UTS min", values: [Math.min(...out(deg, "uts_mpa"))], tol: 0.05, unit: "MPa" },
          { label: "degassed UTS max", values: [Math.max(...out(deg, "uts_mpa"))], tol: 0.05, unit: "MPa" },
          { label: "undegassed UTS min", values: [Math.min(...out(und, "uts_mpa"))], tol: 0.05, unit: "MPa" },
          { label: "undegassed UTS max", values: [Math.max(...out(und, "uts_mpa")), Math.max(...out(undIncl, "uts_mpa"))], tol: 0.05, unit: "MPa" },
        ],
      ],
      required_ids: deg.map((t) => t.id),
      any_of_ids: [und.map((t) => t.id)],
      concepts: [{ label: "names degassing as the split", patterns: ["degas"] }],
    },
  });
}

// q07 aggregation: which trials met the viscosity target, and which of those passed every guardrail
{
  const target = nb.project.objective.target;
  const met = nb.trials.filter((t) => t.outputs.viscosity_pa_s <= target);
  const metPass = met.filter((t) => t.pass_all);
  q.push({
    id: "q07",
    category: "aggregation",
    question: `How many trials reached the viscosity target of ${target} Pa·s or lower, and which of those passed every guardrail?`,
    should_abstain: false,
    expected: {
      summary: `${met.length} trials (${met.map((t) => t.id).join(", ")}); passed every guardrail: ${metPass.map((t) => t.id + (t.excluded ? " (excluded)" : "")).join(", ")}`,
      numbers: [{ label: "count reaching target", values: [met.length], tol: 0 }],
      required_ids: [...met.map((t) => t.id)],
      concepts: [{ label: "T09 was excluded", patterns: ["exclud"] }],
    },
  });
}

// q08 aggregation: mean porosity, Shreya vs Cooper's campaign A
{
  const g = nb.trials.filter((t) => t.campaign === "S");
  const a = nb.trials.filter((t) => t.campaign === "A");
  const mg = r2(mean(out(g, "porosity_pct")));
  const ma = r2(mean(out(a, "porosity_pct")));
  q.push({
    id: "q08",
    category: "aggregation",
    question: "What's Shreya's mean porosity across her trials, compared with Cooper's campaign A?",
    should_abstain: false,
    expected: {
      summary: `Shreya (${g.map((t) => t.id).join(", ")}): ${mg}%; campaign A (${a.map((t) => t.id).join(", ")}): ${ma}%`,
      numbers: [
        // reported to 2 dp in the data; accept a 3-dp answer too
        { label: "Shreya mean porosity", values: [mean(out(g, "porosity_pct"))], tol: 0.006, unit: "%" },
        { label: "campaign A mean porosity", values: [mean(out(a, "porosity_pct"))], tol: 0.006, unit: "%" },
      ],
      required_ids: [],
      any_of_ids: [g.map((t) => t.id), a.map((t) => t.id)],
      concepts: [],
    },
  });
}

// q09 log timing: T09 rest between end of mix and start of print
{
  const t = T("T09");
  const mixEnd = t.log.find((l) => l.step === "mix" && /ended/i.test(l.event))!;
  const printStart = t.log.find((l) => l.step === "print" && /started/i.test(l.event))!;
  const h = hoursBetween(mixEnd.t, printStart.t);
  q.push({
    id: "q09",
    category: "log_timing",
    question: "How long did T09's resin rest between the end of mixing and the start of printing?",
    should_abstain: false,
    expected: {
      summary: `${r2(h)} h: mix ended ${mixEnd.id} ${mixEnd.t} → print started ${printStart.id} ${printStart.t}`,
      numbers: [{ label: "T09 rest (h)", values: [Math.round(h * 10) / 10], tol: 0.25, unit: "h" }],
      required_ids: [],
      any_of_ids: [[mixEnd.id], [printStart.id]],
      concepts: [],
    },
  });
}

// q10 protocol diff: T08 vs T13 apart from the recipe
{
  const a = T("T08");
  const b = T("T13");
  const degasLog = b.log.find((l) => l.step === "degas")!;
  q.push({
    id: "q10",
    category: "protocol_diff",
    question: "Apart from the recipe, what was different about how T08 and T13 were processed?",
    should_abstain: false,
    expected: {
      summary: `T13 was vacuum-degassed ${b.inputs.degas_min} min (${degasLog.id}, manual worksheet entry); T08 had no degas step (${a.inputs.degas_min} min). Mix, post-cure, rest (${a.inputs.rest_h} vs ${b.inputs.rest_h} h) otherwise match.`,
      numbers: [{ label: "degas minutes (T13)", values: [b.inputs.degas_min], tol: 0 }],
      required_ids: ["T08", "T13"],
      concepts: [
        { label: "degassing", patterns: ["degas"] },
        { label: "T08 not degassed", patterns: ["no degas", "not degassed", "never degassed", "undegassed", "without degas", "no vacuum", "skipped", "absent", "didn't degas", "did not degas", "no such step", "no degassing", "lacks? (a |the )?degas", "0 min"] },
      ],
    },
  });
}

// q11 ledger: status of the high-diluent dead end
{
  const l = nb.ledger.find((x) => x.kind === "dead_end")!;
  q.push({
    id: "q11",
    category: "ledger",
    question: "What's the current status of the high-diluent dead end in the findings ledger, and what evidence was it based on?",
    should_abstain: false,
    expected: {
      summary: `${l.id}, ${l.status}, owner ${personName(l.owner)}, evidence ${l.evidence.join(", ")} (T09 excluded)`,
      numbers: [],
      required_ids: [l.id, ...l.evidence],
      concepts: [
        { label: `status ${l.status}`, patterns: [`\\b${l.status}\\b`, "in force", "still stands", "standing", "not (been )?(disputed|revisited|overturned)"] },
      ],
    },
  });
}

// q12 abstain: supplier price for DiluentX
q.push({
  id: "q12",
  category: "abstain",
  question: "What's the supplier's price per kilogram for DiluentX?",
  should_abstain: true,
  expected: {
    summary: "Not in the notebook. DiluentX is only mentioned in T14's notes as an idea; no price is recorded.",
    numbers: [],
    required_ids: [],
    concepts: [],
  },
});

// q13 abstain: a trial that doesn't exist
{
  const last = nb.trials[nb.trials.length - 1].id; // T14
  q.push({
    id: "q13",
    category: "abstain",
    question: "What tensile strength did T17 reach, and did it pass the bend test?",
    should_abstain: true,
    expected: {
      summary: `Not in the notebook: there is no T17 (trials run T01–${last}).`,
      numbers: [],
      required_ids: [],
      concepts: [],
    },
  });
}

// q15 aggregation that needs exact arithmetic: Pearson r, diluent vs porosity, undegassed trials
{
  const und = nb.trials.filter((t) => t.inputs.degas_min === 0);
  const xs = und.map((t) => t.inputs.diluent_wt);
  const ys = und.map((t) => t.outputs.porosity_pct);
  const mx = mean(xs);
  const my = mean(ys);
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const syy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const r = sxy / Math.sqrt(sxx * syy);
  const incl = und.filter((t) => !t.excluded);
  const xi = incl.map((t) => t.inputs.diluent_wt);
  const yi = incl.map((t) => t.outputs.porosity_pct);
  const mxi = mean(xi);
  const myi = mean(yi);
  const ri =
    xi.reduce((s, x, i) => s + (x - mxi) * (yi[i] - myi), 0) /
    Math.sqrt(xi.reduce((s, x) => s + (x - mxi) ** 2, 0) * yi.reduce((s, y) => s + (y - myi) ** 2, 0));
  q.push({
    id: "q15",
    category: "aggregation",
    question: "Across all the undegassed trials, what's the Pearson correlation between diluent % and porosity?",
    should_abstain: false,
    expected: {
      summary: `r = ${r.toFixed(3)} over n = ${und.length} (${und[0].id}–${und[und.length - 1].id}); r = ${ri.toFixed(3)} without excluded T09`,
      numbers: [{ label: `Pearson r, n=${und.length} (or ${incl.length} without T09)`, values: [Math.round(r * 1000) / 1000, Math.round(ri * 1000) / 1000], tol: 0.01 }],
      required_ids: [],
      any_of_ids: [und.map((t) => t.id)],
      concepts: [],
    },
    // intermediate sums an answer may show when it does the arithmetic
    extra_legit_numbers: [mx, my, sxy, sxx, syy, mxi, myi,
      xi.reduce((s, x, i) => s + (x - mxi) * (yi[i] - myi), 0), xi.reduce((s, x) => s + (x - mxi) ** 2, 0), yi.reduce((s, y) => s + (y - myi) ** 2, 0)],
  });
}

// q14 hero (verbatim from BRIEF.md)
{
  const b = nb.trials.filter((t) => t.campaign === "B");
  const vB = out(b, "viscosity_pa_s");
  const T13 = T("T13");
  const m = nb.landscape.models;
  const t15a = estimateRecipe(m, { diluent_wt: T("T08").inputs.diluent_wt, photoinit_wt: 1.7, degas_min: 10 });
  const t15b = estimateRecipe(m, { diluent_wt: T("T08").inputs.diluent_wt, photoinit_wt: 1.7, degas_min: 0 });
  const rest = hoursBetween(logById("T09-L05").t, logById("T09-L07").t);
  q.push({
    id: "q14",
    category: "hero",
    question: "My best is 1.55 Pa·s. I want to order DiluentX ($1,800, 6 weeks) to get under 1.5. Has anyone tried something like this?",
    should_abstain: false,
    expected: {
      summary:
        `Yes: Cooper's campaign B (${b[0].id}–${b[b.length - 1].id}) reached ${Math.min(...vB)}–${Math.max(...vB)} Pa·s with the current diluent but failed strength. ` +
        `T08 vs T13 differs by an unintended ${T13.inputs.degas_min}-min degas. Every >30% failure was undegassed; T09 rested ${r2(rest)} h, passed, and was excluded. ` +
        `Propose T15: T15a degassed vs T15b undegassed control, nothing to order. Credit Shreya.`,
      numbers: [{ label: "a campaign B viscosity under the target", values: vB.filter((v) => v <= nb.project.objective.target), tol: 0.005, unit: "Pa·s" }],
      required_ids: ["T09"],
      any_of_ids: [["T08", "T06", "T07", "T10"], ["T13", "T14", "T11", "T12"]],
      concepts: [
        { label: "campaign B already went below 1.5 with the current diluent", patterns: ["campaign B", "T0[6-9]", "T10"] },
        { label: "degassing", patterns: ["degas"] },
        { label: "control arm", patterns: ["control"] },
      ],
    },
    allowed_extra_ids: ["L4", "L5", "T15", "T15a", "T15b"],
    extra_legit_numbers: [t15a.viscosity_pa_s, t15a.porosity_pct, t15a.p_pass, t15b.viscosity_pa_s, t15b.porosity_pct, t15b.p_pass, 1.7, 1800, 6],
  });
}

q.sort((a, b) => a.id.localeCompare(b.id));
const file = {
  generated_from: "data/notebook.json",
  generator: "evals/build-questions.ts",
  notebook_generated_at: nb.meta.generated_at,
  seed: nb.meta.seed,
  questions: q,
};
writeFileSync(join(here, "questions.json"), JSON.stringify(file, null, 2) + "\n");
console.log(`wrote evals/questions.json: ${q.length} questions`);
for (const x of q) console.log(`${x.id}  ${x.category.padEnd(13)} ${x.expected.summary}`);
