// Bench speech: the browser's speech recognition in, a local parse to protocol fields out.
// The parse is deterministic and offline ("30.8 grams" → base = 30.8); only the recognition needs the browser's
// speech service. When that isn't available, the Bench view plays the protocol's recorded script instead.
import type { BenchField } from "../shared/types.ts";

// ---------- Recognition (Web Speech API; Chrome and Safari prefix it) ----------

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const Ctor = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
export const speechAvailable = () => Boolean(Ctor());

/** Errors that mean speech won't work here at all, so fall back to the script for the rest of the run. */
export const FATAL = new Set(["network", "not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

/** Listen for one utterance. Returns a function that cancels it. */
export function listenOnce(on: {
  interim: (text: string) => void;
  final: (text: string) => void;
  error: (code: string) => void;
  end: () => void;
}): () => void {
  const R = Ctor();
  if (!R) { on.error("unsupported"); on.end(); return () => {}; }
  const r = new R();
  r.lang = "en-US";
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      final ||= e.results[i].isFinal;
    }
    (final ? on.final : on.interim)(text.trim());
  };
  r.onerror = (e) => on.error(e.error);
  r.onend = on.end;
  r.start();
  return () => r.abort();
}

// ---------- Parse: transcript → field values ----------

const SMALL: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * Spoken numbers → digits. "thirty point eight" → "30.8", "three thousand" → "3000", "a hundred and five" → "105",
 * "one fifty" → "150", "two and a half" → "2.5", "3k" → "3000", "30,8" → "30.8".
 * Recognizers usually give digits; this covers when they don't.
 */
export function wordsToDigits(text: string): string {
  const out: string[] = [];
  // Punctuation is its own token, so "nine hundred, sodium" still reads as a number followed by a comma.
  const toks = text.toLowerCase()
    .replace(/(\d),(\d{3})\b/g, "$1$2").replace(/(\d),(\d{1,2})\b/g, "$1.$2").replace(/(\d)\s*k\b/g, "$1000")
    .replace(/-(?=[a-z])/g, " ").replace(/([,;:!?]|\.(?!\d))/g, " $1 ").split(/\s+/).filter(Boolean);
  const isNum = (t: string | undefined) => t !== undefined && (t in SMALL || t === "hundred" || t === "thousand");
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if ((t === "a" || t === "an") && (toks[i + 1] === "hundred" || toks[i + 1] === "thousand")) { i++; continue; } // "a hundred"
    if ((t === "a" || t === "an") && toks[i + 1] === "half") { out.push("0.5"); i += 2; continue; }
    if (t === "half") { out.push("0.5"); i++; continue; }
    if (!isNum(t) && t !== "point") { out.push(t); i++; continue; }
    let whole = 0, part = 0, any = false, last = -1;
    for (;;) {
      const w = toks[i];
      if (w === "and" && any && isNum(toks[i + 1]) && part > 0 && part % 100 === 0) { i++; continue; } // "a hundred and five"
      if (!isNum(w)) break;
      i++;
      any = true;
      if (w === "hundred") { part = (part || 1) * 100; last = -1; }
      else if (w === "thousand") { whole += (part || 1) * 1000; part = 0; last = -1; }
      else {
        const v = SMALL[w];
        // "one fifty" → 150, "three twenty five" → 325: a single digit followed by tens is hundreds.
        part = last >= 1 && last <= 9 && part === last && v >= 10 ? last * 100 + v : part + v;
        last = v;
      }
    }
    let num = String(whole + part);
    if (toks[i] === "point") {
      let j = i + 1, frac = "";
      while (toks[j] in SMALL && SMALL[toks[j]] < 10) frac += SMALL[toks[j++]];
      if (frac) { num = `${any ? num : "0"}.${frac}`; any = true; i = j; }
      else if (!any) { out.push("point"); i++; continue; }
    }
    if (any && toks[i] === "and" && toks[i + 1] === "a" && toks[i + 2] === "half") { num = String(Number(num) + 0.5); i += 3; } // "two and a half"
    out.push(num);
  }
  // Digits already, then "and a half": "2 and a half" → 2.5.
  return out.join(" ").replace(/\b(\d+) and 0\.5\b/g, (_, n) => String(Number(n) + 0.5)).replace(/\s+([,;:!?.])/g, "$1");
}

/** "For step 3, I added 0.4 g" names a step: returns 3 (1-based), or null. */
export const stepNamed = (text: string): number | null => {
  const m = wordsToDigits(text).match(/\bstep\s+(\d+)/i);
  return m ? Number(m[1]) : null;
};
const stripStep = (t: string) => t.replace(/\bstep\s+\d+/gi, " ");

