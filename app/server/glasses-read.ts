// What the scale showed when a value was said: a second witness to each spoken number.
//
//   npm run read-scale                 the latest recording
//   npm run read-scale -- <id>         that one
//
// For each recorded value (derived/segments.json, from npm run reprocess) a few frames from the seconds before the
// sentence are shown to Claude, which is asked only what the display reads. It is never told what was said: the
// point is that the two can disagree. Writes derived/readings.json and one cropped picture per value in
// derived/readings/. A display that can't be read (a hand in the way, glare, out of frame) is written down as that.
//
// Checked on the chicken rub recording only. A reading is the camera's, not the record: the spoken value stays the
// value, and a mismatch is something to look at, not a correction.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const ROOT = fileURLToPath(new URL("../recordings", import.meta.url));
const MODEL = process.env.GLASSES_MODEL ?? "claude-sonnet-5-5";
const which = (bin: string) => ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", ...(process.env.PATH ?? "").split(":")].map((d) => join(d, bin)).find((p) => existsSync(p));
const FFMPEG = which("ffmpeg");
/** Seconds before the first word of the sentence: the look at the display comes before the saying. */
const LOOKS = [-3, -2, -1, -0.3];

const Reading = z.object({
  readable: z.boolean().describe("True only if the digits on a scale or instrument display can actually be read in at least one frame."),
  frame: z.number().int().describe("Which frame (1-based) the reading is taken from: the latest one where the display is clear. 0 when not readable."),
  value: z.number().nullable().describe("The number on the display exactly as shown. Null when not readable."),
  unit: z.string().describe("The unit shown on or beside the display, or empty."),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable().describe("Where the display is in that frame, as fractions of the frame's width and height (x, y of the top-left corner). Null when not readable."),
  why: z.string().describe("When not readable, what is in the way, 8 words at most. Empty otherwise."),
});
/** Does the display agree with what was said? To the display's own precision: 4.0 on the scale agrees with "four grams". */
export const agreesWith = (said: number, seen: number) => Math.abs(seen - said) <= Math.max(0.05, Math.abs(said) * 0.02) + 1e-9;
/** The display's box with room around it, kept inside the frame: fractions of the frame (x, y, w, h). */
export function cropBox(box: { x: number; y: number; w: number; h: number }, pad = 0.6) {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const bx = clamp(box.x, 0, 1), by = clamp(box.y, 0, 1), bw = clamp(box.w, 0, 1 - bx), bh = clamp(box.h, 0, 1 - by);
  const w = clamp(bw * (1 + 2 * pad), 0.05, 1), h = clamp(Math.max(bh * (1 + 2 * pad), w * 0.5), 0.05, 1);
  return { x: clamp(bx + bw / 2 - w / 2, 0, 1 - w), y: clamp(by + bh / 2 - h / 2, 0, 1 - h), w, h };
}
export interface ScaleReading { step: number; label: string; said: number; unit: string; at: number; readable: boolean; value: number | null; seen_unit: string; agrees: boolean | null; crop: string | null; strip: string | null; why: string }

interface Segment { step: number; values: { label: string; value: number; unit: string; at: number; said_from?: number }[] }

