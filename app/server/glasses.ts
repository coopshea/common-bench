// Glasses: Mentra Live as the bench camera and microphone (mounted at /api/glasses).
//
// The glasses miniapp (../glasses, runs in the Mentra app on the phone) polls this server. When a recording is
// wanted it publishes the camera straight to this machine over RTMP. From there:
//
//   glasses ──RTMP──▶ MediaMTX (:1935) ──RTSP (loopback)──▶ ffmpeg ─┬─▶ recordings/<id>/video-NNN.mp4  (video + audio, as sent)
//                                                                  └─▶ 4 frames a second ─┬─▶ live preview in the trial view
//                                                                                         └─▶ the camera log (one frame every few seconds)
//                                                                  └─▶ the microphone's sound ──▶ Whisper on this computer ─┐
//   what was said ──▶ the trial view's own parse (lib/benchSpeech.ts) ◀────────────────────────────────────────────────────┘
//   (with the phone app instead of the Mac app, Mentra's transcription sends what was said to POST /device/transcript)
//
// The camera log describes actions only. Measured values never come from a frame: they come from what the person
// says, through the deterministic parse (build rule 3). Camera lines are guesses until a person confirms them.
//
// Routes for the phone need the bench key (x-bench-key). Routes for the trial view answer this machine only.
//
// Env: GLASSES_MODEL (default: the agent's model), GLASSES_OBSERVE_MS (default 8000),
//      GLASSES_OBSERVER=0 (video and voice only, no camera log),
//      GLASSES_WHISPER_MODEL (a whisper.cpp ggml model file; without it, speech needs the phone app),
//      GLASSES_SPEAKER (part of a sound output's name, to send spoken answers there), GLASSES_VOICE=off (no spoken answers).

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { HttpBindings } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { stream, streamSSE } from "hono/streaming";
import { z } from "zod";
import type { GlassesMark } from "../src/shared/glasses.ts";
import type { GlassesContext, GlassesEvent, GlassesState, GlassesValue } from "../src/shared/glasses.ts";
import { apiKeyPresent, DEFAULT_MODEL } from "./agent.ts";
import { replayRoutes } from "./glasses-replay.ts";
import { importPage } from "./kitchen-import.ts";
import { voiceFile, voiceName } from "./voice.ts";
import { NOT_SPEECH, WHISPER_ARGS, isEchoOf, sentences, speechHint, wav } from "./glasses-speech.ts";

const ROOT = fileURLToPath(new URL("../recordings/", import.meta.url));
const MODEL = process.env.GLASSES_MODEL ?? DEFAULT_MODEL;
const OBSERVE_MS = Math.max(3000, Number(process.env.GLASSES_OBSERVE_MS ?? 8000));
const OBSERVER_OFF = process.env.GLASSES_OBSERVER === "0";
const RTMP_PORT = 1935;
const RTSP_PORT = 8554;
const DEVICE_STALE_MS = 8000;
const FRAME_STALE_MS = 4000;

mkdirSync(ROOT, { recursive: true });

/** The bench key: names the stream path and lets the phone in. Made once, kept beside the recordings. */
const KEY = (() => {
  const f = join(ROOT, ".key");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  const k = randomBytes(9).toString("hex");
  writeFileSync(f, k);
  return k;
})();

/** Where the glasses publish: rtmp://<this machine>:1935/live/<key>. Two parts (app, then stream), as RTMP publishers expect. */
const STREAM = `live/${KEY}`;

const lanIp = () => {
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  return null;
};
const which = (bin: string) => ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", ...(process.env.PATH ?? "").split(":")].map((d) => join(d, bin)).find((p) => existsSync(p));
const MEDIAMTX = which("mediamtx");
const FFMPEG = which("ffmpeg");
const FFPROBE = which("ffprobe");
const WHISPER = which("whisper-server");
const WHISPER_MODEL = process.env.GLASSES_WHISPER_MODEL && existsSync(process.env.GLASSES_WHISPER_MODEL) ? process.env.GLASSES_WHISPER_MODEL : null;

// ---------- State ----------

interface Session { id: string; started: string; dir: string; context: GlassesContext | null; log: GlassesEvent[]; part: number }
let session: Session | null = null;
const device: GlassesState["device"] & { seen: number } = { connected: false, seen: 0 };
let frame: { jpg: Buffer; at: number } | null = null;
let said: string[] = []; // heard since the camera last looked

