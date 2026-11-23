// The glasses pipeline's own rules, checked with no glasses, microphone, browser, speech model or API key:
// cutting sound into sentences, telling our own replies from the person, what a spoken sentence does to a trial,
// what the SOP works out from recorded values, which footage a video keeps, whether a display agrees with what was
// said, what a replay is given, what a hosted copy serves, and publishing a replay to one. Run: npm run test:glasses
//
// Not covered here, because they need the real thing: Whisper's hearing (npm run reprocess on a recording checks it
// against the live log), the camera log and the display reader (both ask Claude), and the glasses themselves.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { KITCHEN } from "../src/data/chickenRub.ts";
import { applyUtterance, emptyRun, freshMemo, type Did } from "../src/lib/benchApply.ts";
import { compute } from "../src/lib/benchRun.ts";
import { evaluate } from "../src/shared/calc.ts";
import type { BenchProtocol } from "../src/shared/types.ts";
import { placeReplies, planPieces } from "../server/glasses-export.ts";
import { agreesWith, cropBox } from "../server/glasses-read.ts";
import { placeOf, publishRecording, publishedLinks, publishedRoutes, unpublishRecording } from "../server/glasses-publish.ts";
import { replayRoutes, type ReplayData } from "../server/glasses-replay.ts";
import { NOT_SPEECH, isEchoOf, sentences, speechHint, wav, wordsOf } from "../server/glasses-speech.ts";
import { hostedGlasses, importPage } from "../server/kitchen-import.ts";

let pass = 0, fail = 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function want(name: string, got: unknown, expected: unknown) {
  if (same(got, expected)) pass++; else { fail++; console.log(`✕ ${name}\n    got      ${JSON.stringify(got)}\n    expected ${JSON.stringify(expected)}`); }
}
const near = (name: string, got: number, expected: number, tol = 1e-6) => want(name, Math.abs(got - expected) <= tol ? expected : got, expected);
const section = (s: string) => console.log(`· ${s}`);

// ---------- Cutting sound into sentences ----------
section("sentences");
const RATE = 16000;
/** 16-bit mono sound: `loud` seconds of a tone, or quiet (a little room noise). */
const tone = (seconds: number, amp = 6000) => { const b = Buffer.alloc(Math.round(seconds * RATE) * 2); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(amp * Math.sin(i * 0.3)), i * 2); return b; };
const quiet = (seconds: number, amp = 40) => { const b = Buffer.alloc(Math.round(seconds * RATE) * 2); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(amp * Math.sin(i * 1.7)), i * 2); return b; };
const cut = (pcm: Buffer, chunk = 32000) => { const out: { s: number; end: number }[] = []; const feed = sentences((p, end) => out.push({ s: p.length / 32000, end: end / 32000 })); for (let i = 0; i < pcm.length; i += chunk) feed(pcm.subarray(i, i + chunk)); return out; };

want("silence gives nothing", cut(quiet(5)).length, 0);
want("no sound at all gives nothing", cut(Buffer.alloc(0)).length, 0);
want("one sentence", cut(Buffer.concat([quiet(1), tone(2), quiet(1)])).length, 1);
want("a sentence still open at the end is not given", cut(Buffer.concat([quiet(1), tone(2)])).length, 0);
want("...until quiet follows", cut(Buffer.concat([quiet(1), tone(2), quiet(0.7)])).length, 1);
want("a pause of 0.3 s stays one sentence", cut(Buffer.concat([quiet(1), tone(1), quiet(0.3), tone(1), quiet(1)])).length, 1);
want("a pause of 0.9 s makes two", cut(Buffer.concat([quiet(1), tone(1), quiet(0.9), tone(1), quiet(1)])).length, 2);
want("a tick (30 ms) is not a sentence", cut(Buffer.concat([quiet(1), tone(0.03), quiet(1)])).length, 0);
// Known and left alone: a click of 60 ms or more is long enough to be passed on. Whisper writes "[BLANK_AUDIO]" or
// similar for it, which NOT_SPEECH then drops (see "not speech" below).
want("a click (90 ms) is passed on for Whisper to reject", cut(Buffer.concat([quiet(1), tone(0.09), quiet(1)])).length, 1);
want("a short word (0.4 s) is kept", cut(Buffer.concat([quiet(1), tone(0.4), quiet(1)])).length, 1);
{
  const one = cut(Buffer.concat([quiet(1), tone(2), quiet(1)]))[0];
  want("the sentence keeps a little before its first sound and its closing quiet", one.s > 2.5 && one.s < 3.2, true);
  want("its end is where the quiet was long enough", one.end > 3.5 && one.end < 3.8, true);
}
want("talking without a break is cut at 20 s", cut(Buffer.concat([quiet(1), tone(45), quiet(1)])).length >= 2, true);
want("the longest piece is 20 s", Math.max(...cut(Buffer.concat([quiet(1), tone(45), quiet(1)])).map((x) => x.s)) <= 20.05, true);
{
  const pcm = Buffer.concat([quiet(1), tone(1.5), quiet(1), tone(0.8), quiet(1.2), tone(2), quiet(1)]);
  const whole = cut(pcm, pcm.length), odd = cut(pcm, 777), tiny = cut(pcm, 2);
  want("three sentences", whole.length, 3);
  want("however the sound arrives, the cut is the same (odd chunks)", odd, whole);
  want("...and two bytes at a time", tiny, whole);
}
want("a steady loud room is not speech", cut(Buffer.concat([quiet(30, 300), quiet(5, 320)])).length, 0);
want("speech over a noisy room is still found", cut(Buffer.concat([quiet(10, 250), tone(2, 8000), quiet(2, 250)])).length, 1);
{
  const w = wav(tone(1));
  want("wav: header says 16 kHz mono 16-bit", [w.toString("ascii", 0, 4), w.readUInt32LE(24), w.readUInt16LE(22), w.readUInt16LE(34), w.readUInt32LE(40)], ["RIFF", 16000, 1, 16, 32000]);
  want("wav: empty sound is a header alone", wav(Buffer.alloc(0)).length, 44);
}

