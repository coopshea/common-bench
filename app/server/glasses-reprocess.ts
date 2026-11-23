// Work through a recording again from its own folder: the video's clock, the speech, what was said turned into
// values, when each step ran, and a frame for every measurement. Nothing here needs the glasses, the browser or the
// network, so the same recording gives the same answer every time, and each stage can be checked on its own.
//
//   npm run reprocess                         the latest recording
//   npm run reprocess -- <recording id>       that one
//   npm run reprocess -- --video clip.mov --sop fizz-foam [--started 2026-11-22T19:30:00] [--trial 2]
//                                             any video (a phone's, say) becomes a recording first
//   options: --sop <id>  --set batch_g=10  --fresh (transcribe again)  --no-frames  --json
//
// What it reads:  recordings/<id>/session.json, log.jsonl, video-NNN.mp4
// What it writes: recordings/<id>/derived/  speech.json      what Whisper heard, sentence by sentence, with times
//                                           log.jsonl        the log rebuilt from the video alone (voice, value, step, mark)
//                                           segments.json    each step: start, end, values, what the camera saw
//                                           moments/         one frame per measurement, taken as the value was said
//                                           report.json      the checks below
// The live log is never changed. Open the replay with ?derived to see the rebuilt one on the video.
//
// Stages, in order, each with its own checks: clock → speech → values → steps → frames.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KITCHEN } from "../src/data/chickenRub.ts";
import { applyUtterance, emptyRun, freshMemo, type Did } from "../src/lib/benchApply.ts";
import { TOLERANCE, compute, offBy, type RunState } from "../src/lib/benchRun.ts";
import { answer } from "../src/lib/glassesAsk.ts";
import { NOT_SPEECH, WHISPER_ARGS, sentences, speechHint, wav, inOrder, isEchoOf, wordsOf } from "./glasses-speech.ts";
import { evaluate } from "../src/shared/calc.ts";
import type { GlassesContext, GlassesEvent, GlassesValue } from "../src/shared/glasses.ts";
import type { BenchProtocol } from "../src/shared/types.ts";

