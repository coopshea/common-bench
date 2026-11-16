// "Book the degasser 2–4 pm": the lab's Ask turns a booking request into an approval card. The parse is local
// (deterministic, works offline); the roadmap version is a book_instrument tool behind the same approval gate.
import type { Instrument } from "../shared/types.ts";
import { project } from "../data/notebook.ts";
import { lab } from "./org.ts";

export interface BookingDraft { inst: Instrument; day: string; from: string; to: string }

const ALIASES: [RegExp, string][] = [
  [/printer\s*2|second printer/i, "printer-2"],
  [/dlp|printer\s*1|\bprinter\b/i, "printer-1"],
  [/degas/i, "degasser"],
  [/mixer|mix\b/i, "mixer"],
  [/balance|scale/i, "balance"],
  [/visco/i, "viscometer"],
  [/oven|post-?cure/i, "uv-oven"],
  [/test frame|tensile|instron/i, "test-frame"],
  [/imaging|micro|cross-?section/i, "imaging"],
  [/plate reader/i, "plate-reader"],
  [/hot ?plate/i, "hot-plate"],
];

const hhmm = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** One clock time; `pm` applies when the hour has no am/pm of its own and reads as afternoon. */
function clock(h: string, m: string | undefined, ap: string | undefined, fallbackAp?: string): [number, number] {
  let H = Number(h);
  const M = Number(m ?? 0);
  const a = (ap ?? fallbackAp ?? "").toLowerCase();
  if (a.startsWith("p") && H < 12) H += 12;
  if (a.startsWith("a") && H === 12) H = 0;
  if (!a && H >= 1 && H <= 7) H += 12; // "2-4" in a lab means the afternoon
  return [H, M];
}

const T = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?";
const RANGE = new RegExp(`${T}\\s*(?:-|–|—|to|until|till)\\s*${T}`, "i");
const AT = new RegExp(`\\b(?:at|from)\\s+${T}`, "i");

/** "for 30 minutes", "for 1.5 hours", "for half an hour", "for an hour" → hours. */
function hoursIn(q: string): number | null {
  if (/\bhalf\s+an?\s+hour\b/i.test(q)) return 0.5;
  if (/\bfor\s+an?\s+hour\b/i.test(q)) return 1;
  const m = /\bfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i.exec(q);
  return m ? (/^h/i.test(m[2]) ? Number(m[1]) : Number(m[1]) / 60) : null;
}

/**
 * Is this a request to book? "Book/reserve/hold …" always is. So is naming an instrument with a time
 * ("mixer 2–3 pm", "I need the oven at 3 for 30 minutes"), unless it's a question ("is the degasser free at 2?").
 */
export function isBookingRequest(q: string, instrumentOpen = false): boolean {
  if (/\b(book|reserve|hold)\b/i.test(q)) return true;
  if (/^\s*(is|are|was|were|who|when|what|which|how|does|do|did|has|have|why)\b/i.test(q)) return false;
  // With an instrument's panel open, a bare time is enough: "2–4 pm", "at 3 for 30 minutes".
  return (instrumentOpen || ALIASES.some(([re]) => re.test(q))) && (RANGE.test(q) || AT.test(q));
}

export function parseBooking(q: string, context?: Instrument): BookingDraft | null {
  if (!isBookingRequest(q, !!context)) return null;
  const id = ALIASES.find(([re]) => re.test(q))?.[1];
  const inst = (id && lab.instruments.find((i) => i.id === id)) || context;
  if (!inst) return null;
  const day = /tomorrow/i.test(q) ? "Tomorrow" : "Today";
  const range = RANGE.exec(q);
  let from: [number, number], to: [number, number];
  if (range) {
    to = clock(range[4], range[5], range[6]);
    from = clock(range[1], range[2], range[3], range[6]);
  } else {
    // The duration is taken out first, so the "30" in "at 3 for 30 minutes" is never read as a clock time.
    const at = AT.exec(q.replace(/\bfor\s+[\d.]+\s*[a-z]+/i, ""));
    const nowH = Number(project.now.slice(11, 13)) + 1;
    from = at ? clock(at[1], at[2], at[3]) : [nowH, 0];
    const end = Math.round(from[0] * 60 + from[1] + (hoursIn(q) ?? 1) * 60);
    to = [Math.floor(end / 60), end % 60];
  }
  return { inst, day, from: hhmm(...from), to: hhmm(...to) };
}