section("not speech");
for (const t of ["[BLANK_AUDIO]", "(clinking)", "Thank you.", "thank you", "Thanks for watching!", "you", "...", "."]) want(`"${t}" is not speech`, NOT_SPEECH.test(t), true);
for (const t of ["Thank you, 4 grams.", "Start.", "Photo.", "4.5", "No.", "Note, it foamed over."]) want(`"${t}" is speech`, NOT_SPEECH.test(t), false);
want("the hint names the SOP's steps", speechHint({ sop: "Fizz", trial: "1", current: 0, steps: [{ title: "Weigh the vinegar", detail: [] }] }).includes("Weigh the vinegar"), true);
want("the hint works with no SOP", speechHint(null).startsWith("Lab bench notes."), true);
want("the hint does not end on a command word (Whisper would drop a spoken one)", /(start|stop|done|photo|note)\W*$/i.test(speechHint(null)), false);

// ---------- Our own replies, heard back ----------
section("echo");
const reply = (text: string, start = 10_000, ms = 4000) => [{ text, start, end: start + ms }];
const timer = reply("Peak foam, 6.5 centimeters. Next: Wait, then read again. Say start for the 1 minute timer.");
want("the whole reply coming back is echo", isEchoOf("Peak foam, 6.5 centimeters. Next, wait, then read again.", 11_000, timer), true);
want("most of a reply, misheard, is echo", isEchoOf("Say start for the one minute timer", 12_500, timer), true);
want("\"Start.\" after \"Say start for the timer\" is the person", isEchoOf("Start.", 14_800, timer), false);
want("...even said over the end of the reply", isEchoOf("Start.", 13_000, timer), false);
const photo = reply("Foam after 1 min, 4 centimeters. Next: Photo.");
want("\"Photo.\" while \"Next: Photo.\" plays is echo", isEchoOf("Photo.", 13_500, photo), true);
want("\"Photo.\" two seconds after it ends is the person", isEchoOf("Photo.", 16_000, photo), false);
want("\"Take a photo\" is never the reply", isEchoOf("Take a photo.", 13_500, photo), false);
const salt = reply("Step 1 of 5. Weigh the salt: 4.5 grams.");
want("a value sharing loose words is the person", isEchoOf("Salt, 5 grams.", 12_000, salt), false);
want("a different number is the person", isEchoOf("4 grams of salt", 12_000, salt), false);
want("the same few words in order are echo", isEchoOf("4.5 grams", 12_000, salt), true);
want("long after the reply, the same words are the person", isEchoOf("Weigh the salt 4.5 grams", 30_000, salt), false);
want("well before the reply started, they are the person", isEchoOf("Weigh the salt 4.5 grams", 5_000, salt), false);
want("a sentence that ends just as the reply starts still counts by its end", isEchoOf("Weigh the salt 4.5 grams", 8_000, salt, 9_800), true);
want("nothing said back yet: never echo", isEchoOf("Start.", 1000, []), false);
want("an empty sentence is not echo", isEchoOf("  ...  ", 12_000, salt), false);
want("\"Done.\" while a reply that says \"Done.\" plays is echo", isEchoOf("Done.", 11_000, reply("Mix. Done. Trial finished.")), true);
want("words: decimals kept, percent spelled, punctuation dropped", wordsOf("Salt: 4.5 g, 7% over."), ["salt", "4.5", "g", "7", "percent", "over"]);

