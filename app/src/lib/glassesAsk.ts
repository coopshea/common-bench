// Asking the trial out loud: "what's next?", "how much paprika?", "how do I do it?", "what's left?", "read it back", "repeat".
// Answers are kept short: they are heard, not read, and the glasses' microphone hears them too.
// The answer is worked out here from the trial's own numbers (the same compute() the screen uses), never by a model,
// and is spoken through the glasses by the server. Anything that isn't a question goes on to the trial as before.
import { ASKS_HYPOTHESIS, ASKS_MOLECULES, ASKS_PREDICTION, predict } from "../shared/chem.ts";
import type { BenchField, BenchProtocol } from "../shared/types.ts";
import { TOLERANCE, compute, offBy, type RunState } from "./benchRun.ts";

const UNIT: Record<string, [string, string]> = {
  g: ["gram", "grams"], mg: ["milligram", "milligrams"], kg: ["kilogram", "kilograms"], mL: ["milliliter", "milliliters"], "µL": ["microliter", "microliters"],
  L: ["liter", "liters"], min: ["minute", "minutes"], s: ["second", "seconds"], h: ["hour", "hours"], rpm: ["r p m", "r p m"], "%": ["percent", "percent"],
  "°C": ["degree Celsius", "degrees Celsius"], "°F": ["degree Fahrenheit", "degrees Fahrenheit"], mm: ["millimeter", "millimeters"], cm: ["centimeter", "centimeters"],
};

