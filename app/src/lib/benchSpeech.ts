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

/** "thirty point eight" → "30.8", "three thousand" → "3000". Recognizers usually give digits; this covers when they don't. */
export function wordsToDigits(text: string): string {
  const out: string[] = [];
  const toks = text.toLowerCase().replace(/-/g, " ").split(/\s+/);
  for (let i = 0; i < toks.length; ) {
    if (!(toks[i] in SMALL) && toks[i] !== "point") { out.push(toks[i++]); continue; }
    let whole = 0, part = 0, any = false;
    while (i < toks.length && (toks[i] in SMALL || toks[i] === "hundred" || toks[i] === "thousand")) {
      const t = toks[i++];
      any = true;
      if (t === "hundred") part = (part || 1) * 100;
      else if (t === "thousand") { whole += (part || 1) * 1000; part = 0; }
      else part += SMALL[t];
    }
    let num = String(whole + part);
    if (toks[i] === "point") {
      i++;
      let frac = "";
      while (i < toks.length && toks[i] in SMALL && SMALL[toks[i]] < 10) frac += SMALL[toks[i++]];
      if (frac) { num = `${any ? num : "0"}.${frac}`; any = true; }
    }
    if (any) out.push(num);
    else out.push("point");
  }
  return out.join(" ");
}

/** "For step 3, I added 0.4 g" names a step: returns 3 (1-based), or null. */
export const stepNamed = (text: string): number | null => {
  const m = wordsToDigits(text).match(/\bstep\s+(\d+)/i);
  return m ? Number(m[1]) : null;
};
const stripStep = (t: string) => t.replace(/\bstep\s+\d+/gi, " ");

const UNIT: Record<string, RegExp> = {
  g: /^(g|gs|gram|grams|gm)\b/,
  rpm: /^(rpm|rpms|rpn)\b/,
  min: /^(min|mins|minute|minutes)\b/,
};

/**
 * Assign the numbers in one utterance to a step's fields. A number followed by a unit goes to the field with
 * that unit; the rest fill the remaining fields in order. "Mixed at 3000 for 2 minutes" → rpm 3000, mix_min 2.
 */
export function parseUtterance(text: string, fields: BenchField[]): { values: Record<string, number>; photo: boolean } {
  const t = stripStep(wordsToDigits(text).replace(/,(?=\d{3}\b)/g, ""));
  const photo = /\b(photo|picture|snap|capture)\b/i.test(t);
  const nums = [...t.matchAll(/(\d*\.\d+|\d+)\s*([a-z]*)/gi)].map((m) => ({ n: Number(m[1]), unit: m[2].toLowerCase() }));
  const values: Record<string, number> = {};
  const free = [...fields];
  const rest: number[] = [];
  for (const { n, unit } of nums) {
    const i = free.findIndex((f) => UNIT[f.unit]?.test(unit));
    if (i >= 0) values[free.splice(i, 1)[0].id] = n;
    else rest.push(n);
  }
  for (const n of rest) {
    const f = free.shift();
    if (f) values[f.id] = n;
  }
  return { values, photo };
}