// ---------- What a spoken sentence does to a trial ----------
section("trial rules");
const fizz: BenchProtocol = KITCHEN["fizz-foam"], rub: BenchProtocol = KITCHEN["chicken-rub"];
function say(p: BenchProtocol, lines: string[], params: Record<string, number> = {}, gapS = 10) {
  let run = emptyRun(p, params), memo = freshMemo();
  const did: Did[][] = [];
  lines.forEach((text, i) => { const r = applyUtterance(p, run, text, new Date(Date.UTC(2026, 10, 22, 12, 0, i * gapS)).toISOString(), memo); run = r.run; memo = r.memo; did.push(r.did); });
  return { run, memo, did, kinds: did.map((d) => d.map((x) => x.kind).join("+")), c: compute(p, run), values: Object.fromEntries(Object.entries(run.entries).map(([k, e]) => [k, e.value])) };
}
want("the two kitchen SOPs exist", [Boolean(fizz), Boolean(rub)], [true, true]);
{
  const r = say(fizz, ["31.5 grams of vinegar", "one gram of soap", "I did 2.2 grams", "ten and a half grams of water", "peak is 6.5 centimeters", "start", "note, foamed over the rim", "it's at four centimeters now", "photo"], { batch_g: 2 });
  want("fizz: every value, in order", r.values, { vinegar: 31.5, soap: 1, soda: 2.2, water: 10.5, peak_cm: 6.5, after_cm: 4 });
  want("fizz: what each sentence did", r.kinds, ["values", "values", "values", "values", "values", "timer_start", "note", "values", "photo"]);
  want("fizz: finished", r.c.done, true);
  want("fizz: the note is on the waiting step", r.run.notes?.settle?.map((n) => n.text), ["Foamed over the rim"]);
  want("fizz: reading the foam stops the timer", Boolean(r.run.timers.settle?.stop), true);
  want("fizz: results have no target", [Number.isNaN(r.c.target.peak_cm), Number.isNaN(r.c.target.after_cm)], [true, true]);
}
{
  const r = say(fizz, ["31.5 grams", "one gram", "2.2 grams", "10.5 grams", "6.5 centimeters", "4 centimeters"], { batch_g: 2 });
  want("fizz: without \"start\" the waiting step is not finished", r.c.done, false);
  want("...but the reading is kept", r.values.after_cm, 4);
  const s = say(fizz, ["31.5 grams", "one gram", "2.2 grams", "10.5 grams", "6.5 centimeters", "skip the timer", "4 centimeters", "take a photo"], { batch_g: 2 });
  want("fizz: \"skip the timer\" lets it finish", [s.kinds[5], s.c.done], ["skip", true]);
}
{
  const r = say(rub, ["4 grams", "no, 4.2 grams"]);
  want("a correction replaces the value just recorded", r.values, { salt: 4.2 });
  want("...and the trial has moved on one step only", r.c.current, 1);
  const u = say(rub, ["4 grams", "redo", "3.9 grams"]);
  want("\"redo\" then a number re-records the same field", [u.kinds, u.values], [["values", "redo", "values"], { salt: 3.9 }]);
  const n = say(rub, ["nope"]);
  want("\"nope\" with nothing recorded does nothing", [n.kinds, n.values], [["missed"], {}]);
}
{
  const r = say(rub, ["4 grams", "yes"]);
  want("\"yes\" confirms what is waiting", [r.kinds[1], r.run.entries.salt.ok], ["confirm", true]);
  want("a spoken value starts unconfirmed", say(rub, ["4 grams"]).run.entries.salt.ok, false);
}
want("words for numbers: \"four and a half grams\"", say(rub, ["four and a half grams"]).values, { salt: 4.5 });
want("\"zero grams\" records a zero (left out)", say(rub, ["zero grams"]).values, { salt: 0 });
want("chatter records nothing", say(rub, ["okay so now I'm going to open the salt"]).kinds, ["missed"]);
want("an empty sentence records nothing", say(rub, [""]).values, {});
want("a note needs no value and does not move the trial on", [say(rub, ["note: the scale drifted"]).kinds, say(rub, ["note: the scale drifted"]).c.current], [["note"], 0]);
want("\"Note that ...\" drops the lead-in and capitalises", say(rub, ["note that the lid was loose"]).run.notes?.[rub.steps[0].id]?.[0].text, "The lid was loose");
want("\"photo\" on a step with no photo does nothing", say(rub, ["photo"]).kinds, ["missed"]);
want("\"start\" on a step with no timer does nothing", say(rub, ["start"]).kinds, ["missed"]);
{
  const done = say(fizz, ["31.5 grams", "one gram", "2.2 grams", "10.5 grams", "6.5 centimeters", "skip the timer", "4 centimeters", "photo", "five grams"], { batch_g: 2 });
  want("after the trial is finished, a number changes nothing", [done.kinds[8], done.values.vinegar], ["missed", 31.5]);
  const late = say(fizz, ["31.5 grams", "one gram", "2.2 grams", "10.5 grams", "6.5 centimeters", "skip the timer", "4 centimeters", "photo", "note, cleaned up"], { batch_g: 2 });
  want("...but a note is still taken", late.kinds[8], "note");
}
{
  const r = say(fizz, ["start"]);
  want("\"start\" before the timer's step does not start it", [r.kinds, Object.keys(r.run.timers)], [["missed"], []]);
  const t = say(fizz, ["31.5 grams", "one gram", "2.2 grams", "10.5 grams", "6.5 centimeters", "start", "start"], { batch_g: 2 });
  want("\"start\" twice starts one timer", t.kinds.slice(5), ["timer_start", "missed"]);
}