export async function readScale(id: string, say: (s: string) => void = () => {}): Promise<ScaleReading[]> {
  if (!FFMPEG) throw new Error("ffmpeg isn't installed");
  const dir = join(ROOT, id);
  const segFile = join(dir, "derived", "segments.json");
  if (!existsSync(segFile)) throw new Error("run npm run reprocess on this recording first");
  const segs = JSON.parse(readFileSync(segFile, "utf8")) as Segment[];
  const meta = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as { parts?: { n: number; t0: number }[] };
  const parts = readdirSync(dir).filter((f) => /^video-\d+\.mp4$/.test(f)).sort().map((f) => { const n = Number(f.match(/\d+/)![0]); return { file: join(dir, f), t0: meta.parts?.find((p) => p.n === n)?.t0 ?? statSync(join(dir, f)).birthtimeMs }; });
  if (!parts.length) throw new Error("this recording has no video");
  const out = join(dir, "derived", "readings");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const frameAt = (at: number, size: string): Buffer | null => {
    const p = [...parts].reverse().find((x) => at >= x.t0) ?? parts[0];
    const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-ss", Math.max(0, (at - p.t0) / 1000).toFixed(2), "-i", p.file, "-frames:v", "1", "-vf", size, "-q:v", "3", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 26 });
    return r.status === 0 && r.stdout.length > 1000 ? r.stdout : null;
  };
  const client = new Anthropic();
  const readings: ScaleReading[] = [];
  for (const s of segs) for (const v of s.values) {
    if (!/^(g|mg|kg|oz|lb)$/i.test(v.unit)) continue; // a height off a ruler isn't on the scale's display
    const from = v.said_from ?? v.at - 2500;
    const times = LOOKS.map((d) => from + d * 1000);
    const shots = times.map((t) => frameAt(t, "scale=1280:-2")).filter((b): b is Buffer => b !== null);
    const base: ScaleReading = { step: s.step, label: v.label, said: v.value, unit: v.unit, at: v.at, readable: false, value: null, seen_unit: "", agrees: null, crop: null, strip: null, why: "no frame" };
    if (!shots.length) { readings.push(base); continue; }
    try {
      const res = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 2048,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: "You read instrument displays in first-person video frames from a lab bench or kitchen. Report only digits you can actually see on a display (a kitchen or lab scale, a timer, a thermometer). Never infer a number from context, from labels on containers, or from what seems likely. If the display is blocked, blurred, too small or out of frame in every frame, say it is not readable.",
        messages: [{ role: "user", content: [
          ...shots.flatMap((jpg, i) => [{ type: "text" as const, text: `Frame ${i + 1}:` }, { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: jpg.toString("base64") } }]),
          { type: "text" as const, text: `These ${shots.length} frames are in time order, about a second apart. What does the scale's display read in the latest frame where it is clear?` },
        ] }],
        output_config: { effort: "low", format: zodOutputFormat(Reading) },
      });
      const r = res.stop_reason === "refusal" ? null : res.parsed_output;
      if (!r || !r.readable || r.value == null) {
        // Not read: the frames themselves are kept side by side, small, so a person can still look.
        const stem = `${String(readings.length + 1).padStart(2, "0")}-step${s.step}`;
        const small = times.map((t) => frameAt(t, "scale=640:-2")).filter((b): b is Buffer => b !== null);
        small.forEach((b, n) => writeFileSync(join(out, `.n${n}.jpg`), b));
        const made = small.length > 1 ? spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...small.flatMap((_, n) => ["-i", join(out, `.n${n}.jpg`)]), "-filter_complex", `hstack=inputs=${small.length}`, "-q:v", "4", join(out, `${stem}-strip.jpg`)]) : null;
        small.forEach((_, n) => rmSync(join(out, `.n${n}.jpg`), { force: true }));
        readings.push({ ...base, strip: made?.status === 0 ? `${stem}-strip.jpg` : null, why: r?.why || "not readable" }); say(`  ${v.label}: said ${v.value} ${v.unit} · display not readable${r?.why ? ` (${r.why})` : ""}`);
        continue;
      }
      // The display, cut out of the frame it was read from, with some room around it; and the same cut from every
      // frame that was looked at, side by side, so a person can check the reading against its neighbours.
      let crop: string | null = null, strip: string | null = null;
      const k = Math.min(Math.max(1, r.frame), shots.length) - 1;
      const stem = `${String(readings.length + 1).padStart(2, "0")}-step${s.step}`;
      if (r.box && r.box.w > 0.01 && r.box.h > 0.01) {
        const c = cropBox(r.box);
        const cut = `crop=iw*${c.w.toFixed(4)}:ih*${c.h.toFixed(4)}:iw*${c.x.toFixed(4)}:ih*${c.y.toFixed(4)},scale=480:240:force_original_aspect_ratio=decrease,pad=480:240:(ow-iw)/2:(oh-ih)/2`;
        const jpg = frameAt(times[k], cut);
        if (jpg) { crop = `${stem}.jpg`; writeFileSync(join(out, crop), jpg); }
      }
      // The glasses move with the head, so the display is somewhere else in each neighbouring frame: those are kept
      // whole, side by side, for a person to check the reading against.
      const whole = times.map((t) => frameAt(t, "scale=640:-2")).filter((b): b is Buffer => b !== null);
      if (whole.length > 1) {
        whole.forEach((b, n) => writeFileSync(join(out, `.n${n}.jpg`), b));
        const made = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...whole.flatMap((_, n) => ["-i", join(out, `.n${n}.jpg`)]), "-filter_complex", `hstack=inputs=${whole.length}`, "-q:v", "3", join(out, `${stem}-strip.jpg`)]);
        whole.forEach((_, n) => rmSync(join(out, `.n${n}.jpg`), { force: true }));
        if (made.status === 0) strip = `${stem}-strip.jpg`;
      }
      const agrees = agreesWith(v.value, r.value);
      readings.push({ ...base, readable: true, value: r.value, seen_unit: r.unit, agrees, crop, strip, why: "" });
      say(`  ${v.label}: said ${v.value} ${v.unit} · display ${r.value}${r.unit ? ` ${r.unit}` : ""} · ${agrees ? "agrees" : "DIFFERS"}`);
    } catch (e) {
      const why = e instanceof Anthropic.AuthenticationError ? "the API key was rejected" : e instanceof Anthropic.RateLimitError ? "rate limited" : e instanceof Anthropic.APIError ? `API error ${e.status ?? ""}`.trim() : e instanceof Error ? e.message : String(e);
      readings.push({ ...base, why });
      say(`  ${v.label}: could not ask (${why})`);
    }
  }
  writeFileSync(join(dir, "derived", "readings.json"), JSON.stringify(readings, null, 2));
  return readings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const id = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, "derived", "segments.json"))).map((d) => d.name).sort().pop();
  if (!id) { console.error("No reprocessed recording yet."); process.exit(1); }
  console.log(`${id} · what the display showed`);
  try {
    const r = await readScale(id, console.log);
    const read = r.filter((x) => x.readable);
    console.log(`${read.length} of ${r.length} displays read; ${read.filter((x) => x.agrees).length} agree with what was said${read.some((x) => !x.agrees) ? `, ${read.filter((x) => !x.agrees).length} differ` : ""}.`);
  } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); }
}