const ROOT = fileURLToPath(new URL("../recordings/", import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const opts = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const VALUED = new Set(["sop", "set", "video", "started", "trial"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && VALUED.has(args[i - 1].slice(2))));

const which = (bin: string) => { const r = spawnSync("which", [bin], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
const FFMPEG = which("ffmpeg"), FFPROBE = which("ffprobe"), WHISPER = which("whisper-server");
const portOpen = (port: number) => new Promise<boolean>((res) => { const c = net.connect(port, "127.0.0.1"); c.once("connect", () => { c.destroy(); res(true); }); c.once("error", () => res(false)); });
const freePort = () => new Promise<number>((res, no) => { const srv = net.createServer(); srv.once("error", no); srv.listen(0, "127.0.0.1", () => { const port = (srv.address() as net.AddressInfo).port; srv.close(() => res(port)); }); });
const MODEL = process.env.GLASSES_WHISPER_MODEL && existsSync(process.env.GLASSES_WHISPER_MODEL) ? process.env.GLASSES_WHISPER_MODEL : null;
const run = (bin: string, a: string[]) => spawnSync(bin, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const iso = (ms: number) => new Date(ms).toISOString();
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 100) / 10); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- The report: every check says what it looked at ----------

type Level = "ok" | "warn" | "fail";
const checks: { stage: string; level: Level; text: string }[] = [];
const check = (stage: string, level: Level, text: string) => { checks.push({ stage, level, text }); };

// ---------- Any video → a recording ----------

function importVideo(file: string): string {
  if (!FFMPEG || !FFPROBE) throw new Error("ffmpeg and ffprobe are needed (brew install ffmpeg)");
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const sop = opt("sop") ? KITCHEN[opt("sop")!] : undefined;
  if (opt("sop") && !sop) throw new Error(`No SOP called ${opt("sop")}. There are: ${Object.keys(KITCHEN).join(", ")}`);
  const probe = JSON.parse(run(FFPROBE, ["-v", "error", "-show_entries", "format=duration:format_tags=creation_time", "-of", "json", file]).stdout || "{}") as { format?: { duration?: string; tags?: { creation_time?: string } } };
  const dur = Number(probe.format?.duration ?? 0) * 1000;
  // When the first picture was taken: said outright, or the camera's own stamp, or the file's time less its length.
  const said = opt("started"), tag = probe.format?.tags?.creation_time;
  const t0 = said ? Date.parse(said) : tag ? Date.parse(tag) : statSync(file).mtimeMs - dur;
  if (!Number.isFinite(t0)) throw new Error(`Couldn't read --started ${said}`);
  const id = iso(t0).replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(ROOT, id);
  if (existsSync(dir)) throw new Error(`recordings/${id} is already there (the same start time). Reprocess it by id, or pass another --started.`);
  mkdirSync(dir, { recursive: true });
  const r = run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", join(dir, "video-001.mp4")]);
  if (r.status !== 0) { rmSync(dir, { recursive: true, force: true }); throw new Error(`ffmpeg couldn't read ${basename(file)}: ${r.stderr.trim().split("\n").pop()}`); }
  const context: GlassesContext | null = sop ? { sop: sop.title, trial: opt("trial") ?? "", steps: sop.steps.map((s) => ({ title: s.title, detail: s.detail })), current: null, protocol: sop, params: paramsFromFlags() } : null;
  writeFileSync(join(dir, "session.json"), JSON.stringify({ id, started: iso(t0), ended: iso(t0 + dur), parts: [{ n: 1, t0: Math.round(t0) }], imported: { from: basename(file), clock: said ? "given" : tag ? "the file's own stamp" : "the file's modified time" }, context }, null, 2));
  writeFileSync(join(dir, "log.jsonl"), `${JSON.stringify({ id: "import00", at: iso(t0), source: "system", text: `Imported from ${basename(file)}` })}\n`);
  return id;
}
function paramsFromFlags(): Record<string, number> {
  return Object.fromEntries(opts("set").map((kv) => { const [k, v] = kv.split("="); if (!k || !Number.isFinite(Number(v))) throw new Error(`--set wants name=number, got ${kv}`); return [k, Number(v)]; }));
}

// ---------- Stage 1: clock ----------

interface Part { n: number; t0: number; file: string; dur: number; audio: boolean }
function clock(dir: string, meta: Meta, live: GlassesEvent[]): Part[] {
  const files = readdirSync(dir).filter((f) => /^video-\d+\.mp4$/.test(f)).sort();
  if (!files.length) { check("clock", "fail", "No video in this recording."); return []; }
  if (!FFMPEG || !FFPROBE) { check("clock", "fail", "ffmpeg and ffprobe are needed (brew install ffmpeg)."); return []; }
  const parts = files.map((f): Part => {
    const n = Number(f.match(/\d+/)![0]), nnn = String(n).padStart(3, "0");
    // The recording is written in pieces that survive a crash; an ordinary MP4 beside it is what can be seeked in.
    const src = join(dir, f), play = join(dir, `replay-${nnn}.mp4`);
    if (!existsSync(play) || statSync(play).mtimeMs < statSync(src).mtimeMs) run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-c", "copy", "-movflags", "+faststart", play]);
    const file = existsSync(play) ? play : src;
    const p = JSON.parse(run(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file]).stdout || "{}") as { format?: { duration?: string }; streams?: { codec_type: string }[] };
    const stored = meta.parts?.find((x) => x.n === n)?.t0;
    if (stored == null) check("clock", "warn", `Part ${n}: no start time was written down, so the file's creation time is used. A copied file loses it.`);
    return { n, t0: stored ?? statSync(src).birthtimeMs, file, dur: Number(p.format?.duration ?? 0) * 1000, audio: Boolean(p.streams?.some((s) => s.codec_type === "audio")) };
  });
  const first = parts[0], last = parts[parts.length - 1];
  const lead = first.t0 - Date.parse(meta.started);
  check("clock", lead >= -2000 && lead < 60_000 ? "ok" : "fail", `Video starts ${(lead / 1000).toFixed(1)} s after the recording was started${lead < -2000 || lead >= 60_000 ? ": the clock is off, so nothing will line up" : ""}.`);
  if (meta.ended) {
    const tail = Date.parse(meta.ended) - (last.t0 + last.dur);
    check("clock", Math.abs(tail) < 5000 ? "ok" : "warn", `Video ends ${Math.abs(tail / 1000).toFixed(1)} s ${tail >= 0 ? "before" : "after"} the recording was stopped.`);
  }
  const timed = live.filter((e) => e.source !== "system");
  const outside = timed.filter((e) => !parts.some((p) => Date.parse(e.at) >= p.t0 - 1000 && Date.parse(e.at) <= p.t0 + p.dur + 1000));
  if (timed.length) check("clock", outside.length ? "warn" : "ok", outside.length ? `${outside.length} of ${timed.length} log lines fall outside the video.` : `All ${timed.length} log lines fall inside the video.`);
  if (parts.some((p) => !p.audio)) check("clock", "fail", "The video has no sound, so nothing said can be read from it.");
  return parts;
}

// ---------- Stage 2: speech ----------

interface Utterance { from: number; to: number; text: string; echo?: boolean }
async function speech(dir: string, parts: Part[], ctx: GlassesContext | null, live: GlassesEvent[]): Promise<Utterance[]> {
  const cache = join(dir, "derived", "speech.json");
  let out: Utterance[] = [];
  const stale = flag("fresh") || !existsSync(cache) || parts.some((p) => statSync(cache).mtimeMs < statSync(p.file).mtimeMs);
  if (!stale) out = (JSON.parse(readFileSync(cache, "utf8")) as Utterance[]).map(({ from, to, text }) => ({ from, to, text }));
  else {
    if (!WHISPER || !MODEL) { check("speech", "fail", "Speech needs whisper-server (brew install whisper-cpp) and GLASSES_WHISPER_MODEL in .env.local."); return []; }
    // The same way as live: the sound is cut into sentences by loudness, and each one is read on its own.
    // (Whisper given a whole recording at once repeats itself through the quiet stretches.)
    const port = await freePort();
    const server = spawn(WHISPER, WHISPER_ARGS(MODEL, port), { stdio: "ignore" });
    try {
      let up = false;
      for (let i = 0; i < 120 && !up; i++) { up = await portOpen(port); if (!up) await new Promise((r) => setTimeout(r, 250)); }
      if (!up) { check("speech", "fail", "The Whisper server didn't start."); return []; }
      for (const p of parts.filter((x) => x.audio)) {
        const pcm = spawnSync(FFMPEG!, ["-hide_banner", "-loglevel", "error", "-i", p.file, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"], { maxBuffer: 1024 * 1024 * 1024 }).stdout as Buffer;
        const cut: { pcm: Buffer; end: number }[] = [];
        const feed = sentences((x, end) => cut.push({ pcm: x, end }));
        for (let i = 0; i < pcm.length; i += 32_000) feed(pcm.subarray(i, i + 32_000));
        feed(Buffer.alloc(32_000 * 2)); // two seconds of quiet, so a sentence still open at the end is closed
        for (const c of cut) {
          const form = new FormData();
          form.append("file", new Blob([new Uint8Array(wav(c.pcm))], { type: "audio/wav" }), "said.wav");
          form.append("response_format", "json");
          form.append("temperature", "0.0");
          form.append("prompt", speechHint(ctx));
          const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
          const text = (((await res.json()) as { text?: string }).text ?? "").replace(/\s+/g, " ").trim();
          // 32 bytes a millisecond. The cut keeps 0.3 s before the first word and 0.6 s of quiet after the last.
          const to = p.t0 + c.end / 32 - 600, from = p.t0 + (c.end - c.pcm.length) / 32 + 300;
          if (text && !NOT_SPEECH.test(text)) out.push({ from: Math.round(from), to: Math.round(Math.max(from, to)), text });
        }
      }
    } finally { server.kill(); }
    writeFileSync(cache, JSON.stringify(out, null, 2));
  }
  // What was said back through the speaker is heard by the microphone too: a sentence that is a reply's own words,
  // while that reply was playing or just after, is its echo.
  const replies = live.filter((e) => e.source === "reply").map((e) => ({ text: e.text, start: Date.parse(e.at), end: Date.parse(e.at) + 600 + e.text.length * 75 }));
  for (const u of out) {
    u.echo = isEchoOf(u.text, u.from, replies, u.to);
  }
  const mine = out.filter((u) => !u.echo);
  check("speech", mine.length ? "ok" : "fail", `${mine.length} sentences heard${out.length > mine.length ? `, and ${out.length - mine.length} that were the replies coming back through the microphone` : ""}.`);
  // Against what was heard live: the same sentences, give or take.
  const liveVoice = live.filter((e) => e.source === "voice");
  if (liveVoice.length) {
    const found = liveVoice.filter((e) => mine.some((u) => Math.abs(u.to - Date.parse(e.at)) < 6000 && inOrder(wordsOf(e.text), wordsOf(u.text)) / Math.max(1, wordsOf(e.text).length) >= 0.6));
    check("speech", found.length === liveVoice.length ? "ok" : "warn", `${found.length} of the ${liveVoice.length} sentences heard live are in the new transcript.`);
  }
  return out;
}

// ---------- Stage 3: values ----------

interface Meta { id: string; started: string; ended?: string; parts?: { n: number; t0: number }[]; context: GlassesContext | null }
/** The SOP a recording followed: kept in the recording itself (new ones), or named with --sop, or found by its title. */
function protocolOf(meta: Meta, live: GlassesEvent[]): { proto: BenchProtocol; params: Record<string, number> } | null {
  const ctx = meta.context;
  const named = opt("sop");
  if (named && !KITCHEN[named]) throw new Error(`No SOP called ${named}. There are: ${Object.keys(KITCHEN).join(", ")}`);
  const proto = (named ? KITCHEN[named] : undefined) ?? ctx?.protocol ?? Object.values(KITCHEN).find((p) => p.title === ctx?.sop);
  if (!proto) { check("values", "fail", `Don't know the SOP "${ctx?.sop ?? "?"}". Name it with --sop (${Object.keys(KITCHEN).join(", ")}).`); return null; }
  const params: Record<string, number> = { ...ctx?.params, ...paramsFromFlags() };
  // An older recording doesn't say what batch it ran at, but the first thing said back does: "Step 1 of 6. Weigh the salt: 4 grams."
  if (!ctx?.params && !("batch_g" in params)) {
    const m = live.find((e) => e.source === "reply" && /^Step \d+ of \d+\./.test(e.text))?.text.match(/^Step (\d+) of \d+\. [^:.]+: ([\d.]+)/);
    const f = m ? proto.steps[Number(m[1]) - 1]?.fields[0] : undefined;
    const batch = proto.params.find((x) => x.id === "batch_g")?.value;
    if (m && f?.scales && batch) {
      try {
        const planned = evaluate(f.formula, Object.fromEntries(proto.params.map((x) => [x.id, x.value])));
        params.batch_g = Math.round((batch * Number(m[2]) / planned) * 100) / 100;
        check("values", "warn", `The batch isn't in this recording; taken as ${params.batch_g} g from the first target said back.`);
      } catch { /* a formula that needs an earlier field: leave the batch as the SOP has it */ }
    }
  }
  return { proto, params };
}

const ev = (n: number, e: Omit<GlassesEvent, "id">): GlassesEvent => ({ id: `d${String(n).padStart(4, "0")}`, ...e });
function values(proto: BenchProtocol, params: Record<string, number>, trial: string, utterances: Utterance[], t0: number) {
  let state: RunState = emptyRun(proto, params, trial), memo = freshMemo();
  const log: GlassesEvent[] = [], missed: Utterance[] = [];
  let n = 0, current = compute(proto, state).current;
  log.push(ev(n++, { at: iso(t0), source: "step", text: proto.steps[current]?.title ?? "Finished", step: current + 1 }));
  for (const u of utterances.filter((x) => !x.echo)) {
    const at = iso(u.to);
    log.push({ ...ev(n++, { at, source: "voice", text: u.text }), from: iso(u.from) } as GlassesEvent);
    // A question is answered and goes no further, as in the trial view.
    const reply = answer(u.text, proto, state, null);
    if (reply) { log.push(ev(n++, { at, source: "reply", text: reply })); continue; }
    const r = applyUtterance(proto, state, u.text, at, memo);
    state = r.run; memo = r.memo;
    const c = compute(proto, state);
    for (const d of r.did as Did[]) {
      if (d.kind === "missed") missed.push(u);
      else if (d.kind === "values") for (const [id, value] of Object.entries(d.values)) {
        const f = proto.steps.flatMap((x) => x.fields).find((x) => x.id === id)!;
        const target = Number.isFinite(c.target[id]) ? c.target[id] : null, off = offBy(value, c.target[id]);
        const data: GlassesValue = { step: proto.steps.findIndex((st) => st.fields.some((x) => x.id === id)), label: f.label, value, unit: f.unit, target, off: off !== null && Math.abs(off) > TOLERANCE ? Math.round(off * 100) : null, by: "voice" };
        log.push({ ...ev(n++, { at, source: "value", text: `${f.label} ${value} ${f.unit}`, data }), from: iso(u.from) } as GlassesEvent);
      }
      else if (d.kind === "note") log.push(ev(n++, { at, source: "mark", kind: "note", text: d.text, step: d.step + 1 }));
      else if (d.kind === "timer_start" || d.kind === "timer_stop" || d.kind === "skip" || d.kind === "done" || d.kind === "photo")
        log.push(ev(n++, { at, source: "mark", kind: d.kind, text: `${{ timer_start: "Timer started", timer_stop: "Timer stopped", skip: "Timer skipped", done: "Done", photo: "Photo taken" }[d.kind]}: ${proto.steps[d.step].title}`, step: d.step + 1 }));
    }
    if (c.current !== current) { current = c.current; log.push(ev(n++, { at, source: "step", text: proto.steps[current]?.title ?? "Finished", step: current === -1 ? null : current + 1 })); }
  }
  const c = compute(proto, state);
  const fields = proto.steps.flatMap((x) => x.fields);
  const got = fields.filter((f) => state.entries[f.id]);
  check("values", got.length === fields.length ? "ok" : "warn", `${got.length} of ${fields.length} amounts recorded${got.length < fields.length ? ` (missing: ${fields.filter((f) => !state.entries[f.id]).map((f) => f.label).join(", ")})` : ""}.`);
  check("values", c.done ? "ok" : "warn", c.done ? "Every step finished." : `Stopped at step ${c.current + 1}: ${proto.steps[c.current].title}.`);
  if (missed.length) check("values", "warn", `${missed.length} sentences had nothing in them to record: ${missed.map((u) => `“${u.text}”`).join(" ")}`);
  return { log, state, missed };
}

/** What the live log says was recorded: value lines in new recordings; in older ones, what was said back ("Salt, 4 grams."). */
function liveValues(live: GlassesEvent[], proto: BenchProtocol): { step: number; label: string; value: number; at: number }[] {
  const direct = live.filter((e) => e.source === "value" && e.data).map((e) => ({ step: e.data!.step, label: e.data!.label, value: e.data!.value, at: Date.parse(e.at) }));
  if (direct.length) return direct;
  const fields = proto.steps.flatMap((st, i) => st.fields.map((f) => ({ f, i })));
  return live.filter((e) => e.source === "reply").flatMap((e) => {
    const m = e.text.match(/^([^,.:]+), ([\d.]+) [A-Za-z]+\./);
    const hit = m && !/^Step \d/.test(e.text) ? fields.find((x) => x.f.label.toLowerCase() === m[1].trim().toLowerCase()) : undefined;
    return hit ? [{ step: hit.i, label: hit.f.label, value: Number(m![2]), at: Date.parse(e.at) }] : [];
  });
}

// ---------- Stage 4: steps ----------

interface Segment {
  step: number; title: string;
  start: number | null; end: number | null; // wall-clock ms: when the trial moved to this step, and when it was finished
  seen: number | null; // the camera's first sighting of this step's work, when it has one
  wait_s: number | null; work_s: number | null; // start → seen, seen → end
  values: { label: string; value: number; unit: string; target: number | null; off: number | null; at: number; said_from: number | null }[];
  marks: { kind: string; text: string; at: number }[];
  camera: { text: string; at: number; confidence?: string }[];
}
function segments(proto: BenchProtocol, log: GlassesEvent[], live: GlassesEvent[]): Segment[] {
  const t = (e: GlassesEvent) => Date.parse(e.at);
  const cam = live.filter((e) => e.source === "camera");
  const segs = proto.steps.map((st, i): Segment => {
    const start = log.find((e) => e.source === "step" && e.step === i + 1);
    const mine = log.filter((e) => (e.source === "value" && e.data?.step === i) || (e.source === "mark" && e.step === i + 1));
    const next = log.find((e) => e.source === "step" && start && t(e) >= t(start) && e !== start && e.step !== i + 1);
    const end = mine.length ? Math.max(...mine.map(t)) : null;
    const s0 = start ? t(start) : null, s1 = end ?? (next ? t(next) : null);
    const camera = cam.filter((e) => e.step === i + 1).map((e) => ({ text: e.text, at: t(e), confidence: e.confidence }));
    const seen = camera.find((x) => s0 == null || x.at >= s0 - 8000)?.at ?? null;
    return {
      step: i + 1, title: st.title, start: s0, end: s1, seen,
      wait_s: s0 != null && seen != null ? Math.max(0, Math.round((seen - s0) / 100) / 10) : null,
      work_s: seen != null && s1 != null ? Math.max(0, Math.round((s1 - Math.max(seen, s0 ?? seen)) / 100) / 10) : null,
      values: mine.filter((e) => e.source === "value").map((e) => ({ label: e.data!.label, value: e.data!.value, unit: e.data!.unit, target: e.data!.target, off: e.data!.off, at: t(e), said_from: (e as GlassesEvent & { from?: string }).from ? Date.parse((e as GlassesEvent & { from?: string }).from!) : null })),
      marks: mine.filter((e) => e.source === "mark").map((e) => ({ kind: e.kind ?? "", text: e.text, at: t(e) })),
      camera,
    };
  });
  const started = segs.filter((s) => s.start != null).length;
  check("steps", started === segs.length ? "ok" : "warn", `${started} of ${segs.length} steps have a start time.`);
  if (cam.length) {
    const with_ = segs.filter((s) => s.camera.length).length, loose = cam.filter((e) => e.step == null).length;
    check("steps", "ok", `The camera log placed something in ${with_} of ${segs.length} steps; ${loose} of its ${cam.length} lines belong to no step.`);
  } else check("steps", "warn", "No camera log, so a step's waiting can't be told from its doing.");
  return segs;
}

// ---------- Stage 5: frames ----------

function frames(dir: string, parts: Part[], segs: Segment[]): { file: string; at: number; label: string }[] {
  const out: { file: string; at: number; label: string }[] = [];
  const folder = join(dir, "derived", "moments");
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const grab = (at: number, name: string, label: string) => {
    const p = [...parts].reverse().find((x) => at >= x.t0) ?? parts[0];
    const sec = Math.min(Math.max(0, (at - p.t0) / 1000), Math.max(0, p.dur / 1000 - 0.1));
    const file = join(folder, name);
    const r = run(FFMPEG!, ["-hide_banner", "-loglevel", "error", "-y", "-ss", sec.toFixed(2), "-i", p.file, "-frames:v", "1", "-q:v", "3", file]);
    if (r.status === 0 && existsSync(file)) out.push({ file: `moments/${name}`, at, label });
  };
  let n = 0;
  for (const s of segs) {
    // As the value was being said the person was looking at what they were reading: the start of the sentence, not its end.
    for (const v of s.values) grab((v.said_from ?? v.at - 2500) - 300, `${String(++n).padStart(2, "0")}-${slug(v.label)}-${String(v.value).replace(".", "p")}${slug(v.unit)}.jpg`, `${v.label} ${v.value} ${v.unit}`);
    for (const m of s.marks.filter((x) => x.kind === "photo" || x.kind === "note" || x.kind === "done")) grab(m.at - 500, `${String(++n).padStart(2, "0")}-${m.kind}-step${s.step}.jpg`, m.text);
  }
  const want = segs.reduce((a, s) => a + s.values.length + s.marks.filter((x) => x.kind === "photo" || x.kind === "note" || x.kind === "done").length, 0);
  check("frames", out.length === want ? "ok" : "warn", `${out.length} of ${want} measurement frames saved.`);
  return out;
}

// ---------- Run ----------

async function main() {
  const id = opt("video") ? importVideo(opt("video")!) : positional[0] && positional[0] !== "latest" ? positional[0]
    : readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, "log.jsonl"))).map((d) => d.name).sort().pop();
  if (!id) throw new Error("No recording yet.");
  const dir = join(ROOT, id);
  if (!/^[\w-]+$/.test(id) || !existsSync(join(dir, "log.jsonl"))) throw new Error(`No recording called ${id}. There are: ${readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, "log.jsonl"))).join(", ")}`);
  mkdirSync(join(dir, "derived"), { recursive: true });
  const live = readFileSync(join(dir, "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as GlassesEvent);
  const meta: Meta = existsSync(join(dir, "session.json")) ? JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) : { id, started: live[0]?.at ?? iso(Date.now()), context: null };

  const parts = clock(dir, meta, live);
  const said = parts.length ? await speech(dir, parts, meta.context, live) : [];
  const sop = protocolOf(meta, live);
  const t0 = parts[0]?.t0 ?? Date.parse(meta.started);
  let derived: GlassesEvent[] = [], segs: Segment[] = [], moments: ReturnType<typeof frames> = [], compare: { step: number; label: string; live: number | null; derived: number | null; dt_s: number | null }[] = [];
  if (sop) {
    const v = values(sop.proto, sop.params, meta.context?.trial ?? "", said, t0);
    derived = v.log;
    // Against the live log: the same amounts, at about the same moments.
    const was = liveValues(live, sop.proto), now = derived.filter((e) => e.source === "value");
    if (was.length) {
      const labels = [...new Set([...was.map((x) => x.label), ...now.map((e) => e.data!.label)])];
      compare = labels.map((label) => {
        const a = was.filter((x) => x.label === label).pop(), b = now.filter((e) => e.data!.label === label).pop();
        return { step: (a?.step ?? b!.data!.step) + 1, label, live: a?.value ?? null, derived: b?.data!.value ?? null, dt_s: a && b ? Math.round((Date.parse(b.at) - a.at) / 100) / 10 : null };
      }).sort((x, y) => x.step - y.step);
      const same = compare.filter((x) => x.live === x.derived).length;
      check("values", same === compare.length ? "ok" : "fail", `${same} of ${compare.length} amounts match what was recorded live${same < compare.length ? `: ${compare.filter((x) => x.live !== x.derived).map((x) => `${x.label} ${x.live ?? "—"} live, ${x.derived ?? "—"} now`).join("; ")}` : ""}.`);
    }
    // The camera's lines and the replies are carried over as they were: this run doesn't look at the pictures again.
    derived = [...derived, ...live.filter((e) => e.source === "camera")].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    segs = segments(sop.proto, derived, live);
    if (!flag("no-frames") && parts.length) moments = frames(dir, parts, segs);
    writeFileSync(join(dir, "derived", "log.jsonl"), derived.map((e) => `${JSON.stringify(e)}\n`).join(""));
    writeFileSync(join(dir, "derived", "segments.json"), JSON.stringify(segs, null, 2));
    writeFileSync(join(dir, "derived", "trial.json"), JSON.stringify(v.state, null, 2));
  }
  const worst: Level = checks.some((c) => c.level === "fail") ? "fail" : checks.some((c) => c.level === "warn") ? "warn" : "ok";
  const report = { id, sop: sop?.proto.title ?? null, trial: meta.context?.trial ?? null, result: worst, checks, compare, moments, said: said.map((u) => ({ at: mmss(u.from - t0), text: u.text, echo: u.echo || undefined })) };
  writeFileSync(join(dir, "derived", "report.json"), JSON.stringify(report, null, 2));

  if (flag("json")) { console.log(JSON.stringify(report, null, 2)); return worst; }
  const mark = { ok: "✓", warn: "!", fail: "✕" };
  console.log(`\n${sop?.proto.title ?? "Recording"}${meta.context?.trial ? ` · Trial ${meta.context.trial}` : ""} · ${id}\n`);
  for (const stage of ["clock", "speech", "values", "steps", "frames"]) {
    const mine = checks.filter((c) => c.stage === stage);
    if (!mine.length) continue;
    console.log(stage.toUpperCase());
    for (const c of mine) console.log(`  ${mark[c.level]} ${c.text}`);
  }
  if (segs.length) {
    console.log("\nSTEP BY STEP                      start    wait    work   recorded");
    for (const s of segs) {
      const rec = [...s.values.map((v) => `${v.value} ${v.unit}${v.off ? ` (${v.off > 0 ? "+" : "−"}${Math.abs(v.off)}%)` : ""}`), ...s.marks.map((m) => m.kind.replace("_", " "))].join(", ");
      console.log(`  ${String(s.step).padStart(2)}. ${s.title.padEnd(26).slice(0, 26)} ${(s.start != null ? mmss(s.start - t0) : "—").padStart(7)} ${(s.wait_s != null ? `${s.wait_s.toFixed(0)} s` : "—").padStart(7)} ${(s.work_s != null ? `${s.work_s.toFixed(0)} s` : "—").padStart(7)}   ${rec || "—"}`);
    }
  }
  if (compare.length) {
    console.log("\nLIVE AGAINST THIS RUN             live     now   later by");
    for (const x of compare) console.log(`  ${x.label.padEnd(28).slice(0, 28)} ${String(x.live ?? "—").padStart(7)} ${String(x.derived ?? "—").padStart(7)} ${(x.dt_s != null ? `${x.dt_s.toFixed(1)} s` : "—").padStart(9)}`);
  }
  console.log(`\n${worst === "ok" ? "All checks passed." : worst === "warn" ? "Passed, with warnings above." : "Something failed above."}`);
  console.log(`Wrote recordings/${id}/derived/. Replay: http://localhost:5173/api/glasses/replay/${id}?overlay&derived\n`);
  return worst;
}

main().then((worst) => { process.exitCode = worst === "fail" ? 1 : 0; }).catch((e) => { console.error(`\n${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 2; });
