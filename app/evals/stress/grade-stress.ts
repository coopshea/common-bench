// Deterministic grader for the stress questions. Reuses the number extraction and abstention
// detection from evals/graders.ts; ids are matched with a wider pattern (T01–T1000, Txx-Lnn, Txx-Nn, Ln).

import type { Notebook } from "../../src/shared/types.ts";
import { extractNumbers, looksLikeAbstention } from "../graders.ts";
import type { StressQuestion } from "./questions.ts";

export const STRESS_ID_RE = /\b(T\d{2,4}(?:-[LN]\d{2,3})?|L\d{1,3})\b/g;
const RANGE_RE = /\bT(\d{2,4})\s*(?:–|—|-|to)\s*T(\d{2,4})\b/g;

export function buildStressValidIds(nb: Notebook): Set<string> {
  const ids = new Set<string>();
  for (const t of nb.trials) {
    ids.add(t.id);
    for (const l of t.log) ids.add(l.id);
    for (const n of t.notes) ids.add(n.id);
  }
  for (const l of nb.ledger) ids.add(l.id);
  return ids;
}

/** Ids cited in [brackets]. Short ranges like [T06–T10] are expanded; long ones count as their two ends. */
export function extractStressCitedIds(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\[([^\]\n]{1,400})\]/g)) {
    const rest = m[1].replace(RANGE_RE, (_m, a: string, b: string) => {
      const lo = Number(a);
      const hi = Number(b);
      if (hi > lo && hi - lo <= 20) for (let i = lo; i <= hi; i++) out.add(`T${String(i).padStart(2, "0")}`);
      else out.add(`T${a}`).add(`T${b}`);
      return " ";
    });
    for (const x of rest.matchAll(STRESS_ID_RE)) out.add(x[1]);
  }
  return [...out];
}

export interface StressGrade {
  correct: boolean;
  citations_valid: boolean;
  abstained: boolean;
  cited_ids: string[];
  invalid_ids: string[];
  missing_ids: string[];
  numbers_missing: string[];
  wrong_numbers: string[]; // expected numbers the answer got wrong (it stated a number of that kind, but not the right one)
  concepts_missing: string[];
  pairs_missing: string[];
  // how it failed: "wrong" = stated a wrong answer without hedging (dangerous); "declined" = said it couldn't
  // answer or gave a hedged partial answer (safe); "none" = correct
  failure: "none" | "declined" | "wrong";
  diagnosis: string;
}

// Hedges: the answer says it couldn't finish or couldn't compute what was asked.
const HEDGE =
  /\b(?:can[’']t|cannot|couldn[’']t|could not|haven[’']t (?:found|checked)|unable to|not able to|no tool|beyond (?:this|the) session|not allowed|isn[’']t returned|doesn[’']t return|can't state|incomplete|isn[’']t complete|not complete|could still be|ran out of budget|did ?n[o’']t (?:read|check|scan))\b/i;

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function intsIn(s: string): number[] {
  const out: number[] = [];
  for (const m of s.replace(/\[[^\]\n]{1,400}\]/g, " ").replace(STRESS_ID_RE, " ").matchAll(/(?<![\w.])(\d{1,4})(?![\d.]*\d)(?!\s*%)/g)) out.push(Number(m[1]));
  for (const m of s.toLowerCase().matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g)) out.push(WORDS[m[1]]);
  return out;
}