// ---------- Acceptance: a value outside it holds the step ----------
section("acceptance");
want("the fizz SOP accepts 10% or one gram", fizz.accept, { pct: 10, abs: 1 });
want("the rub has no acceptance: any value moves on", say(rub, ["9 grams"]).c.current, 1);
{
  // Default batch: 4 g soda, so 60 g vinegar, 2 g soap, 20 g water.
  want("the aims at the default batch", [compute(fizz, emptyRun(fizz)).target.vinegar, compute(fizz, emptyRun(fizz)).target.soap], [60, 2]);
  want("on the aim: moves on", say(fizz, ["60 grams"]).c.current, 1);
  want("9% over: moves on", say(fizz, ["65.4 grams"]).c.current, 1);
  want("exactly 10% over: moves on", say(fizz, ["66 grams"]).c.current, 1);
  want("12% over: held on the step", say(fizz, ["67.5 grams"]).c.current, 0);
  want("...and the value is still written down", say(fizz, ["67.5 grams"]).values, { vinegar: 67.5 });
  want("12% under: held", say(fizz, ["52.5 grams"]).c.current, 0);
  want("said again within range: moves on, the new value kept", [say(fizz, ["75 grams", "61 grams"]).c.current, say(fizz, ["75 grams", "61 grams"]).values], [1, { vinegar: 61 }]);
  want("\"accept\" keeps the value and moves on", [say(fizz, ["75 grams", "accept"]).c.current, say(fizz, ["75 grams", "accept"]).values, say(fizz, ["75 grams", "accept"]).run.entries.vinegar.ok], [1, { vinegar: 75 }, true]);
  want("\"keep it\" does too", say(fizz, ["75 grams", "keep it"]).c.current, 1);
  want("a passing \"okay\" does not accept a held value", say(fizz, ["75 grams", "okay"]).c.current, 0);
  want("...nor \"yes\"", say(fizz, ["75 grams", "yes"]).c.current, 0);
  want("\"redo\" on a held value waits for it again", say(fizz, ["75 grams", "redo", "60 grams"]).values, { vinegar: 60 });
  want("a note while held is taken and the step stays", [say(fizz, ["75 grams", "note, poured too fast"]).kinds[1], say(fizz, ["75 grams", "note, poured too fast"]).c.current], ["note", 0]);
  // After 60 g of vinegar the batch is unchanged: soap aims at 2 g, where one gram either way is inside the scale's step.
  want("small amounts: within one gram is accepted (1 g against 2)", say(fizz, ["60 grams", "1 gram"]).c.current, 2);
  want("...three grams too", say(fizz, ["60 grams", "3 grams"]).c.current, 2);
  want("...but four grams is held", say(fizz, ["60 grams", "4 grams"]).c.current, 1);
  want("zero when two were wanted is held (left out by mistake)", say(fizz, ["60 grams", "zero grams"]).c.current, 1);
  // An accepted heavy first pour rescales the batch, and what follows is judged against the new aims.
  const heavy = say(fizz, ["75 grams", "accept", "2.5 grams"]);
  want("an accepted heavy pour raises what follows (soap now aims at 2.5 g)", [Math.round(heavy.c.target.soap * 100) / 100, heavy.c.current], [2.5, 2]);
  want("a measured result is never held", say(fizz, ["60 grams", "2 grams", "4 grams", "20 grams", "99 centimeters"]).c.current, 5);
  const all = say(fizz, ["60 grams", "2 grams", "4 grams", "20 grams", "12 centimeters", "start", "5 centimeters", "photo"]);
  want("a whole trial on the aims finishes with nothing held", [all.c.done, Object.keys(all.values).filter((k) => all.c.held(k))], [true, []]);
}

// ---------- What the SOP works out ----------
section("calculated");
const calc = Object.fromEntries((fizz.calc ?? []).map((k) => [k.id, k.formula]));
near("2.2 g of soda can make 0.63 L of CO₂", evaluate(calc.co2_l, { soda: 2.2, vinegar: 31.5 }), 2.2 / 84.01 * 24, 1e-9);
near("31.5 g of 5% vinegar is exactly enough for 2.2 g of soda", Math.round(evaluate(calc.acid_x, { soda: 2.2, vinegar: 31.5 }) * 100) / 100, 1);
want("half the vinegar is half enough", Math.round(evaluate(calc.acid_x, { soda: 2.2, vinegar: 15.75 }) * 100) / 100, 0.5);
want("no soda: the ratio is not a number to show", Number.isFinite(evaluate(calc.acid_x, { soda: 0, vinegar: 30 })), false);
{
  let threw = false;
  try { evaluate(calc.co2_l, { vinegar: 30 }); } catch { threw = true; }
  want("a value that wasn't recorded is an error, not a zero", threw, true);
}
want("every fizz step but the photo says why", fizz.steps.filter((s) => !s.why).map((s) => s.id), ["photo"]);
want("the two foam heights are results", fizz.steps.flatMap((s) => s.fields).filter((f) => f.result).map((f) => f.id), ["peak_cm", "after_cm"]);