const listeners = new Set<(event: string, data: unknown) => void>();
const emit = (event: string, data: unknown) => listeners.forEach((l) => l(event, data));
const frameClients = new Set<(jpg: Buffer) => void>();

function snapshot(): GlassesState {
  const connected = Date.now() - device.seen < DEVICE_STALE_MS;
  const { seen: _, ...d } = device;
  return {
    device: { ...d, connected },
    recording: session ? { id: session.id, started: session.started, trial: session.context?.trial ?? null } : null,
    video: !session ? "off" : frame && Date.now() - frame.at < FRAME_STALE_MS ? "live" : "waiting",
    observer: OBSERVER_OFF ? "off" : apiKeyPresent() ? "on" : "no key",
    voice: !SAY || VOICE_OFF ? "off" : speaker?.glasses ? "glasses" : "computer",
    media: Boolean(MEDIAMTX && FFMPEG),
    seen: session ? lastScene : null,
    log: session?.log.slice(-200) ?? [],
  };
}
const changed = () => emit("state", snapshot());

const stamp = () => new Date().toISOString();
const logFile = (s: Session) => join(s.dir, "log.jsonl");
function addEvent(e: Omit<GlassesEvent, "id" | "at"> & { at?: string }) {
  if (!session) return null;
  const ev: GlassesEvent = { id: randomBytes(4).toString("hex"), at: e.at ?? stamp(), ...e };
  session.log.push(ev);
  appendFileSync(logFile(session), `${JSON.stringify(ev)}\n`);
  changed();
  return ev;
}
const rewriteLog = (s: Session) => writeFileSync(logFile(s), s.log.map((e) => `${JSON.stringify(e)}\n`).join(""));

// ---------- Media: MediaMTX takes the stream in; ffmpeg records it and cuts frames ----------

const MTX_PID = join(ROOT, ".mediamtx.pid");
let capture: ChildProcess | null = null;
let captureTimer: NodeJS.Timeout | null = null;

const portOpen = (port: number) => new Promise<boolean>((res) => {
  const s = net.connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); res(true); });
  s.once("error", () => res(false));
});

async function ensureMedia(): Promise<boolean> {
  if (!MEDIAMTX || !FFMPEG) return false;
  if (await portOpen(RTSP_PORT)) return true; // already up (this server restarted under a running one)
  const cfg = join(ROOT, ".mediamtx.yml");
  // Publishing is open to the network on the keyed path only; reading is loopback RTSP only.
  writeFileSync(cfg, [
    "logLevel: info",
    "rtsp: true", `rtspAddress: 127.0.0.1:${RTSP_PORT}`, "rtspTransports: [tcp]",
    "rtmp: true", `rtmpAddress: :${RTMP_PORT}`,
    "hls: false", "webrtc: false", "srt: false", "moq: false", "api: false", "metrics: false", "pprof: false", "playback: false",
    "logDestinations: [file]", `logFile: ${join(ROOT, ".mediamtx.log")}`,
    "paths:", `  ${STREAM}:`, "",
  ].join("\n"));
  // On its own, not as this server's child: a restart of this server (file watch in dev) must not cut the glasses' stream.
  // It runs for as long as a recording does: stopMedia() ends it when the recording stops.
  const p = spawn(MEDIAMTX, [cfg], { stdio: "ignore", detached: true });
  p.unref();
  if (p.pid) writeFileSync(MTX_PID, String(p.pid));
  for (let i = 0; i < 20; i++) { if (await portOpen(RTSP_PORT)) return true; await new Promise((r) => setTimeout(r, 150)); }
  return false;
}
const stopPid = (file: string) => {
  if (!existsSync(file)) return;
  try { process.kill(parseInt(readFileSync(file, "utf8"), 10)); } catch { /* already gone */ }
  rmSync(file, { force: true });
};
const freePort = () => new Promise<number>((res, no) => {
  const srv = net.createServer();
  srv.once("error", no);
  srv.listen(0, "127.0.0.1", () => { const { port } = srv.address() as net.AddressInfo; srv.close(() => res(port)); });
});
/** Ends the helpers that only run during a recording: the media server and the speech model. */
function stopMedia() { stopPid(MTX_PID); stopPid(WHISPER_PID); }

// ---------- Saying things back: this computer's own voice, sent to the glasses when they are a sound output ----------