export function gradeStress(q: StressQuestion, answer: string, validIds: Set<string>): StressGrade {
  const cited = extractStressCitedIds(answer);
  const invalid_ids = cited.filter((id) => !validIds.has(id));
  const citedOrChild = (id: string) => cited.includes(id) || cited.some((c) => c.startsWith(`${id}-`));
  const missing_ids = q.expected.required_ids.filter((id) => !citedOrChild(id));
  for (const g of q.expected.any_of_ids ?? []) if (!g.some(citedOrChild)) missing_ids.push(`one of ${g.length} ids (${g.slice(0, 4).join(", ")}${g.length > 4 ? ", …" : ""})`);

  const nums = extractNumbers(answer);
  const ints = intsIn(answer);
  const numbers_missing: string[] = [];
  const wrong_numbers: string[] = [];
  for (const e of q.expected.numbers) {
    const hit = nums.some((n) => e.values.some((v) => Math.abs(n.value - v) <= e.tol + 1e-9)) || (e.tol === 0 && ints.some((n) => e.values.includes(n)));
    if (hit) continue;
    const label = `${e.label} (${e.values.map((v) => +v.toFixed(3)).join(" or ")}${e.unit ? " " + e.unit : ""})`;
    numbers_missing.push(label);
    // "wrong" = the answer stated a number of the same kind (same unit; or any count for unitless counts)
    const sameKind = e.unit ? nums.some((n) => n.unit === normUnit(e.unit!)) : ints.length > 0;
    if (sameKind && !looksLikeAbstention(answer)) wrong_numbers.push(label);
  }

  const concepts_missing = q.expected.concepts.filter((c) => !c.patterns.some((p) => new RegExp(p, "i").test(answer))).map((c) => c.label);

  // per-person pairs: the count must appear after the person's name, before the next person's name
  const pairs_missing: string[] = [];
  if (q.expected.pairs) {
    const all = q.expected.pairs.flatMap((p) => p.name_patterns.map((src) => ({ p, re: new RegExp(src, "gi") })));
    const marks: { at: number; label: string }[] = [];
    for (const { p, re } of all) for (const m of answer.matchAll(re)) marks.push({ at: m.index!, label: p.label });
    marks.sort((a, b) => a.at - b.at);
    for (const p of q.expected.pairs) {
      const mine = marks.filter((m) => m.label === p.label);
      const ok = mine.some((m) => {
        const next = marks.find((x) => x.at > m.at && x.label !== p.label);
        const seg = answer.slice(m.at, Math.min(next ? next.at : answer.length, m.at + 140));
        return intsIn(seg).includes(p.value);
      });
      if (!ok) pairs_missing.push(`${p.label} ${p.value}`);
    }
    if (pairs_missing.length) wrong_numbers.push(...pairs_missing.map((x) => `count ${x}`));
  }

  const looksAbstain =
    looksLikeAbstention(answer) ||
    /(?:notebook|logs?|records?|data) (?:doesn[’']t|does not|don[’']t|do not) (?:say|identify|name|record|show|indicate)/i.test(answer) ||
    /\b(?:couldn[’']t|could not|can[’']t|cannot|did ?n[o’']t) find (?:a|an|any)\b/i.test(answer) || (q.expected.decline_patterns ?? []).some((p) => new RegExp(p, "i").test(answer));
  const factsOk = numbers_missing.length === 0 && concepts_missing.length === 0 && pairs_missing.length === 0;
  let correct: boolean;
  let abstained: boolean;
  if (q.should_abstain) {
    abstained = looksAbstain;
    correct = abstained;
  } else {
    abstained = looksAbstain && !factsOk && answer.trim().length > 0;
    correct = factsOk && answer.trim().length > 0;
  }
  const citations_valid = invalid_ids.length === 0 && (q.should_abstain || missing_ids.length === 0);
  const failure: StressGrade["failure"] = correct ? "none" : !answer.trim() || (!q.should_abstain && (abstained || HEDGE.test(answer))) ? "declined" : "wrong";
  // only confident answers count as wrong numbers; a hedged "closest I found was 17.8 h" is a decline, not a wrong number
  if (failure !== "wrong") wrong_numbers.length = 0;

  const why: string[] = [];
  if (!answer.trim()) why.push("no answer");
  if (q.should_abstain && !abstained) why.push("answered instead of saying it's not in the notebook");
  if (!q.should_abstain && abstained) why.push("declined to answer");
  if (numbers_missing.length) why.push(`missing/wrong number: ${numbers_missing.join("; ")}`);
  if (pairs_missing.length) why.push(`per-person counts wrong or missing: ${pairs_missing.join(", ")}`);
  if (concepts_missing.length) why.push(`missing: ${concepts_missing.join("; ")}`);
  if (invalid_ids.length) why.push(`cited ids that don't exist: ${invalid_ids.slice(0, 6).join(", ")}`);
  if (!q.should_abstain && missing_ids.length) why.push(`didn't cite ${missing_ids.join(", ")}`);
  return {
    correct,
    citations_valid,
    abstained,
    cited_ids: cited,
    invalid_ids,
    missing_ids,
    numbers_missing,
    wrong_numbers,
    concepts_missing,
    pairs_missing,
    failure,
    diagnosis: why.join(" · "),
  };
}

function normUnit(u: string): string {
  const s = u.toLowerCase().replace(/\s+/g, "");
  if (s.startsWith("pa")) return "Pa·s";
  if (s === "mpa") return "MPa";
  if (s === "%") return "%";
  if (s === "h") return "h";
  if (s === "min") return "min";
  return "";
}