// ---------- Which footage a video keeps ----------
section("export plan");
const one = [{ t0: 1000, seconds: 60 }];
want("no cut: the whole part", planPieces(one, [[5000, 9000]], false), [{ part: 0, a: 1000, b: 61000, window: 0 }]);
want("cut with nothing to keep: the whole part", planPieces(one, [], true), [{ part: 0, a: 1000, b: 61000, window: 0 }]);
want("cut: each window", planPieces(one, [[5000, 9000], [20000, 26000]], true), [{ part: 0, a: 5000, b: 9000, window: 0 }, { part: 0, a: 20000, b: 26000, window: 1 }]);
want("a window before the video starts is trimmed to it", planPieces(one, [[0, 3000]], true), [{ part: 0, a: 1000, b: 3000, window: 0 }]);
want("a window past the end is trimmed", planPieces(one, [[59000, 99000]], true), [{ part: 0, a: 59000, b: 61000, window: 0 }]);
want("a window wholly outside is dropped", planPieces(one, [[70000, 80000]], true), []);
want("a sliver under a fifth of a second is dropped", planPieces(one, [[60900, 70000]], true), []);
const two = [{ t0: 1000, seconds: 10 }, { t0: 15000, seconds: 10 }];
want("a window across a reconnect becomes two pieces of the same window", planPieces(two, [[9000, 17000]], true), [{ part: 0, a: 9000, b: 11000, window: 0 }, { part: 1, a: 15000, b: 17000, window: 0 }]);
want("a window in the gap between parts is dropped", planPieces(two, [[11500, 14500]], true), []);
want("no cut over two parts: both, whole", planPieces(two, [], false).map((p) => [p.part, p.b - p.a]), [[0, 10000], [1, 10000]]);
want("no video: nothing", planPieces([], [[0, 1]], true), []);

{
  const kept = [{ a: 5000, b: 9000 }, { a: 20000, b: 26000 }];
  want("an answer in the first kept stretch lands where it was said", placeReplies(kept, [6000]), [[0, 1000]]);
  want("one in the second lands after the first's length", placeReplies(kept, [21000]), [[0, 5000]]);
  want("one said in footage that was cut away is left out", placeReplies(kept, [12000]), []);
  want("each keeps its own place in the list", placeReplies(kept, [1000, 8999, 9000, 25999]), [[1, 3999], [3, 9999]]);
  want("no answers, or no footage: nothing", [placeReplies(kept, []), placeReplies([], [6000])], [[], []]);
}

// ---------- Does the display agree ----------
section("display");
want("4.0 on the scale agrees with four", agreesWith(4, 4.0), true);
want("1.4 against 1.5 does not", agreesWith(1.4, 1.5), false);
want("said zero, scale shows 0.9: does not", agreesWith(0, 0.9), false);
want("zero against zero agrees", agreesWith(0, 0), true);
want("31.5 against 31.46 agrees (the scale's last digit)", agreesWith(31.5, 31.46), true);
want("100 against 101 agrees (within 2%)", agreesWith(100, 101), true);
want("100 against 103 does not", agreesWith(100, 103), false);
want("0.05 apart on a small number agrees", agreesWith(0.9, 0.95), true);
{
  const inside = (b: { x: number; y: number; w: number; h: number }) => b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9;
  want("crop: a box in the middle stays inside the frame", inside(cropBox({ x: 0.4, y: 0.6, w: 0.1, h: 0.05 })), true);
  want("crop: has room around the display", cropBox({ x: 0.4, y: 0.6, w: 0.1, h: 0.05 }).w > 0.1, true);
  want("crop: a box in the corner stays inside", inside(cropBox({ x: 0.95, y: 0.97, w: 0.05, h: 0.03 })), true);
  want("crop: a box hanging off the frame is pulled in", inside(cropBox({ x: 0.9, y: -0.2, w: 0.4, h: 0.5 })), true);
  want("crop: a box bigger than the frame is the frame", cropBox({ x: 0, y: 0, w: 3, h: 3 }), { x: 0, y: 0, w: 1, h: 1 });
  want("crop: a speck still gives something to look at", cropBox({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }).w >= 0.05, true);
}

