// Graders for the notebook eval. Everything here is deterministic code, except judgeHero,
// a light Claude-as-judge rubric (claude-haiku-5-5, forced tool use) for the hero proposal.

import Anthropic from "@anthropic-ai/sdk";
import type { Notebook, Trial } from "../src/shared/types.ts";
import type { EvalQuestion, ExpectedNumber } from "./build-questions.ts";

// ---------- valid ids ----------

export function buildValidIds(nb: Notebook): Set<string> {
  const ids = new Set<string>();
  for (const t of nb.trials) {
    ids.add(t.id);
    for (const l of t.log) ids.add(l.id);
  }
  for (const l of nb.ledger) ids.add(l.id);
  return ids;
}

const ID_RE = /\b(T\d{1,3}[a-z]?(?:-L\d{1,3})?|L\d{1,3})\b/g;
const RANGE_RE = /\bT(\d{1,3})\s*(?:–|—|-|to)\s*T(\d{1,3})\b/g;

function expandRanges(s: string): { ids: string[]; rest: string } {
  const ids: string[] = [];
  const rest = s.replace(RANGE_RE, (_m, a: string, b: string) => {
    const lo = Number(a);
    const hi = Number(b);
    if (hi > lo && hi - lo <= 20) for (let i = lo; i <= hi; i++) ids.push(`T${String(i).padStart(2, "0")}`);
    else ids.push(`T${a}`, `T${b}`);
    return " ";
  });
  return { ids, rest };
}

/** Ids cited in [brackets] in the answer text. Ranges like [T06–T10] are expanded. */
export function extractCitedIds(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\[([^\]\n]{1,200})\]/g)) {
    const { ids, rest } = expandRanges(m[1]);
    ids.forEach((i) => out.add(i));
    for (const x of rest.matchAll(ID_RE)) out.add(x[1]);
  }
  return [...out];
}

/** Ids mentioned anywhere (bracketed or not). Used for "names T09". */
export function mentionsId(text: string, id: string): boolean {
  return new RegExp(`\\b${id}\\b`).test(text);
}

// ---------- numbers ----------

export interface FoundNumber {
  value: number;
  raw: string;
  unit: string; // normalized: "Pa·s" | "MPa" | "%" | "h" | "min" | "$" | "weeks" | "g" | "rpm" | "°C" | ""
  decimals: number;
  checkable: boolean; // has a unit we check, or a decimal point
}

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};

function normUnit(u: string): string {
  const s = u.toLowerCase().replace(/\s+/g, "");
  if (/^pa[·.\-s]*s?$/.test(s) || s.startsWith("pa·s") || s === "pas") return "Pa·s";
  if (s === "mpa") return "MPa";
  if (s === "%") return "%";
  if (/^(h|hr|hrs|hour|hours)$/.test(s)) return "h";
  if (/^(min|mins|minute|minutes)$/.test(s)) return "min";
  if (/^(week|weeks|wk|wks)$/.test(s)) return "weeks";
  if (s === "g") return "g";
  if (s === "rpm") return "rpm";
  if (s === "°c" || s === "c") return "°C";
  return "";
}

/** Strip things that look numeric but aren't claims: ids, dates, times, standards, versions. */
function scrub(text: string): string {
  return text
    .replace(/\[[^\]\n]{1,200}\]/g, " ") // citation brackets
    .replace(/\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?\b/g, " ") // ISO dates
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}\b/gi, " ")
    .replace(/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4}\b/gi, " ")
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/gi, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ") // bare years
    .replace(/\b\d{1,2}:\d{2}(\s?[ap]m)?\b/gi, " ") // clock times
    .replace(/\bISO\s*\d+(-\d+)?\b/gi, " ")
    .replace(/\bv\d+(\.\d+)?\b/gi, " ")
    .replace(/\b3[-\s]?(pt|point)\b/gi, " ")
    .replace(ID_RE, " ");
}