const SAY = existsSync("/usr/bin/say") ? "/usr/bin/say" : null;
const AFPLAY = which("afplay");
const VOICE_OFF = process.env.GLASSES_VOICE === "off";
let speaker: { id: string | null; glasses: boolean; at: number } | null = null;
/** The sound output to speak through: one named in GLASSES_SPEAKER, or the glasses if they are connected for sound. */
function findSpeaker(): Promise<typeof speaker> {
  if (speaker && Date.now() - speaker.at < 20_000) return Promise.resolve(speaker);
  return new Promise((res) => {
    if (!SAY) return res((speaker = { id: null, glasses: false, at: Date.now() }));
    const p = spawn(SAY, ["-a", "?"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
    p.stderr!.on("data", (d: Buffer) => { out += d.toString(); });
    p.once("exit", () => {
      const outputs = [...out.matchAll(/^\s*(\d+)\s+(.+?)\s*$/gm)].map((m) => ({ id: m[1], name: m[2] }));
      const want = process.env.GLASSES_SPEAKER?.toLowerCase();
      const named = want ? outputs.find((o) => o.name.toLowerCase().includes(want)) : undefined;
      const worn = outputs.find((o) => /mentra/i.test(o.name) || (device.model && o.name.toLowerCase().includes(device.model.toLowerCase())));
      res((speaker = { id: (named ?? worn)?.id ?? null, glasses: Boolean(worn) && !named, at: Date.now() }));
    });
    p.once("error", () => res((speaker = { id: null, glasses: false, at: Date.now() })));
  });
}

// Our own replies, as they were spoken: what comes back through the microphone is dropped (isEchoOf, glasses-speech.ts).
const replies: { text: string; start: number; end: number }[] = [];
const isEcho = (text: string, from: number) => isEchoOf(text, from, replies);
let talk = Promise.resolve();
function speak(text: string) {
  if (session) addEvent({ source: "reply", text });
  talk = talk.then(() => new Promise<void>((res) => {
    const mine = { text, start: Date.now(), end: Date.now() + 60_000 };
    replies.push(mine);
    if (replies.length > 6) replies.shift();
    const done = () => { mine.end = Date.now(); res(); };
    if (!SAY || VOICE_OFF) return void setTimeout(done, Math.min(8000, 400 + text.length * 50)); // as long as saying it would take
    // The better voice when there is one (server/voice.ts): made, kept, then played. Otherwise the computer's own.
    void Promise.all([findSpeaker(), voiceFile(text, 4000)]).then(([sp, file]) => {
      mine.end = Date.now() + 60_000;
      const p = file && AFPLAY ? spawn(AFPLAY, [file], { stdio: "ignore" }) : spawn(SAY, [...(sp?.id ? ["-a", sp.id] : []), "-r", "200", text], { stdio: "ignore" });
      p.once("exit", done);
      p.once("error", done);
    });
  }));
}

// ---------- Speech on this computer: the stream's sound, cut into sentences, read by Whisper ----------

const WHISPER_PID = join(ROOT, ".whisper.pid");
let phoneHears = false; // the phone app is sending what was said: don't transcribe the same speech twice
const hearsHere = () => Boolean(WHISPER && WHISPER_MODEL) && !phoneHears;

/** The Whisper server holds the model in memory for the length of a recording, so each sentence takes a fraction of a second. */
let whisperPort = 0; // a free port taken when it starts, written beside its pid ("pid:port")
async function ensureWhisper(): Promise<boolean> {
  if (!WHISPER || !WHISPER_MODEL) return false;
  if (existsSync(WHISPER_PID)) {
    // Still running from before this server restarted? Then it's ours to keep using.
    const [pid, port] = readFileSync(WHISPER_PID, "utf8").split(":").map(Number);
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* gone */ }
    if (alive && port && (await portOpen(port))) { whisperPort = port; return true; }
    stopPid(WHISPER_PID);
  }
  const port = await freePort();
  const p = spawn(WHISPER, WHISPER_ARGS(WHISPER_MODEL, port), { stdio: "ignore", detached: true });
  p.unref();
  if (p.pid) writeFileSync(WHISPER_PID, `${p.pid}:${port}`);
  for (let i = 0; i < 80; i++) { if (await portOpen(port)) { whisperPort = port; return true; } await new Promise((r) => setTimeout(r, 250)); } // a large model takes a few seconds to load
  return false;
}

/** Something was said: show it in the trial view, and when it's a finished sentence in a recording, log it. */
function heard(text: string, final: boolean, from = Date.now()) {
  if (isEcho(text, from)) return;
  emit("heard", { text, final });
  if (final && session) { said.push(text); addEvent({ source: "voice", text }); }
}

let reading = Promise.resolve();
function transcribe(pcm: Buffer) {
  const from = Date.now() - pcm.length / 32; // when its first sound arrived (16 kHz, 16-bit: 32 bytes a millisecond)
  const ctx = session?.context;
  const hint = speechHint(ctx ?? null);
  reading = reading.then(async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav(pcm))], { type: "audio/wav" }), "said.wav");
    form.append("response_format", "json");
    form.append("temperature", "0.0");
    form.append("prompt", hint);
    const res = await fetch(`http://127.0.0.1:${whisperPort}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    const text = (((await res.json()) as { text?: string }).text ?? "").replace(/\s+/g, " ").trim();
    if (text && !NOT_SPEECH.test(text) && hearsHere()) heard(text, true, from);
  }).catch((e) => console.error(`[glasses] speech: ${e instanceof Error ? e.message : String(e)}`));
}

/** Record and cut frames for as long as the session lasts; each time the glasses reconnect, a new video part starts. */
/** Does the stream carry sound? (Asked before each capture: an output with no sound to put in it would stop ffmpeg.) */
const hasSound = (src: string) => new Promise<boolean>((res) => {
  if (!FFPROBE) return res(false);
  const p = spawn(FFPROBE, ["-v", "error", "-rtsp_transport", "tcp", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", src], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  p.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
  const t = setTimeout(() => p.kill(), 6000);
  p.once("exit", () => { clearTimeout(t); res(out.includes("audio")); });
});

let captureStarting = false;
async function runCapture() {
  if (!session || capture || captureStarting || !FFMPEG) return;
  const s = session;
  const src = `rtsp://127.0.0.1:${RTSP_PORT}/${STREAM}`;
  captureStarting = true;
  const listen = hearsHere() && (await hasSound(src)) && (await ensureWhisper());
  captureStarting = false;
  if (session !== s || capture) return;
  s.part += 1;
  const out = join(s.dir, `video-${String(s.part).padStart(3, "0")}.mp4`);
  const p = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-fflags", "nobuffer", "-flags", "low_delay", "-rtsp_transport", "tcp", "-i", src,
    "-map", "0", "-c", "copy", "-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", out,
    "-map", "0:v:0", "-vf", "fps=4,scale=768:-2", "-q:v", "5", "-c:v", "mjpeg", "-f", "image2pipe", "pipe:1",
    ...(listen ? ["-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-flush_packets", "1", "-f", "s16le", "pipe:3"] : []),
  ], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
  capture = p;
  if (listen) (p.stdio[3] as NodeJS.ReadableStream).on("data", sentences(transcribe));
  else (p.stdio[3] as NodeJS.ReadableStream).resume();
  let buf: Buffer = Buffer.alloc(0);
  let got = false;
  p.stdout!.on("data", (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const a = buf.indexOf(Buffer.from([0xff, 0xd8]));
      const b = a < 0 ? -1 : buf.indexOf(Buffer.from([0xff, 0xd9]), a + 2);
      if (b < 0) break;
      const jpg = Buffer.from(buf.subarray(a, b + 2));
      buf = buf.subarray(b + 2);
      const first = !frame || Date.now() - frame.at > FRAME_STALE_MS;
      frame = { jpg, at: Date.now() };
      // The first picture of a recording: say so, since anything said before this moment is not in the video.
      if (!got && s.part === 1 && s.context) speak("Camera is on.");
      got = true;
      frameClients.forEach((c) => c(jpg));
      if (first) changed();
    }
  });
  p.once("exit", () => {
    capture = null;
    if (!got) { try { rmSync(out, { force: true }); } catch { /* nothing was written */ } s.part -= 1; }
    else changed();
    // Not publishing yet, or dropped: try again (and bring the media server back if it went away).
    if (session === s) captureTimer = setTimeout(() => void ensureMedia().then(() => runCapture()), 1500);
  });
}
function stopCapture() {
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = null;
  capture?.kill("SIGINT"); // lets ffmpeg close the file cleanly
}
for (const sig of ["SIGINT", "SIGTERM", "exit"] as const) process.on(sig, () => { capture?.kill("SIGINT"); if (sig !== "exit") process.exit(0); });