// ---------- What a replay is given ----------
section("replay data");
const root = mkdtempSync(join(os.tmpdir(), "cb-suite-"));
const T0 = Date.UTC(2026, 10, 22, 20, 0, 0);
function recording(id: string, o: { sop?: BenchProtocol; trial?: string; startedMs?: number; entries?: Record<string, number>; log?: object[]; derivedLog?: object[]; derivedEntries?: Record<string, number>; session?: boolean; readings?: object[] }) {
  const dir = join(root, id);
  mkdirSync(join(dir, "derived"), { recursive: true });
  const started = new Date(o.startedMs ?? T0).toISOString();
  writeFileSync(join(dir, "log.jsonl"), (o.log ?? [{ id: "a", at: started, source: "voice", text: "four grams" }]).map((e) => JSON.stringify(e)).join("\n"));
  if (o.session !== false) writeFileSync(join(dir, "session.json"), JSON.stringify({ id, started, ended: started, parts: [], context: o.sop ? { sop: o.sop.title, trial: o.trial ?? "1", steps: o.sop.steps.map((s) => ({ title: s.title, detail: s.detail })), current: 0, protocol: o.sop } : null }));
  if (o.entries) writeFileSync(join(dir, "trial.json"), JSON.stringify({ entries: Object.fromEntries(Object.entries(o.entries).map(([k, value]) => [k, { value }])) }));
  if (o.derivedLog) writeFileSync(join(dir, "derived", "log.jsonl"), o.derivedLog.map((e) => JSON.stringify(e)).join("\n"));
  if (o.derivedEntries) writeFileSync(join(dir, "derived", "trial.json"), JSON.stringify({ entries: Object.fromEntries(Object.entries(o.derivedEntries).map(([k, value]) => [k, { value }])) }));
  if (o.readings) writeFileSync(join(dir, "derived", "readings.json"), JSON.stringify(o.readings));
}
const full = { vinegar: 31.5, soap: 1, soda: 2.2, water: 10.5, peak_cm: 6.5, after_cm: 4 };
recording("r1", { sop: fizz, trial: "1", startedMs: T0, entries: { ...full, soap: 0.5, peak_cm: 4 } });
recording("r2", { sop: fizz, trial: "2", startedMs: T0 + 600_000, entries: full, readings: [{ step: 1, said: 31.5, readable: true, value: 31.5, seen_unit: "g", agrees: true, crop: "01-step1.jpg", why: "" }] });
recording("r3", { sop: fizz, trial: "3", startedMs: T0 + 1_200_000, entries: { ...full, peak_cm: 9 } });
recording("old", { sop: fizz, trial: "0", startedMs: T0 - 3 * 24 * 3600_000, entries: full });
recording("other", { sop: rub, trial: "9", startedMs: T0 + 300_000, entries: { salt: 4 } });
recording("empty", { sop: fizz, trial: "x", startedMs: T0 + 100_000 });
recording("nosop", { startedMs: T0 + 200_000, entries: { soda: 2 } });
recording("partial", { sop: fizz, trial: "p", startedMs: T0 + 2_000_000, entries: { vinegar: 30 } });
recording("silent", { sop: fizz, trial: "s", startedMs: T0 + 2_400_000, log: [{ id: "a", at: new Date(T0).toISOString(), source: "system", text: "Recording started" }], derivedLog: [{ id: "b", at: new Date(T0).toISOString(), source: "value", text: "Soda 2 g", data: { step: 2, value: 2 } }], derivedEntries: { soda: 2, vinegar: 30 }, entries: {} });
recording("nometa", { session: false });
mkdirSync(join(root, "not-a-recording"));
const app = replayRoutes(root, undefined, () => false);
const data = async (id: string, q = "") => { const r = await app.request(`/recordings/${id}/data${q}`); return { status: r.status, d: r.status === 200 ? ((await r.json()) as ReplayData) : null }; };
{
  const { d } = await data("r2");
  want("calculated values come from this trial's own numbers", d!.calc.map((k) => [k.unit, Math.round(k.value * 100) / 100]), [["L", 0.63], ["×", 1]]);
  want("the session is this SOP's trials up to this one, oldest first", d!.series.map((t) => t.trial), ["1", "2"]);
  want("...with their own values", d!.series.map((t) => t.values.peak_cm), [4, 6.5]);
  want("readings come along", d!.readings.map((r) => [r.step, r.value, r.agrees]), [[1, 31.5, true]]);
  want("the live log is the one shown", d!.derived, false);
}
{
  const { d } = await data("r3");
  want("the last trial sees all three; not the rub, the empty one, or one from days ago", d!.series.map((t) => t.trial), ["1", "2", "3"]);
  want("no readings file: none", d!.readings, []);
}
want("the first trial is a session of one", (await data("r1")).d!.series.map((t) => t.trial), ["1"]);
want("a trial with one value: what can't be worked out is left off", (await data("partial")).d!.calc, []);
want("a recording with no SOP: nothing calculated, no session", [(await data("nosop")).d!.calc, (await data("nosop")).d!.series], [[], []]);
want("no session file: still opens, with no SOP", [(await data("nometa")).status, (await data("nometa")).d!.context], [200, null]);
{
  const { d } = await data("silent");
  want("a live log that caught nothing falls back to the rebuilt one", [d!.derived, d!.events.length], [true, 1]);
  want("...and to its values", Math.round(d!.calc[0].value * 100) / 100, 0.57);
  want("?derived=1 asks for the rebuilt log outright", (await data("r2", "?derived=1")).d!.derived, false); // r2 has none: stays live
}
want("an unknown recording is a 404", (await data("nope")).status, 404);
want("a folder that isn't a recording is a 404", (await data("not-a-recording")).status, 404);
want("a path that climbs out is refused", (await app.request("/recordings/..%2F..%2Fetc/data")).status, 404);
want("a reading picture that isn't there is a 404", (await app.request("/recordings/r2/readings/01-step1.jpg")).status, 404);
want("a reading name that climbs out is refused", (await app.request("/recordings/r2/readings/..%2Flog.jsonl")).status, 404);
want("a moment picture that isn't there is a 404", (await app.request("/recordings/r2/moments/x.jpg")).status, 404);
want("a video part that doesn't exist is a 404", (await app.request("/recordings/r2/video/001")).status, 404);