export function extractNumbers(text: string): FoundNumber[] {
  const found: FoundNumber[] = [];
  let s = scrub(text);
  // composite durations: "18 h 10 min", "18 hours and 10 minutes"
  s = s.replace(/(\d+)\s*(?:h|hr|hrs|hours?)\s*(?:and\s*)?(\d+)\s*(?:m|min|mins|minutes?)\b/gi, (_m, h: string, mi: string) => {
    const v = Number(h) + Number(mi) / 60;
    found.push({ value: v, raw: _m, unit: "h", decimals: 2, checkable: true });
    return " ";
  });
  const re = /(\$)?(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(Pa\s?[·.\-]?\s?s\b|MPa|%|hours?|hrs?|h\b|minutes?|mins?|min\b|weeks?|wks?|g\b|rpm|°\s?C)?(\s*(?:×|x\b|times|-fold|fold))?/gi;
  for (const m of s.matchAll(re)) {
    if (m[5]) continue; // multipliers ("25×") are derived ratios, skip
    const intPart = m[2].replace(/,/g, "");
    const value = Number(intPart + (m[3] ?? ""));
    if (!Number.isFinite(value)) continue;
    const unit = m[1] ? "$" : normUnit(m[4] ?? "");
    const decimals = m[3] ? m[3].length - 1 : 0;
    const checkable = unit !== "" || decimals > 0;
    found.push({ value, raw: m[0].trim(), unit, decimals, checkable });
  }
  return found;
}

/** Numbers spelled out ("five trials"), for count matching only. */
function wordNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.toLowerCase().matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b/g)) out.push(WORD_NUM[m[1]]);
  return out;
}