// ---------- The camera log: one frame every few seconds → what changed ----------

const Seen = z.object({
  scene: z.string().describe("What the frame shows, 12 words at most."),
  new_event: z.boolean().describe("True only when the person has started doing something different from the last logged line."),
  action: z.string().describe("The new action in the past tense, no subject, 10 words at most (\"Poured resin into the mixing cup\"). Empty when new_event is false."),
  step: z.number().int().nullable().describe("The 1-based protocol step this action belongs to, or null when there is no protocol or it isn't clear."),
  confidence: z.enum(["low", "medium", "high"]),
});

let client: Anthropic | null = null; // made on first use: the server runs without a key
const FALLBACKS = /^claude-(sonnet-5-5|opus-5|fable-5)/.test(MODEL); // server-side refusal fallback where the model has one

const systemFor = (ctx: GlassesContext | null) => [
  "You keep the activity log for one person working at a lab bench. They wear camera glasses, so each frame is what they are looking at. You get the previous frame and the current one, a few seconds apart.",
  "Log a line only when what they are doing changes: picked something up, weighed, poured, mixed, loaded or started an instrument, moved to another station, wrote something down, left the bench. Carrying on with the same action is not a new line. A person talking, or the camera moving, is not a new line.",
  "Describe only what the frames show. If the frame is blurred, dark, or pointed away from the work, set new_event to false.",
  "Never put a number read from a display, a scale or a label into the action. Measured values are recorded from what the person says, not from the picture.",
  ctx
    ? `They are following this protocol (${ctx.sop}, trial ${ctx.trial}):\n${ctx.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail.length ? `: ${s.detail.join("; ")}` : ""}`).join("\n")}\nGive the step an action belongs to only when the frame makes it clear.`
    : "There is no protocol for this recording; leave step null.",
].join("\n\n");

let observing = false;
let lastScene: { at: string; scene: string } | null = null; // what the camera log last saw, whether or not it logged a line
let lastSeen: { jpg: Buffer; at: number } | null = null;
let observerNote: string | null = null; // the last reason a look failed, logged once

async function observe() {
  const s = session;
  if (!s || observing || OBSERVER_OFF || !apiKeyPresent()) return;
  if (!frame || Date.now() - frame.at > FRAME_STALE_MS || frame.at === lastSeen?.at) return;
  observing = true;
  const now = frame, prev = lastSeen;
  const heard = said; said = [];
  const last = [...s.log].reverse().find((e) => e.source === "camera");
  const image = (jpg: Buffer) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: jpg.toString("base64") } });
  try {
    client ??= new Anthropic();
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      ...(FALLBACKS ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      system: [{ type: "text", text: systemFor(s.context), cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: [
          ...(prev ? [{ type: "text" as const, text: `Previous frame (${Math.round((now.at - prev.at) / 1000)} s ago):` }, image(prev.jpg)] : []),
          { type: "text", text: "Current frame:" }, image(now.jpg),
          { type: "text", text: [
            last ? `Last logged line: "${last.text}" (${Math.round((now.at - new Date(last.at).getTime()) / 1000)} s ago).` : "Nothing is logged yet.",
            heard.length ? `They said since the previous frame: "${heard.join(" ")}"` : "",
            s.context?.current != null ? `The app shows step ${s.context.current + 1} as the current one.` : "",
          ].filter(Boolean).join("\n") },
        ],
      }],
      output_config: { effort: "low", format: zodOutputFormat(Seen) },
    });
    lastSeen = now;
    observerNote = null;
    const seen = res.stop_reason === "refusal" ? null : res.parsed_output;
    if (seen) lastScene = { at: new Date(now.at).toISOString(), scene: seen.scene };
    if (session !== s || !seen?.new_event || !seen.action.trim()) return;
    const n = s.log.filter((e) => e.source === "camera").length + 1;
    const name = `${String(n).padStart(4, "0")}.jpg`;
    mkdirSync(join(s.dir, "frames"), { recursive: true });
    writeFileSync(join(s.dir, "frames", name), now.jpg);
    const max = s.context?.steps.length ?? 0;
    addEvent({ at: new Date(now.at).toISOString(), source: "camera", text: seen.action.trim(), step: seen.step && seen.step >= 1 && seen.step <= max ? seen.step : null, confidence: seen.confidence, frame: name, ok: false });
  } catch (e) {
    // The video and the voice keep working without the camera log; say why once and keep trying.
    const why = e instanceof Anthropic.AuthenticationError ? "the API key was rejected"
      : e instanceof Anthropic.RateLimitError ? "rate limited"
      : e instanceof Anthropic.APIError ? `API error ${e.status ?? ""}`.trim()
      : e instanceof Error ? e.message : String(e);
    if (why !== observerNote) { observerNote = why; console.error(`[glasses] camera log: ${why}`); addEvent({ source: "system", text: `Camera log paused: ${why}` }); }
  } finally {
    observing = false;
  }
}
setInterval(() => void observe(), OBSERVE_MS).unref();
// The phone going quiet, or frames stopping, changes what the trial view shows.
let lastShape = "";
setInterval(() => { const st = snapshot(); const shape = `${st.device.connected}:${st.video}`; if (shape !== lastShape) { lastShape = shape; changed(); } }, 2000).unref();

// ---------- Sessions ----------

const PORT = Number(process.env.PORT ?? 8787);
const ACTIVE = join(ROOT, ".active.json");
/** The trial moved to another step (or finished): one log line, so a replay knows when each step began. */
function stepEvent(before: GlassesContext | null, after: GlassesContext | null) {
  if (!after || (before && before.current === after.current)) return;
  const st = after.current == null ? null : after.steps[after.current];
  addEvent({ source: "step", text: st ? st.title : "Finished", step: after.current == null ? null : after.current + 1 });
}
/** When each video part's first picture was taken in. Written down while the files are still where they were made: a copied file loses its creation time. */
const partsOf = (dir: string) => readdirSync(dir).filter((f) => /^video-\d+\.mp4$/.test(f)).sort().map((f) => ({ n: Number(f.match(/\d+/)![0]), t0: Math.round(statSync(join(dir, f)).birthtimeMs) }));
async function start(context: GlassesContext | null) {
  if (session) { if (context) session.context = context; return session; }
  const id = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(ROOT, id);
  mkdirSync(dir, { recursive: true });
  session = { id, started: stamp(), dir, context, log: [], part: 0 };
  writeFileSync(ACTIVE, JSON.stringify({ id, started: session.started, context, port: PORT }));
  frame = null; lastSeen = null; lastScene = null; said = []; phoneHears = false;
  addEvent({ source: "system", text: (await ensureMedia()) ? "Recording started" : "Recording started without video: mediamtx or ffmpeg is missing" });
  stepEvent(null, context);
  if (hearsHere()) void ensureWhisper(); // loaded while the glasses connect, so the video isn't kept waiting for it
  void runCapture();
  return session;
}
function stop() {
  if (!session) return;
  addEvent({ source: "system", text: "Recording stopped" });
  writeFileSync(join(session.dir, "session.json"), JSON.stringify({ id: session.id, started: session.started, ended: stamp(), parts: partsOf(session.dir), context: session.context }, null, 2));
  const done = session;
  session = null;
  rmSync(ACTIVE, { force: true });
  stopCapture();
  // The rest happens by itself: the second pass over the sound, then the video files, then the folder opens.
  // (server/glasses-finish.ts; its own process, so it carries on if this server restarts.)
  if (process.env.GLASSES_AUTOFINISH !== "0" && done.part > 0 && done.context) setTimeout(() => {
    const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
    if (existsSync(tsx)) spawn(tsx, ["--env-file-if-exists=.env.local", "server/glasses-finish.ts", done.id, "--open"], { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "ignore", detached: true, env: { ...process.env, PORT: String(PORT) } }).unref();
  }, 3000);
  setTimeout(() => { if (!session) stopMedia(); }, 1500); // after ffmpeg has closed the file
  frame = null;
  changed();
}
// A server restart in the middle of a recording (file watch in dev) picks the recording back up.
// Only the server that started it does: a second copy on another port leaves it alone.
if (existsSync(ACTIVE)) {
  try {
    const a = JSON.parse(readFileSync(ACTIVE, "utf8")) as { id: string; started: string; context: GlassesContext | null; port?: number };
    if (a.port !== PORT) throw new Error("another server's recording");
    const dir = join(ROOT, a.id);
    const log = existsSync(join(dir, "log.jsonl")) ? readFileSync(join(dir, "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as GlassesEvent) : [];
    session = { id: a.id, started: a.started, dir, context: a.context, log, part: readdirSync(dir).filter((f) => f.startsWith("video-")).length };
    // Written to in the last two minutes: carry on. Older than that, the server was really stopped: close it out.
    const touched = Math.max(...readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs));
    if (Date.now() - touched < 120_000) void ensureMedia().then(() => runCapture());
    else stop();
  } catch (e) { if (!(e instanceof Error && e.message.startsWith("another"))) rmSync(ACTIVE, { force: true }); }
} else stopMedia(); // nothing is recording: a media server left over from before has no reason to run

// ---------- Routes ----------

export const glasses = new Hono<{ Bindings: HttpBindings }>();

const fromPhone = (c: Context<{ Bindings: HttpBindings }>) => c.req.header("x-bench-key") === KEY;
const fromHere = (c: Context<{ Bindings: HttpBindings }>) => { const a = c.env?.incoming?.socket?.remoteAddress ?? ""; return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1"; };
const body = async <T>(c: Context) => { try { return (await c.req.json()) as T; } catch { return {} as T; } };

// --- the phone ---
const phone = new Hono<{ Bindings: HttpBindings }>();
phone.use("*", async (c, next) => (fromPhone(c) ? next() : c.json({ error: "bench key required" }, 401)));

/** The phone asks every couple of seconds what's wanted, and says how the glasses are. */
phone.post("/poll", async (c) => {
  const b = await body<Partial<GlassesState["device"]>>(c);
  const was = Date.now() - device.seen < DEVICE_STALE_MS;
  for (const k of Object.keys(device)) delete (device as Record<string, unknown>)[k]; // each report replaces the last: no stale Wi-Fi or battery
  Object.assign(device, { ...b, connected: true, seen: Date.now() });
  if (!was || b.stream !== undefined || b.battery !== undefined) changed();
  const ip = lanIp();
  // listen: the microphone is only wanted while a trial is open on screen or a recording is running.
  return c.json({ want: session ? "stream" : "idle", url: session && ip ? `rtmp://${ip}:${RTMP_PORT}/${STREAM}` : null, listen: listeners.size > 0 || Boolean(session) });
});
phone.post("/transcript", async (c) => {
  const b = await body<{ text?: string; isFinal?: boolean }>(c);
  const text = (b.text ?? "").trim();
  if (!text) return c.json({ ok: true });
  phoneHears = true;
  heard(text, Boolean(b.isFinal));
  return c.json({ ok: true });
});
/** The glasses' button: a short press starts or stops a recording; a long press marks the moment. */
phone.post("/button", async (c) => {
  const b = await body<{ pressType?: string }>(c);
  if (b.pressType === "long") addEvent({ source: "button", text: "Marked" });
  else if (session) stop();
  else await start(null);
  return c.json({ ok: true, recording: Boolean(session) });
});
glasses.route("/device", phone);