// Units as people say them → a canonical unit, with its dimension and size, so "one liter" fills a mL field as 1000
// and "90 seconds" fills a minutes field as 1.5. A number said with a unit never lands in a field of another dimension.
const SAID: [RegExp, string][] = [
  [/^(mg|milligrams?)$/, "mg"], [/^(kg|kilos?|kilograms?)$/, "kg"], [/^(g|gs|grams?|gm|gms)$/, "g"],
  [/^(ml|mls|mils?|millilit(er|re)s?|cc|ccs)$/, "mL"], [/^(ul|µl|microlit(er|re)s?)$/, "µL"], [/^(l|lit(er|re)s?)$/, "L"],
  [/^(rpm|rpms|rpn)$/, "rpm"], [/^(min|mins|minutes?)$/, "min"], [/^(s|sec|secs|seconds?)$/, "s"], [/^(h|hr|hrs|hours?)$/, "h"],
  [/^(°c|c|degrees?|celsius|centigrade)$/, "°C"], [/^(°f|fahrenheit)$/, "°F"], [/^(%|percent|per cent)$/, "%"],
  [/^(mm|millimet(er|re)s?)$/, "mm"], [/^(cm|centimet(er|re)s?)$/, "cm"], [/^(psi)$/, "psi"], [/^(bar)$/, "bar"],
];
const DIM: Record<string, [string, number]> = {
  mg: ["mass", 0.001], g: ["mass", 1], kg: ["mass", 1000], "µL": ["vol", 0.001], uL: ["vol", 0.001], ul: ["vol", 0.001], mL: ["vol", 1], ml: ["vol", 1], L: ["vol", 1000],
  s: ["time", 1 / 60], min: ["time", 1], h: ["time", 60], mm: ["len", 1], cm: ["len", 10],
  rpm: ["rpm", 1], "°C": ["degC", 1], "°F": ["degF", 1], "%": ["pct", 1], psi: ["psi", 1], bar: ["bar", 1],
};
export const saidUnit = (word: string) => SAID.find(([re]) => re.test(word))?.[1];
/** The value in the field's unit, or null when the spoken unit can't be that field (grams into a minutes box). */
function convert(n: number, said: string, fieldUnit: string): number | null {
  const a = DIM[said], b = DIM[fieldUnit] ?? DIM[fieldUnit.toLowerCase()];
  if (!a || !b || a[0] !== b[0]) return null;
  return Math.round(((n * a[1]) / b[1]) * 1e6) / 1e6;
}

const GENERIC = new Set(["the", "and", "for", "was", "were", "with", "added", "about", "its", "got", "have", "step", "then", "amount", "value"]);
const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
/** How strongly a stretch of speech names a field: its label's words (or their stems) that were said. */
const named = (said: string[], f: BenchField) => wordsOf(`${f.label} ${f.id.replace(/_/g, " ")}`).filter((w) => said.some((x) => x === w || (x.length >= 4 && w.startsWith(x)) || (w.length >= 4 && x.startsWith(w)))).length;

// "30, no, 31.2" / "thirty, sorry, thirty one": what follows the last correction is what was meant.
const CORRECTION = /\b(?:no|nope|sorry|scratch that|i mean|actually|correction|wait|rather|make that)\b/gi;

/**
 * Assign the numbers in one utterance to a step's fields.
 * - A field named next to a number gets it: "time 2, speed 3000", "900 of water".
 * - A number said with a unit goes to a field of that kind, converted ("one liter" → 1000 mL), and never to another kind.
 * - Whatever is left fills the remaining fields in order. "Mixed at 3000 for 2 minutes" → rpm 3000, time 2.
 */
export function parseUtterance(text: string, fields: BenchField[]): { values: Record<string, number>; photo: boolean } {
  let t = stripStep(wordsToDigits(text));
  const parts = t.split(CORRECTION);
  for (let i = parts.length - 1; i > 0; i--) if (/\d/.test(parts[i])) { t = parts[i]; break; }
  const photo = /\b(photo|picture|snap|capture)\b/i.test(t);
  const hits = [...t.matchAll(/(\d*\.\d+|\d+)\s*(°\s*[cf]|%|per cent|[a-zµ]+)?/gi)];
  const nums = hits.map((m, k) => {
    const unit = m[2] ? saidUnit(m[2].toLowerCase().replace(/\s+/g, "")) : undefined;
    const before = wordsOf(t.slice(k ? hits[k - 1].index + hits[k - 1][0].length : 0, m.index));
    const after = wordsOf(t.slice(m.index + (unit ? m[0].length : m[1].length), hits[k + 1]?.index ?? t.length));
    return { n: Number(m[1]), unit, before, after };
  });
  const values: Record<string, number> = {};
  const free = [...fields];
  const put = (f: BenchField, n: number) => { values[f.id] = n; free.splice(free.indexOf(f), 1); };
  const fits = (f: BenchField, unit: string | undefined, n: number) => (unit && f.unit ? convert(n, unit, f.unit) : n);
  const rest: typeof nums = [];
  for (const x of nums) {
    const ok = free.filter((f) => fits(f, x.unit, x.n) !== null);
    const best = (said: string[]) => {
      const scored = ok.map((f) => [named(said, f), f] as const).filter(([k]) => k > 0).sort((a, b) => b[0] - a[0]);
      return scored.length && (scored.length === 1 || scored[0][0] > scored[1][0]) ? scored[0][1] : undefined;
    };
    const f = best(x.before) ?? best(x.after);
    if (f) put(f, fits(f, x.unit, x.n)!);
    else rest.push(x);
  }
  for (const x of rest) {
    // With a unit: the first free field of that kind. Without: the first free field.
    const f = free.find((g) => (x.unit ? g.unit && convert(x.n, x.unit, g.unit) !== null : true));
    if (f) put(f, fits(f, x.unit, x.n)!);
  }
  return { values, photo };
}