/** A number as it should be said: 181.44 g → "181.4 grams", 3.628 g → "3.63 grams", 3000 rpm → "3000 r p m". */
export function spoken(x: number | undefined, unit: string): string {
  if (x === undefined || !Number.isFinite(x)) return "not set";
  const a = Math.abs(x);
  const n = a >= 100 ? Math.round(x * 10) / 10 : a >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100;
  const [one, many] = UNIT[unit] ?? [unit, unit];
  return `${n} ${n === 1 ? one : many}`.trim();
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
/** The field someone means by "how much paprika": the one whose name shares the most words with what was said. */
function fieldNamed(text: string, fields: BenchField[]): BenchField | undefined {
  const said = words(text);
  const scored = fields.map((f) => [words(`${f.label} ${f.id.replace(/_/g, " ")}`).filter((w) => said.some((x) => x === w || (x.length >= 4 && (w.startsWith(x) || x.startsWith(w))))).length, f] as const)
    .filter(([k]) => k > 0).sort((a, b) => b[0] - a[0]);
  return scored.length && (scored.length === 1 || scored[0][0] > scored[1][0]) ? scored[0][1] : undefined;
}

/** One step, said aloud. Short by default (the title and how much); `full` adds the instructions. */
function sayStep(p: BenchProtocol, i: number, target: Record<string, number>, full = false): string {
  const st = p.steps[i];
  const one = st.fields.length === 1 ? st.fields[0] : undefined;
  const aim = (f: BenchField) => (f.result ? "say the reading" : spoken(target[f.id], f.unit));
  const head = `Step ${i + 1} of ${p.steps.length}. ${st.title}${one ? `: ${aim(one)}` : ""}`;
  const amounts = one ? "" : st.fields.map((f) => `${f.label}: ${aim(f)}`).join(". ");
  const what = full || !st.fields.length ? st.detail.filter((d) => !/^say\b/i.test(d)).join(". ") : "";
  const timer = st.timer_min ? `Then ${spoken(st.timer_min, "min")} on the timer` : "";
  const end = st.photo ? "Then take the photo" : ""; // not "say done": heard back through the microphone, that word would finish the step
  return [head, what, amounts, timer, end].filter(Boolean).join(". ") + ".";
}

const NEXT = /\b(what(?:'s| is| are| do| should| shall| am)?\b.{0,24}\b(next|now|to do|i do|doing|step)|next step|where am i|which step|what step)\b/;
const HOW_MUCH = /\bhow (much|many)\b|\bwhat(?:'s| is) the (target|amount)\b/;
const LEFT = /\b(what(?:'s| is)? (left|remaining)|how (much|many) (more|steps)|what else)\b/;
const BACK = /\b(read (it|that|them|everything) back|what (did|have) i (record|recorded|got|get|put|add|added|enter|entered)|what do i have|what(?:'s| is) recorded)\b/;
const HOW = /\b(how do i|how should i|how to|details?|instructions?|walk me through|explain)\b/;
const REPEAT = /^\W*(repeat|say (that|it) again|again|come again|what was that|pardon)\W*$/;

/**
 * The spoken answer to a question about the trial, or null when what was said isn't a question (a value, "done",
 * a note…), in which case it belongs to the trial itself.
 */
export function answer(text: string, p: BenchProtocol, run: RunState, last: string | null): string | null {
  const t = text.toLowerCase().replace(/[’`]/g, "'").trim();
  if (REPEAT.test(t)) return last ?? "Nothing to repeat yet.";
  const c = compute(p, run);
  const fields = p.steps.flatMap((x) => x.fields);
  const todo = p.steps.map((_, i) => i).filter((i) => !c.stepDone(i));

  // The chemistry, asked for out loud. A recording's overlay draws the picture; this is what is said.
  if (p.reaction) {
    const amount = (id: string) => run.entries[id]?.value ?? c.target[id];
    const pr = predict(amount(p.reaction.base), amount(p.reaction.acid), p.reaction.acid_frac);
    const weighed = Boolean(run.entries[p.reaction.base] && run.entries[p.reaction.acid]);
    const first = pr.limiting === "acid" ? "The vinegar runs out first" : pr.limiting === "base" ? "The baking soda runs out first" : "Neither is left over";
    if (ASKS_PREDICTION.test(t)) return `About ${spoken(Math.round(pr.co2_l * 10) / 10, "L")} of carbon dioxide, from ${weighed ? "what you weighed" : "the amounts in the SOP"}. ${first}.`;
    // Only a hypothesis that names the hydrogen (or proton) going to the carbonate side is confirmed; anything else is
    // answered with the mechanism, not agreed with.
    const right = /\b(hydrogen|proton|h plus)\b/.test(t) && /\b(bicarbonate|carbonate|baking soda|soda|base)\b/.test(t);
    if (ASKS_HYPOTHESIS.test(t) && !right) return `I can't confirm that one. What is known: the hydrogen on acetic acid's O H goes to an oxygen on the bicarbonate, making carbonic acid, which falls apart into water and carbon dioxide.`;
    if (ASKS_HYPOTHESIS.test(t)) return `That matches the mechanism. The hydrogen on acetic acid's O H hops to an oxygen on the bicarbonate. That makes carbonic acid, which falls apart into water and carbon dioxide. Expect about ${spoken(Math.round(pr.co2_l * 10) / 10, "L")} of gas.`;
    if (ASKS_MOLECULES.test(t)) return "Acetic acid and bicarbonate, coloured by electronegativity. Oxygen pulls electrons hardest, so the hydrogen on the acid's O H is the one that can leave.";
  }
  if (BACK.test(t)) {
    const got = fields.filter((f) => run.entries[f.id]).map((f) => `${f.label}: ${spoken(run.entries[f.id].value, f.unit)}`);
    return got.length ? `Recorded so far. ${got.join(". ")}.` : "Nothing is recorded yet.";
  }
  if (LEFT.test(t) && !fieldNamed(t, fields)) {
    if (!todo.length) return "Nothing. The trial is finished.";
    const list = todo.map((i) => { const st = p.steps[i]; const f = st.fields[0]; return f && !f.result ? `${f.label}, ${spoken(c.target[f.id], f.unit)}` : st.title; });
    return `${todo.length} ${todo.length === 1 ? "step" : "steps"} left. ${list.join(". ")}.`;
  }
  if (HOW_MUCH.test(t)) {
    const f = fieldNamed(t, fields) ?? (c.done ? undefined : p.steps[c.current].fields.find((x) => !run.entries[x.id]) ?? p.steps[c.current].fields[0]);
    if (!f) return c.done ? "The trial is finished." : "This step has no amount to weigh.";
    const e = run.entries[f.id];
    if (f.result) return e ? `${f.label}: you recorded ${spoken(e.value, f.unit)}.` : `${f.label} is measured: say the reading.`;
    return e ? `${f.label}: you recorded ${spoken(e.value, f.unit)}. The target was ${spoken(c.target[f.id], f.unit)}.` : `${f.label}: ${spoken(c.target[f.id], f.unit)}.`;
  }
  if (HOW.test(t)) return c.done ? "The trial is finished." : sayStep(p, c.current, c.target, true);
  if (NEXT.test(t)) return c.done ? "The trial is finished." : sayStep(p, c.current, c.target);
  return null;
}

/**
 * What to say after a value was recorded by voice: the value back (so a mishearing is caught without looking),
 * how far off it was if that matters, the new batch if this was the weighing that set it, and what comes next.
 */
export function confirmation(id: string, p: BenchProtocol, run: RunState): string | null {
  const fields = p.steps.flatMap((x) => x.fields);
  const f = fields.find((x) => x.id === id), e = run.entries[id];
  if (!f || !e) return null;
  const c = compute(p, run);
  const parts = [`${f.label}, ${spoken(e.value, f.unit)}`];
  const off = offBy(e.value, c.target[id]);
  if (off !== null && Math.abs(off) > TOLERANCE) parts.push(`${Math.round(Math.abs(off) * 100)} percent ${off > 0 ? "over" : "under"}`);
  const anchor = fields.find((x) => x.scales && run.entries[x.id]);
  const batch = run.params.batch_g ?? p.params.find((x) => x.id === "batch_g")?.value;
  if (anchor?.id === id && batch !== undefined && Math.abs(c.k - 1) > 0.005) parts.push(`Batch now ${spoken(batch * c.k, "g")}`);
  if (c.held(id)) {
    // Outside what the SOP accepts: the trial stays on this step, and says what to do about it in the unit on the scale.
    const by = Math.round(Math.abs(e.value - c.target[id]) * 10) / 10, over = e.value > c.target[id];
    parts.length = 1; // the percentage is dropped: the amount to move is what the hands need
    parts.push(over ? `${spoken(by, f.unit)} over. Take ${spoken(by, f.unit)} out and say the new reading, or say accept` : `${spoken(by, f.unit)} short. Add ${spoken(by, f.unit)} and say the new reading, or say accept`);
  } else if (c.done) parts.push("All done");
  else {
    const st = p.steps[c.current], nf = st.fields.find((x) => !run.entries[x.id]);
    const timer = st.timer_min && !run.timers[st.id] && !run.skipped?.[st.id] ? ` Say start for the ${spoken(st.timer_min, "min")} timer` : "";
    parts.push(nf && !nf.result ? `Next, ${nf.label}: ${spoken(c.target[nf.id], nf.unit)}` : `Next: ${st.title}.${timer}`.replace(/\.$/, ""));
  }
  return parts.join(". ") + ".";
}