// --- the trial view (this machine only) ---
const view = new Hono<{ Bindings: HttpBindings }>();
view.use("*", async (c, next) => (fromHere(c) ? next() : c.json({ error: "local only" }, 403)));

view.get("/state", (c) => c.json(snapshot()));
view.get("/events", (c) => streamSSE(c, async (s) => {
  let open = true;
  const send = (event: string, data: unknown) => { if (open) void s.writeSSE({ event, data: JSON.stringify(data) }).catch(() => { open = false; }); };
  listeners.add(send);
  s.onAbort(() => { open = false; listeners.delete(send); });
  send("state", snapshot());
  while (open) { await s.sleep(5000); send("ping", {}); } // the trial view starts over if it hears nothing for 12 s
  listeners.delete(send);
}));
view.get("/live.mjpg", (c) => {
  c.header("Content-Type", "multipart/x-mixed-replace; boundary=frame");
  c.header("Cache-Control", "no-store");
  return stream(c, async (s) => {
    let open = true, busy = false;
    const push = (jpg: Buffer) => {
      if (!open || busy) return; // a slow reader skips frames instead of queueing them
      busy = true;
      void s.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`), jpg, Buffer.from("\r\n")]))
        .catch(() => { open = false; }).finally(() => { busy = false; });
    };
    frameClients.add(push);
    s.onAbort(() => { open = false; frameClients.delete(push); });
    if (frame) push(frame.jpg);
    while (open) await s.sleep(1000);
    frameClients.delete(push);
  });
});
view.post("/start", async (c) => { await start((await body<{ context?: GlassesContext }>(c)).context ?? null); return c.json(snapshot()); });
view.post("/stop", (c) => { stop(); return c.json(snapshot()); });
/** The trial view keeps the camera log's idea of the SOP and the current step up to date. */
view.post("/context", async (c) => {
  const b = await body<{ context?: GlassesContext }>(c);
  if (session && b.context) { const before = session.context; session.context = { ...b.context, plan: before?.plan ?? b.context.plan }; stepEvent(before, b.context); writeFileSync(ACTIVE, JSON.stringify({ id: session.id, started: session.started, context: session.context, port: PORT })); }
  return c.json({ ok: true });
});
/** Confirm a camera line, or throw it out. */
view.post("/events/:id", async (c) => {
  const b = await body<{ ok?: boolean; remove?: boolean }>(c);
  if (!session) return c.json({ error: "not recording" }, 409);
  const i = session.log.findIndex((e) => e.id === c.req.param("id"));
  if (i < 0) return c.json({ error: "no such line" }, 404);
  if (b.remove) session.log.splice(i, 1); else session.log[i] = { ...session.log[i], ok: b.ok !== false };
  rewriteLog(session);
  changed();
  return c.json({ ok: true });
});
/** An amount was recorded in the trial: keep it in the recording's log, so a replay can show it land. */
// Two windows open on the same trial each send the same thing a moment apart (found on the first real run:
// every answer was spoken twice). The same line again within a few seconds is the other window, and is dropped.
const lately = new Map<string, number>();
const again = (key: string, ms = 4000) => { const now = Date.now(), was = lately.get(key) ?? 0; lately.set(key, now); if (lately.size > 200) for (const [k, t] of lately) if (now - t > 60_000) lately.delete(k); return now - was < ms; };
view.post("/value", async (c) => {
  const v = (await body<{ value?: GlassesValue }>(c)).value;
  if (session && v && typeof v.label === "string" && Number.isFinite(v.value) && !again(`v|${v.step}|${v.label}|${v.value}`)) addEvent({ source: "value", text: `${v.label} ${v.value} ${v.unit}`, data: v });
  return c.json({ ok: true });
});
/** A timer, note, photo, done or skip in the trial: one log line each. */
view.post("/mark", async (c) => {
  const m = (await body<{ mark?: GlassesMark }>(c)).mark;
  if (session && m && typeof m.text === "string" && typeof m.kind === "string" && !again(`m|${m.kind}|${m.step}|${m.text}`, 10_000)) addEvent({ source: "mark", kind: m.kind, text: m.text.slice(0, 400), step: Number.isInteger(m.step) && m.step >= 0 ? m.step + 1 : null, ...(m.at && !Number.isNaN(Date.parse(m.at)) ? { at: m.at } : {}) });
  return c.json({ ok: true });
});
/** The trial as the browser has it, kept in the recording's folder as trial.json. */
view.post("/trial", async (c) => {
  const t = (await body<{ trial?: unknown }>(c)).trial;
  if (session && t && typeof t === "object") writeFileSync(join(session.dir, "trial.json"), JSON.stringify(t, null, 2));
  return c.json({ ok: true });
});
/** Say something back (the trial view works out what; see src/lib/glassesAsk.ts). */
view.post("/say", async (c) => {
  const text = ((await body<{ text?: string }>(c)).text ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (text && !again(`s|${text}`)) speak(text);
  return c.json({ ok: Boolean(text) });
});
/** Adds one of the kitchen SOPs to this browser's own SOPs (they live in the browser), then opens it. */
view.get("/import/:id", (c) => { const r = importPage(c.req.param("id")); return r.status === 200 ? c.html(r.body) : c.text(r.body, 404); });
view.get("/recordings", (c) => c.json(readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse()));
/** Delete a finished recording: its video, frames and log. */
view.delete("/recordings/:id", (c) => {
  const id = c.req.param("id");
  if (!/^[\w-]+$/.test(id) || session?.id === id || !existsSync(join(ROOT, id))) return c.json({ error: "no such finished recording" }, 404);
  rmSync(join(ROOT, id), { recursive: true, force: true });
  return c.json({ ok: true });
});
// Replays of finished recordings: /replay/<id>, and the video, frames and log behind it (server/glasses-replay.ts).
view.route("/", replayRoutes(ROOT, FFMPEG, (id) => session?.id === id));
glasses.route("/", view);

export const glassesInfo = () => `glasses: key ${KEY.slice(0, 4)}… · media ${MEDIAMTX && FFMPEG ? "ready" : "missing (brew install mediamtx ffmpeg)"} · camera log ${OBSERVER_OFF ? "off" : apiKeyPresent() ? `on (${MODEL}, every ${OBSERVE_MS / 1000} s)` : "off (no key)"} · voice ${voiceName()} · speech ${WHISPER && WHISPER_MODEL ? "Whisper on this computer" : "from the phone app only (set GLASSES_WHISPER_MODEL)"}`;
