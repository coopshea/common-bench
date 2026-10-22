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

export function parseBooking(q: string, context?: Instrument): BookingDraft | null {
  if (!/\b(book|reserve|hold)\b/i.test(q)) return null;
  const id = ALIASES.find(([re]) => re.test(q))?.[1];
  const inst = (id && lab.instruments.find((i) => i.id === id)) || context;
  if (!inst) return null;
  const day = /tomorrow/i.test(q) ? "Tomorrow" : "Today";
  const T = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?";
  const range = new RegExp(`${T}\\s*(?:-|–|—|to|until)\\s*${T}`, "i").exec(q);
  let from: [number, number], to: [number, number];
  if (range) {
    to = clock(range[4], range[5], range[6]);
    from = clock(range[1], range[2], range[3], range[6]);
  } else {
    const at = new RegExp(`at\\s+${T}`, "i").exec(q);
    const hrs = /for\s+(\d+(?:\.\d+)?)\s*(?:h|hour)/i.exec(q);
    const nowH = Number(project.now.slice(11, 13)) + 1;
    from = at ? clock(at[1], at[2], at[3]) : [nowH, 0];
    const dur = hrs ? Number(hrs[1]) : 1;
    const end = from[0] * 60 + from[1] + dur * 60;
    to = [Math.floor(end / 60), end % 60];
  }
  return { inst, day, from: hhmm(...from), to: hhmm(...to) };
}
