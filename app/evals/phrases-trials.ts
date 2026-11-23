// Whole trials said out loud, run through the same rules the trial view uses (src/lib/benchApply.ts), with no
// microphone, glasses or browser. The first is what was really said in the chicken rub recording (as Whisper heard it);
// the second is a fizz foam trial with a timer, a note, measured results and a photo. Run: npm run test:phrases
import { readFileSync } from "node:fs";
import { KITCHEN } from "../src/data/chickenRub.ts";
import { applyUtterance, emptyRun, freshMemo } from "../src/lib/benchApply.ts";
import { compute } from "../src/lib/benchRun.ts";
import { answer } from "../src/lib/glassesAsk.ts";
import type { BenchProtocol } from "../src/shared/types.ts";

function say(p: BenchProtocol, params: Record<string, number>, lines: string[]) {
  let run = emptyRun(p, params), memo = freshMemo();
  const asked: string[] = [];
  lines.forEach((text, i) => {
    const at = new Date(Date.UTC(2026, 10, 22, 12, 0, i * 10)).toISOString();
    if (answer(text, p, run, null)) { asked.push(text); return; }
    ({ run, memo } = applyUtterance(p, run, text, at, memo));
  });
  return { run, asked, c: compute(p, run) };
}
let bad = 0;
const want = (name: string, got: unknown, expected: unknown) => { if (JSON.stringify(got) !== JSON.stringify(expected)) { bad++; console.log(`✕ ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(expected)}`); } };
const valuesOf = (r: { run: { entries: Record<string, { value: number }> } }) => Object.fromEntries(Object.entries(r.run.entries).map(([k, e]) => [k, e.value]));

const rubSaid = (JSON.parse(readFileSync(new URL("./fixtures/rub-said.json", import.meta.url), "utf8")) as { text: string }[]).map((x) => x.text);
const rub = say(KITCHEN["chicken-rub"], { batch_g: 10 }, rubSaid);
want("rub: values", valuesOf(rub), { salt: 4, garlic: 1.4, paprika: 1.4, coriander: 0.9, pepper: 0 });
want("rub: finished", rub.c.done, true);
want("rub: the question was answered, not recorded", rub.asked.length, 1);

const fizz = say(KITCHEN["fizz-foam"], { batch_g: 2 }, [
  "What do I do first?", "Okay, thirty one point five grams of vinegar.", "One gram of soap.", "I did two point two grams.", "Ten and a half grams of water.",
  "Peak is six and a half centimeters.", "Start.", "Note, foamed over the rim on the left side.", "It's at four centimeters now.", "Photo.",
]);
want("fizz: values", valuesOf(fizz), { vinegar: 31.5, soap: 1, soda: 2.2, water: 10.5, peak_cm: 6.5, after_cm: 4 });
want("fizz: a heavy first pour raises what follows", Math.round(fizz.c.target.soda * 100) / 100, 2.1);
want("fizz: a measured result has no target", Number.isNaN(fizz.c.target.peak_cm), true);
want("fizz: timer ran and was closed by its step", Boolean(fizz.run.timers.settle?.start && fizz.run.timers.settle?.stop), true);
want("fizz: note kept on its step", fizz.run.notes?.settle?.map((n) => n.text), ["Foamed over the rim on the left side."]);
want("fizz: photo taken, trial finished", [fizz.run.photo !== null, fizz.c.done], [true, true]);

// Things that go a little wrong at the bench.
const slips = say(KITCHEN["fizz-foam"], { batch_g: 2 }, ["30 grams", "no, 31.2", "1 gram", "redo", "0.9 grams", "two grams", "ten grams", "seven centimeters", "five centimeters", "skip the timer", "note: slow start", "photo"]);
want("slips: correction and redo", valuesOf(slips), { vinegar: 31.2, soap: 0.9, soda: 2, water: 10, peak_cm: 7, after_cm: 5 });
want("slips: timer skipped on purpose, trial finished", [Boolean(slips.run.skipped?.settle), slips.c.done], [true, true]);

console.log(`${3 - Math.min(3, bad)} / 3 spoken trials pass${bad ? ` (${bad} checks failed)` : ""}`);
process.exit(bad ? 1 : 0);