// ---------- legit numbers (the universe an answer may state) ----------

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function numbersInString(s: string): number[] {
  return [...s.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}

/** Every value in the notebook (minus raw curve/pore points), plus simple group stats and log gaps. */
export function buildLegitNumbers(nb: Notebook): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number") out.push(v);
    else if (typeof v === "string") out.push(...numbersInString(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(nb.project);
  walk(nb.ledger);
  for (const t of nb.trials) {
    const { curve: _c, flex_curve: _f, pores: _p, log, ...rest } = t;
    walk(rest);
    for (const l of log) {
      walk({ value: l.value, event: l.event });
    }
    // gaps between consecutive log steps, in h and min
    for (let i = 1; i < log.length; i++) {
      const h = (new Date(log[i].t).getTime() - new Date(log[i - 1].t).getTime()) / 3.6e6;
      out.push(h, h * 60);
    }
    const mixEnd = log.find((l) => l.step === "mix" && /ended/i.test(l.event));
    const printStart = log.find((l) => l.step === "print" && /started/i.test(l.event));
    if (mixEnd && printStart) {
      const h = (new Date(printStart.t).getTime() - new Date(mixEnd.t).getTime()) / 3.6e6;
      out.push(h, h * 60);
    }
  }
  // group stats
  const groups: Record<string, Trial[]> = {
    all: nb.trials,
    included: nb.trials.filter((t) => !t.excluded),
    A: nb.trials.filter((t) => t.campaign === "A"),
    B: nb.trials.filter((t) => t.campaign === "B"),
    B_incl: nb.trials.filter((t) => t.campaign === "B" && !t.excluded),
    G: nb.trials.filter((t) => t.campaign === "G"),
    cooper: nb.trials.filter((t) => t.owners.includes("cooper")),
    degassed: nb.trials.filter((t) => t.inputs.degas_min > 0),
    undegassed: nb.trials.filter((t) => t.inputs.degas_min === 0),
    hi_und: nb.trials.filter((t) => t.inputs.diluent_wt >= 30 && t.inputs.degas_min === 0),
    hi_und_incl: nb.trials.filter((t) => t.inputs.diluent_wt >= 30 && t.inputs.degas_min === 0 && !t.excluded),
    hi_deg: nb.trials.filter((t) => t.inputs.diluent_wt >= 30 && t.inputs.degas_min > 0),
    pass: nb.trials.filter((t) => t.pass_all),
    fail: nb.trials.filter((t) => !t.pass_all),
  };
  const metrics = ["viscosity_pa_s", "porosity_pct", "uts_mpa", "elongation_pct", "flex_strength_mpa", "flex_modulus_mpa", "viability_pct"] as const;
  const inputs = ["diluent_wt", "photoinit_wt", "rest_h"] as const;
  for (const ts of Object.values(groups)) {
    if (!ts.length) continue;
    out.push(ts.length);
    for (const k of metrics) {
      const xs = ts.map((t) => t.outputs[k] as number);
      // mean, median, extremes, range, and the sum (answers show their arithmetic: "135.7 / 4 = 33.9")
      out.push(mean(xs), median(xs), Math.min(...xs), Math.max(...xs), Math.max(...xs) - Math.min(...xs), xs.reduce((a, b) => a + b, 0));
    }
    for (const k of inputs) {
      const xs = ts.map((t) => t.inputs[k]);
      out.push(mean(xs), median(xs));
    }
  }
  return out;
}

function matchesAny(n: FoundNumber, legit: number[]): boolean {
  const tol = 0.5 * Math.pow(10, -n.decimals) + 1e-9;
  return legit.some((L) => Math.abs(n.value - L) <= tol || Math.abs(n.value - L) <= 0.005 * Math.abs(L));
}

// ---------- abstention ----------

const ABSTAIN_RE = [
  /not (?:in|recorded in|found in|available in|documented in|captured in|listed in|logged in|present in|anywhere in) (?:the |this |your )?(?:project )?notebook/i,
  /(?:notebook|records?|project|data) (?:doesn't|does not|don't|do not|has no|have no|contains? no) (?:contain|include|have|record|show|list|mention|any)/i,
  /\bno (?:record|data|information|entry|entries|trial|mention|price|pricing|quote|quoted|supplier|cost|results?)\b/i,
  /(?:doesn't|does not|don't|do not) exist/i,
  /\bthere (?:is|are|was|were) no\b/i,
  /\bnot recorded\b|\bisn't recorded\b|\bwasn't recorded\b|\bnever recorded\b/i,
  /\b(?:can't|cannot|can not|unable to) (?:find|answer|tell|give|provide|say)\b/i,
  /\bnothing (?:in|on) (?:the |this )?(?:notebook|record|ledger)/i,
  /\bn't (?:have|contain) (?:that|this|any)/i,
  /\b(?:isn't|aren't|wasn't|weren't) (?:in|anywhere in|recorded in|logged in) (?:the |this |your )?(?:project )?notebook/i,
];
export function looksLikeAbstention(text: string): boolean {
  return ABSTAIN_RE.some((r) => r.test(text));
}

// ---------- hero checks ----------

export interface HeroChecks {
  names_degas_confound: boolean;
  names_T09: boolean;
  proposes_control_arm: boolean;
  pass: boolean;
}

export function heroChecks(text: string, proposalsJson: string): HeroChecks {
  const degas = /degas/i.test(text);
  const confoundWords =
    /confound|unintended|hidden variable|undocumented|not in (?:the )?SOP|never degassed|undegassed|(?:were|was|wasn't|weren't|not|none (?:of them )?(?:were|was)) degassed|without degass|no degas|skipped degass|didn't degas|did not degas|hidden factor|process(?:ing)? (?:difference|artifact|variable)/i.test(text);
  const names_degas_confound = degas && confoundWords;
  const names_T09 = mentionsId(text, "T09");
  const controlInText =
    /control/i.test(text) &&
    /T15b|without degass|no degas|undegassed|not degassed|skip(?:ping|s)? (?:the )?degas|degas[_ ]min:?\s*0|0[- ]min(?:ute)? degas|minus (?:the )?degas|same recipe,? (?:but )?(?:without|no)/i.test(text);
  const controlInProposal = /"role"\s*:\s*"control"/.test(proposalsJson);
  const proposes_control_arm = controlInText || controlInProposal;
  return { names_degas_confound, names_T09, proposes_control_arm, pass: names_degas_confound && names_T09 && proposes_control_arm };
}

/** Ids created by the proposals themselves: the draft's id, its arms, and ledger items being added. */
export function proposalCreatedIds(proposalsJson: string): Set<string> {
  const ids = new Set<string>();
  if (!proposalsJson.trim()) return ids;
  let ps: unknown;
  try {
    ps = JSON.parse(proposalsJson);
  } catch {
    return ids;
  }
  for (const p of Array.isArray(ps) ? ps : []) {
    const payload = (p as { payload?: unknown })?.payload as any;
    if (!payload) continue;
    if (Array.isArray(payload)) {
      for (const ch of payload) {
        if (ch?.op === "add" && ch.item?.id) ids.add(ch.item.id);
        if (typeof ch?.item?.pending_on === "string") ids.add(ch.item.pending_on);
        if (typeof ch?.patch?.pending_on === "string") ids.add(ch.patch.pending_on);
      }
    } else {
      if (typeof payload.id === "string") ids.add(payload.id);
      for (const a of payload.arms ?? []) if (typeof a?.id === "string") ids.add(a.id);
    }
  }
  return ids;
}

// ---------- the main grader ----------

export interface GradeInput {
  q: EvalQuestion;
  answer: string;
  citations?: string[]; // ids from a structured citations event, if any
  proposalsJson?: string; // JSON of proposals (B/C), "" for A
}

export interface Grade {
  correct: boolean;
  citations_valid: boolean;
  abstained: boolean;
  cited_ids: string[];
  invalid_ids: string[];
  missing_ids: string[];
  numbers_missing: string[];
  concepts_missing: string[];
  wrong_numbers: string[]; // raw strings of numbers that don't match the data
  unprompted_proposals: boolean; // filed write proposals on a question that didn't ask for a next step
  hero?: HeroChecks;
  diagnosis: string; // one line, empty when everything passes
}

export function grade(input: GradeInput, ctx: { validIds: Set<string>; legit: number[] }): Grade {
  const { q, answer } = input;
  const proposalsJson = input.proposalsJson ?? "";
  const extra = new Set(q.allowed_extra_ids ?? []);

  // citations: bracketed ids in the answer + structured citations + ids inside proposals
  const cited = new Set<string>(extractCitedIds(answer));
  for (const c of input.citations ?? []) for (const x of c.matchAll(ID_RE)) cited.add(x[1]);
  // ids a proposal creates (its draft trial, arms, new ledger items) are proposals, not citations
  const created = proposalCreatedIds(proposalsJson);
  if (proposalsJson) {
    for (const m of proposalsJson.matchAll(/"(T\d{1,3}[a-z]?(?:-L\d{1,3})?|L\d{1,3})"/g)) if (!created.has(m[1])) cited.add(m[1]);
  }
  const cited_ids = [...cited].sort();
  const invalid_ids = cited_ids.filter((id) => !ctx.validIds.has(id) && !extra.has(id));
  // citing a log entry (T13-L06) counts as citing its trial (T13)
  const citedOrParent = (id: string) => cited.has(id) || cited_ids.some((c) => c.startsWith(`${id}-L`));
  const missing_ids = q.expected.required_ids.filter((id) => !citedOrParent(id));
  for (const group of q.expected.any_of_ids ?? []) if (!group.some(citedOrParent)) missing_ids.push(`one of ${group.join("/")}`);

  // numbers
  const nums = extractNumbers(answer);
  const words = wordNumbers(answer);
  const missingFrom = (set: ExpectedNumber[]) =>
    set
      .filter(
        (e) =>
          !nums.some((n) => e.values.some((v) => Math.abs(n.value - v) <= e.tol + 1e-9)) &&
          !(e.tol === 0 && words.some((w) => e.values.includes(w))),
      )
      .map((e) => `${e.label} (${e.values.map((v) => +v.toFixed(3)).join(" or ")}${e.unit ? " " + e.unit : ""})`);
  let numbers_missing = missingFrom(q.expected.numbers);
  if (numbers_missing.length && (q.expected.alt_number_sets ?? []).some((set) => missingFrom(set).length === 0)) numbers_missing = [];
  const questionNums = numbersInString(q.question.replace(/,/g, ""));
  const legit = [
    ...ctx.legit,
    ...q.expected.numbers.flatMap((e) => e.values),
    ...(q.expected.alt_number_sets ?? []).flat().flatMap((e) => e.values),
    ...(q.extra_legit_numbers ?? []),
    ...questionNums,
  ];
  // A ratio of two numbers the answer itself states (e.g. "0.155 / 0.536 ≈ 0.29") is arithmetic shown, not a fabrication.
  const stated = nums.map((n) => n.value).filter((v) => v !== 0);
  const isStatedRatio = (n: FoundNumber) =>
    stated.some((x) => stated.some((y) => x !== y && Math.abs(x / y - n.value) <= Math.max(0.005, Math.abs(n.value) * 0.02)));
  const wrong_numbers = nums.filter((n) => n.checkable && !matchesAny(n, legit) && !isStatedRatio(n)).map((n) => n.raw);

  // concepts
  const concepts_missing = q.expected.concepts
    .filter((c) => !c.patterns.some((p) => new RegExp(p, "i").test(answer)))
    .map((c) => c.label);

  const factsOk = numbers_missing.length === 0 && concepts_missing.length === 0;
  const looksAbstain = looksLikeAbstention(answer);

  let correct: boolean;
  let abstained: boolean;
  let hero: HeroChecks | undefined;
  if (q.should_abstain) {
    abstained = looksAbstain;
    correct = abstained && wrong_numbers.length === 0;
  } else {
    abstained = looksAbstain && !factsOk && answer.trim().length > 0;
    correct = factsOk && !abstained;
    if (q.category === "hero") {
      hero = heroChecks(answer, proposalsJson);
      correct = correct && hero.pass;
    }
  }
  const citations_valid = invalid_ids.length === 0 && (q.should_abstain || missing_ids.length === 0);

  const why: string[] = [];
  if (q.should_abstain && !abstained) why.push("answered instead of saying it's not in the notebook");
  if (!q.should_abstain && abstained) why.push("declined to answer");
  if (numbers_missing.length) why.push(`missing number: ${numbers_missing.join("; ")}`);
  if (concepts_missing.length) why.push(`missing: ${concepts_missing.join("; ")}`);
  if (hero && !hero.pass)
    why.push(
      `hero: ${[!hero.names_degas_confound && "no degassing confound", !hero.names_T09 && "no T09", !hero.proposes_control_arm && "no control arm"].filter(Boolean).join(", ")}`,
    );
  if (invalid_ids.length) why.push(`cited ids that don't exist: ${invalid_ids.join(", ")}`);
  if (!q.should_abstain && missing_ids.length) why.push(`didn't cite ${missing_ids.join(", ")}`);
  if (wrong_numbers.length) why.push(`numbers not in the data: ${wrong_numbers.slice(0, 6).join(", ")}${wrong_numbers.length > 6 ? ", …" : ""}`);

  const unprompted_proposals = q.category !== "hero" && proposalsJson.trim().length > 2;
  if (unprompted_proposals) why.push(`filed proposals the question didn't ask for (${created.size ? [...created].join(", ") : "ledger"})`);

  return {
    correct,
    citations_valid,
    unprompted_proposals,
    abstained,
    cited_ids,
    invalid_ids,
    missing_ids,
    numbers_missing,
    concepts_missing,
    wrong_numbers,
    hero,
    diagnosis: why.join(" · "),
  };
}

// ---------- Claude-as-judge for the hero proposal ----------

export const JUDGE_MODEL = "claude-haiku-5-5";
// Claude Haiku 5.5, prompts ≤ 100K tokens: $0.10 / $0.50 per MTok (claude-api skill, cached 2026-10-06)
const HAIKU_IN = 0.1 / 1e6;
const HAIKU_OUT = 0.5 / 1e6;

export interface JudgeCriterion {
  pass: boolean;
  evidence: string;
}
export interface JudgeVerdict {
  control_arm: JudgeCriterion;
  cheapest_experiment: JudgeCriterion;
  credits_greeshma: JudgeCriterion;
  uncertainty_stated: JudgeCriterion;
  score: number; // 0..4
  cost_usd: number;
  error?: string;
}

const criterionSchema = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    evidence: { type: "string", description: "A short quote or paraphrase from the answer, or why it's missing. One sentence." },
  },
  required: ["pass", "evidence"],
  additionalProperties: false,
} as const;

const JUDGE_TOOL: Anthropic.Tool = {
  name: "record_verdict",
  description: "Record the rubric verdict for the proposed experiment in the answer.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      control_arm: { ...criterionSchema, description: "Passes if the proposed experiment has a control arm that isolates degassing: the same recipe run with and without degassing (or with and without the long rest)." },
      cheapest_experiment: { ...criterionSchema, description: "Passes if, before ordering DiluentX, it proposes a test that needs nothing new (materials already on hand) and takes about a day, not weeks." },
      credits_greeshma: { ...criterionSchema, description: "Passes if it credits Greeshma for the key insight (her degassing step / her trials). The asker IS Greeshma, so 'your degassing' or 'your runs' counts as credit. Fails if the insight is presented as the assistant's own idea or as Cooper's." },
      uncertainty_stated: { ...criterionSchema, description: "Passes if it states what is uncertain: outcomes are estimates, few trials support it, T09 is a single specimen, or the experiment is needed to confirm." },
    },
    required: ["control_arm", "cheapest_experiment", "credits_greeshma", "uncertainty_stated"],
    additionalProperties: false,
  },
};