// ---------- Publishing a replay to a hosted copy ----------
section("published");
{
  const KEY = "suite-publish-key", TO = "https://hosted.example";
  const pub = mkdtempSync(join(os.tmpdir(), "cb-pub-"));
  const hosted = publishedRoutes(pub, KEY);
  const send = (path: string, init?: RequestInit) => Promise.resolve(hosted.request(path, init));
  const h = { "x-publish-key": KEY };
  const NAME = "A".repeat(22);
  const put = (path: string, body: BodyInit = "x", headers: Record<string, string> = h) => hosted.request(`/publish/${path}`, { method: "PUT", headers, body });
  // What a real recording has beside its log: a video part and pictures.
  const video = Buffer.from(Array.from({ length: 1000 }, (_, n) => n % 251));
  for (const [rel, body] of [["video-001.mp4", video], ["frames/000001.jpg", Buffer.from("frame")], ["derived/moments/m1.jpg", Buffer.from("moment")], ["derived/readings/01-step1.jpg", Buffer.from("reading")], ["frames/notes.txt", Buffer.from("no")]] as const) {
    mkdirSync(join(root, "r2", rel, ".."), { recursive: true });
    writeFileSync(join(root, "r2", rel), body);
  }
  const tree = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(join(d, e.name)).map((x) => `${e.name}/${x}`) : [e.name])).sort();
  const before = tree(join(root, "r2"));

  want("sending needs the key", (await put(`${NAME}/data.json`, "{}", {})).status, 401);
  want("...the right one", (await put(`${NAME}/data.json`, "{}", { "x-publish-key": "suite-publish-kez" })).status, 401);
  want("listing needs the key", (await hosted.request(`/publish/${NAME}`)).status, 401);
  want("removing needs the key", (await hosted.request(`/publish/${NAME}`, { method: "DELETE" })).status, 401);
  want("with no key set, nothing can be sent", (await publishedRoutes(pub, undefined).request(`/publish/${NAME}/data.json`, { method: "PUT", headers: h, body: "{}" })).status, 404);
  want("a short name is refused", (await put("abc/data.json")).status, 400);
  want("a name that climbs out is refused", [(await put("..%2F..%2Fescape-escape-escape/data.json")).status, (await put(`${"A".repeat(20)}%2F../data.json`)).status].every((x) => x === 400 || x === 404), true);
  want("only a replay's files are taken", ["log.jsonl", "session.json", "../x.json", "frames/../../x.jpg", "frames/a.txt", "data.json/x", "replay-001.mp4.part", "derived/readings/..%2F..%2Fdata.json", ".env"].map((f) => placeOf(f) !== null), Array(9).fill(false));
  want("...and they are", ["data.json", "data-derived-extra.json", "replay-001.mp4", "frames/000012.jpg", "derived/moments/a-1.jpg", "derived/readings/01-step1.jpg"].map((f) => placeOf(f) !== null), Array(6).fill(true));
  want("a file that isn't a replay's is refused over the wire", [(await put(`${NAME}/log.jsonl`)).status, (await put(`${NAME}/frames/..%2F..%2F..%2Fx.jpg`)).status, (await put(`${NAME}/frames/%2e%2e/%2e%2e/x.jpg`)).status].every((x) => x === 400 || x === 404), true);
  want("nothing was written by any of that", tree(pub), []);
  {
    const r = await put(`${NAME}/frames/1.jpg?offset=5`, "late");
    want("a piece out of order is told where to pick up", [r.status, ((await r.json()) as { have: number }).have], [409, 0]);
    want("a bad offset is refused", (await put(`${NAME}/frames/1.jpg?offset=-1`)).status, 400);
    want("a picture too large is refused", (await put(`${NAME}/frames/1.jpg`, new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]))).status, 413);
    await put(`${NAME}/frames/1.jpg`, "half");
    want("a half-sent copy has no link yet", [(await hosted.request(`/replay/${NAME}`)).status, (await hosted.request(`/recordings/${NAME}/data`)).status, (await hosted.request(`/recordings/${NAME}/frames/1.jpg`)).status], [404, 404, 404]);
    rmSync(join(pub, NAME), { recursive: true, force: true });
  }

  const said: string[] = [];
  const first = await publishRecording({ root, id: "r2", to: TO, key: KEY, send, chunk: 300, say: (x) => said.push(x) });
  const name = first.token;
  want("the link ends in a long random name", [first.url === `${TO}/api/glasses/replay/${name}`, /^[A-Za-z0-9_-]{22}$/.test(name)], [true, true]);
  want("with no ffmpeg it says the video went as written", said.length, 1);
  want("the page opens at the link", [(await hosted.request(`/replay/${name}`)).status, (await hosted.request(`/replay/${name}`)).headers.get("content-type")?.includes("text/html")], [200, true]);
  want("...and asks not to be indexed or named to other sites", [(await hosted.request(`/replay/${name}`)).headers.get("x-robots-tag"), (await hosted.request(`/recordings/${name}/data`)).headers.get("referrer-policy")], ["noindex, nofollow", "no-referrer"]);
  {
    const there = (await (await hosted.request(`/recordings/${name}/data`)).json()) as ReplayData, here = (await data("r2")).d!;
    want("its data is what the bench computer shows", there, here);
    want("...with the session's other trials worked out before sending", there.series.map((t) => t.trial), ["1", "2"]);
    want("?derived=1 and ?extra=1 are answered too", [(await hosted.request(`/recordings/${name}/data?derived=1`)).status, (await hosted.request(`/recordings/${name}/data?extra=1&derived=1`)).status], [200, 200]);
  }
  {
    const whole = await hosted.request(`/recordings/${name}/video/001`);
    want("the video arrives whole, sent in pieces", [whole.status, Buffer.from(await whole.arrayBuffer()).equals(video)], [200, true]);
    const some = await hosted.request(`/recordings/${name}/video/001`, { headers: { range: "bytes=10-19" } });
    want("...and can be jumped around in", [some.status, some.headers.get("content-range"), Buffer.from(await some.arrayBuffer()).equals(video.subarray(10, 20))], [206, "bytes 10-19/1000", true]);
    want("a part that wasn't sent is a 404", (await hosted.request(`/recordings/${name}/video/002`)).status, 404);
  }
  want("the pictures arrive", await Promise.all(["frames/000001.jpg", "moments/m1.jpg", "readings/01-step1.jpg"].map(async (f) => (await (await hosted.request(`/recordings/${name}/${f}`)).text()))), ["frame", "moment", "reading"]);
  want("only what the page uses was copied", tree(join(pub, name)), ["data-derived-extra.json", "data-derived.json", "data-extra.json", "data.json", "derived/moments/m1.jpg", "derived/readings/01-step1.jpg", "frames/000001.jpg", "replay-001.mp4"]);
  want("the recording itself is untouched", tree(join(root, "r2")), before);
  want("the recording's own id is not a link", [(await hosted.request("/replay/r2")).status, (await hosted.request("/recordings/r2/data")).status], [404, 404]);
  want("there is no latest and no list", [(await hosted.request("/replay")).status, (await hosted.request("/recordings")).status, (await hosted.request("/publish", { headers: h })).status], [404, 404, 404]);
  want("a wrong name is a 404", [(await hosted.request(`/replay/${"B".repeat(22)}`)).status, (await hosted.request(`/recordings/${"B".repeat(22)}/video/001`)).status], [404, 404]);
  want("a name that climbs out is a 404", [(await hosted.request("/recordings/..%2F..%2Fetc/data")).status, (await hosted.request(`/recordings/${name}/readings/..%2F..%2Fdata.json`)).status, (await hosted.request(`/recordings/${name}/frames/..%2Fdata.json`)).status], [404, 404, 404]);

  const again = await publishRecording({ root, id: "r2", to: TO, key: KEY, send, chunk: 300 });
  want("publishing again keeps the link and skips what is there", [again.token === name, again.skipped, again.sent], [true, 4, 4]);
  const other = await publishRecording({ root, id: "r3", to: TO, key: KEY, send });
  want("another recording gets another name", other.token !== name, true);
  want("one copy doesn't name the other", [JSON.stringify(await (await hosted.request(`/recordings/${name}/data`)).json()).includes(other.token), JSON.stringify(await (await hosted.request(`/recordings/${other.token}/data`)).json()).includes(name)], [false, false]);
  want("this computer remembers its links", publishedLinks(root).map((l) => [l.id, l.url]), [["r2", first.url], ["r3", other.url]]);
  want("the wrong key is said plainly", await publishRecording({ root, id: "r1", to: TO, key: "wrong", send }).then(() => "sent", (e: Error) => e.message), "The hosted copy refused the publish key.");
  want("an unknown recording can't be published", await publishRecording({ root, id: "../r2", to: TO, key: KEY, send }).then(() => "sent", (e: Error) => e.message), "No such recording.");
  {
    const small = publishedRoutes(mkdtempSync(join(os.tmpdir(), "cb-pub-small-")), KEY, 500);
    want("a full store refuses more", await publishRecording({ root, id: "r2", to: "https://small.example", key: KEY, send: (p, i) => Promise.resolve(small.request(p, i)) }).then(() => "sent", (e: Error) => e.message.includes("size limit")), true);
  }
  want("removing takes the link down", [await unpublishRecording({ root, id: "r2", to: TO, key: KEY, send }), (await hosted.request(`/replay/${name}`)).status, (await hosted.request(`/recordings/${name}/video/001`)).status, existsSync(join(pub, name))], [true, 404, 404, false]);
  want("...and only that one", [(await hosted.request(`/replay/${other.token}`)).status, await unpublishRecording({ root, id: "r2", to: TO, key: KEY, send })], [200, false]);
  rmSync(pub, { recursive: true, force: true });
}
rmSync(root, { recursive: true, force: true });

// ---------- A hosted copy ----------
section("hosted copy");
want("the fizz SOP can be added", importPage("fizz-foam").status, 200);
want("...and the rub", importPage("chicken-rub").status, 200);
want("an unknown SOP is a 404 that names the real ones", [importPage("nope").status, importPage("nope").body.includes("fizz-foam")], [404, true]);
want("the page can't be broken out of by a \"<\" in an SOP", /const p = [^\n]*<\/?script/i.test(importPage("fizz-foam").body), false);
want("hosted: import is served", (await hostedGlasses.request("/import/fizz-foam")).status, 200);
want("hosted: there is no glasses state", (await hostedGlasses.request("/state")).status, 404);
want("hosted: no recordings to list", (await hostedGlasses.request("/recordings")).status, 404);
want("hosted: nothing can be started", (await hostedGlasses.request("/start", { method: "POST" })).status, 404);
want("hosted: the phone can't report in", (await hostedGlasses.request("/device/poll", { method: "POST" })).status, 404);

console.log(`${pass} / ${pass + fail} glasses checks pass`);
process.exit(fail ? 1 : 0);