export async function judgeHero(client: Anthropic, question: string, answer: string, proposalsJson: string): Promise<JudgeVerdict> {
  const prompt = [
    "You are grading one answer from a lab-notebook assistant. Judge the proposal's scientific quality against the four criteria in the record_verdict tool. A criterion passes when the answer clearly does what it describes; wording doesn't need to match.",
    "",
    "Context (true facts from the notebook): The question was asked by Greeshma, the current scientist; her best is 1.55 Pa·s. Cooper's campaign B (T06–T10) reached 1.19–1.44 Pa·s with the current diluent but failed strength; none of it was degassed. Greeshma degasses 10 minutes (not in the SOP). T09, the one campaign-B trial that rested 18 h before printing, passed and was excluded.",
    "",
    `<question>\n${question}\n</question>`,
    `<answer>\n${answer}\n</answer>`,
    proposalsJson ? `<proposals_made_with_tools>\n${proposalsJson}\n</proposals_made_with_tools>` : "",
  ].join("\n");
  try {
    const res = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 2000,
      tools: [JUDGE_TOOL],
      tool_choice: { type: "tool", name: "record_verdict" },
      messages: [{ role: "user", content: prompt }],
    });
    const cost = res.usage.input_tokens * HAIKU_IN + res.usage.output_tokens * HAIKU_OUT;
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!block) throw new Error(`no verdict (stop_reason ${res.stop_reason})`);
    const v = block.input as Omit<JudgeVerdict, "score" | "cost_usd">;
    const score = [v.control_arm, v.cheapest_experiment, v.credits_greeshma, v.uncertainty_stated].filter((c) => c?.pass).length;
    return { ...v, score, cost_usd: cost };
  } catch (e) {
    const none = { pass: false, evidence: "judge failed" };
    return { control_arm: none, cheapest_experiment: none, credits_greeshma: none, uncertainty_stated: none, score: 0, cost_usd: 0, error: String(e) };
  }
}
