// A recording as a video file anyone can play: the footage with the record drawn on it, ending on the closing card.
//
//   npm run export                     the latest recording: key moments (export/key-moments.mp4) and the whole thing (export/full.mp4)
//   npm run export -- <id>             that recording
//   npm run export -- <id> --cut       only the key moments          --full   only the whole recording
//   npm run export -- <id> --derived   draw the log rebuilt from the video (npm run reprocess) instead of the live one
//   npm run export -- <id> --cut=8,4   seconds kept before and after each moment (6 and 3 unless said)
//
// How: the replay page (server/replay.html?overlay&export) draws the overlay for any moment asked of it. A browser
// with no window is asked ten times a second of the finished video what the overlay looks like; each time it has
// changed, a picture of it is kept. ffmpeg then lays those pictures over the footage. Nothing is screen-recorded,
// so the same recording always gives the same file.
//
// Needs the app running (npm run dev) for the page, plus ffmpeg and Chrome on this computer.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { voiceFile } from "./voice.ts";

const ROOT = fileURLToPath(new URL("../recordings", import.meta.url));
const which = (bin: string) => ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", ...(process.env.PATH ?? "").split(":")].map((d) => join(d, bin)).find((p) => existsSync(p));
const FFMPEG = which("ffmpeg"), FFPROBE = which("ffprobe");
const SAY = which("say");
/** The voice a question added afterwards is asked in (ElevenLabs voice id). */
export const ASK_VOICE = process.env.ELEVENLABS_VOICE_ASK ?? "bIHbv24MWmeRgasZH58o";
const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  which("chromium"), which("google-chrome"),
].find((p) => p && existsSync(p));

const W = 1920, H = 1080, FPS = 30, STEP_MS = 100, HOLD_S = 8, SKIP_CHIP_MS = 1600;
/** Seconds the opening card is held. */
const INTRO_S = [3];

export interface ExportResult { file: string; seconds: number; pictures: number; card: boolean }
interface Cbx { intros: number; t0: number; tEnd: number; windows: [number, number][]; cardAt: number | null; parts: { n: number; t0: number }[]; title: string; trial: string; derived: boolean }

// ---- A browser with no window, spoken to directly (Chrome's own debugging protocol; no extra package) ----
async function browser() {
  if (!CHROME) throw new Error("Chrome isn't installed (or set CHROME_PATH)");
  const profile = mkdtempSync(join(os.tmpdir(), "cb-export-"));
  const p = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", "--enable-unsafe-swiftshader", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const port = await new Promise<number>((res, rej) => {
    let err = "";
    const t = setTimeout(() => rej(new Error("Chrome didn't start")), 20_000);
    p.stderr!.on("data", (d: Buffer) => { err += d.toString(); const m = err.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) { clearTimeout(t); res(Number(m[1])); } });
    p.once("exit", () => { clearTimeout(t); rej(new Error("Chrome closed straight away")); });
  });
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("couldn't reach Chrome")); });
  let seq = 0;
  const waiting = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data)) as { id?: number; result?: unknown; error?: { message: string } };
    const w = msg.id == null ? undefined : waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id!);
    if (msg.error) w.rej(new Error(msg.error.message)); else w.res(msg.result);
  };
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((res, rej) => { const id = ++seq; waiting.set(id, { res: res as (v: unknown) => void, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async <T>(expression: string) => {
    const r = await send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const close = () => { try { ws.close(); } catch { /* already gone */ } p.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); };
  return { send, evaluate, close };
}

const run = (bin: string, args: string[]) => new Promise<{ code: number; err: string }>((res) => {
  const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr!.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
  p.once("exit", (code) => res({ code: code ?? 1, err }));
  p.once("error", (e) => res({ code: 1, err: e.message }));
});
const probe = (file: string) => {
  const out = spawnSync(FFPROBE!, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file], { encoding: "utf8" }).stdout;
  const j = JSON.parse(out || "{}") as { format?: { duration?: string }; streams?: { codec_type: string }[] };
  return { seconds: Number(j.format?.duration ?? 0), sound: (j.streams ?? []).some((s) => s.codec_type === "audio") };
};

/** The app's address: the page's fonts come from the web side, so that one is tried first. */
async function base() {
  for (const b of [process.env.BENCH_URL, "http://localhost:5173", `http://localhost:${process.env.PORT ?? 8787}`]) {
    if (!b) continue;
    try { if ((await fetch(`${b}/api/glasses/recordings`, { signal: AbortSignal.timeout(3000) })).ok) return b; } catch { /* try the next */ }
  }
  throw new Error("Common Bench isn't running. Start it with: npm run dev");
}

/**
 * Where each answer falls in the finished video: [its place in `times`, milliseconds from the video's start].
 * An answer said during footage that was cut away is left out.
 */
export function placeReplies(pieces: { a: number; b: number; speed?: number }[], times: number[]): [number, number][] {
  const out: [number, number][] = [];
  times.forEach((t, k) => {
    let before = 0;
    for (const p of pieces) {
      const speed = p.speed ?? 1;
      if (t >= p.a && t < p.b) { if (speed === 1) out.push([k, before + (t - p.a)]); return; } // nothing is spoken over a fast stretch
      before += (p.b - p.a) / speed;
    }
  });
  return out;
}

/**
 * Which stretches of footage go into the video. `parts` are the video files (start in ms since 1970, length in
 * seconds); `windows` the stretches worth keeping. Without a cut, or with nothing to keep, it is everything.
 * A stretch that runs from one part into the next becomes two pieces; under a fifth of a second is dropped.
 * `window` says which stretch a piece came from, so the gap left out before it can be shown.
 */
export function planPieces(parts: { t0: number; seconds: number }[], windows: [number, number][], cut: boolean): { part: number; a: number; b: number; window: number }[] {
  if (!parts.length) return [];
  const first = parts[0].t0, last = parts[parts.length - 1].t0 + parts[parts.length - 1].seconds * 1000;
  const wanted: [number, number][] = cut && windows.length ? windows : [[first, last]];
  return wanted.flatMap(([a, z], k) => parts.flatMap((p, n) => { const s = Math.max(a, p.t0), e = Math.min(z, p.t0 + p.seconds * 1000); return e - s >= 200 ? [{ part: n, a: s, b: e, window: k }] : []; }));
}

export const latestRecording = () => readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, "log.jsonl"))).map((d) => d.name).sort().pop();

export async function exportRecording(id: string, o: { cut: boolean; derived?: boolean; pre?: number; post?: number; name?: string; replies?: boolean; intro?: boolean; fast?: boolean; extra?: boolean; say?: (s: string) => void }): Promise<ExportResult> {
  if (!FFMPEG || !FFPROBE) throw new Error("ffmpeg isn't installed (brew install ffmpeg)");
  const dir = join(ROOT, id);
  if (!existsSync(join(dir, "log.jsonl"))) throw new Error(`no recording ${id}`);
  const say = o.say ?? (() => {});
  const b = await base();
  const outDir = join(dir, "export");
  const tmp = join(outDir, `.work-${o.name ?? (o.cut ? "cut" : "full")}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const chrome = await browser();
  try {
    await chrome.send("Page.enable");
    await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: W / 1280, mobile: false });
    await chrome.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const cut = o.cut ? `&cut=${o.pre ?? 6},${o.post ?? 6}` : ""; // six seconds after: long enough to hear the answer
    await chrome.send("Page.navigate", { url: `${b}/api/glasses/replay/${id}?overlay&export${cut}${o.derived ? "&derived" : ""}${o.extra ? "&extra" : ""}` });
    let info: Cbx | null = null;
    for (let i = 0; i < 100 && !info; i++) { await new Promise((r) => setTimeout(r, 150)); info = await chrome.evaluate<Cbx | null>("window.cbx ? JSON.parse(JSON.stringify(window.cbx)) : null").catch(() => null); }
    if (!info) throw new Error("the replay page didn't load this recording");
    await chrome.evaluate("document.fonts.ready.then(() => Promise.all([...document.fonts].map((f) => f.load().catch(() => null)))).then(() => true)");

    // The footage: each part's file, and how long it runs.
    const parts = info.parts.map((p) => {
      const n = String(p.n).padStart(3, "0");
      const whole = join(dir, `replay-${n}.mp4`), raw = join(dir, `video-${n}.mp4`);
      const file = existsSync(whole) && statSync(whole).mtimeMs >= statSync(raw).mtimeMs ? whole : raw;
      return { ...p, file, ...probe(file) };
    }).filter((p) => p.seconds > 0);
    if (!parts.length) throw new Error("this recording has no video");
    const kept = planPieces(parts, info.windows, o.cut).map((x) => ({ ...x, part: parts[x.part], speed: 1 }));
    // Between two kept stretches of the same part, what happened is run fast (no sound) rather than dropped, so the
    // work is still seen: at most three seconds for each, however long it really took.
    const pieces: typeof kept = [];
    kept.forEach((pc, k) => {
      const before = kept[k - 1], gap = before && before.part === pc.part ? pc.a - before.b : 0;
      if (o.cut && o.fast !== false && gap > 3000) pieces.push({ part: pc.part, a: before.b, b: pc.a, window: -1, speed: gap / (Math.min(3, Math.max(1.2, gap / 20000)) * 1000) });
      pieces.push(pc);
    });
    if (!pieces.length) throw new Error("nothing in the log falls inside the video");

    // The overlay, asked for every tenth of a second of the finished video; a picture only when it changes.
    const shots: { file: string; seconds: number }[] = [];
    let prev = "";
    const shoot = async (html: string, seconds: number) => {
      if (html === prev && shots.length) { shots[shots.length - 1].seconds += seconds; return; }
      prev = html;
      const { data } = await chrome.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      const file = join(tmp, `ov-${String(shots.length).padStart(5, "0")}.png`);
      writeFileSync(file, Buffer.from(data, "base64"));
      shots.push({ file, seconds });
    };
    let total = 0;
    // The opening cards, on a plain dark ground, before any footage.
    let introS = 0;
    if (o.intro !== false) for (let k = 0; k < info.intros; k++) {
      const html = await chrome.evaluate<string>(`window.cbx.intro(${k})`);
      if (!html) continue;
      const len = INTRO_S[Math.min(k, INTRO_S.length - 1)];
      await shoot(html, len);
      introS += len; total += len;
    }
    for (let k = 0; k < pieces.length; k++) {
      const pc = pieces[k], before = pieces[k - 1];
      const gap = before && pc.window !== before.window && pc.speed === 1 && before.speed === 1 ? pc.a - before.b : 0; // what was left out just before this piece
      const wallStep = STEP_MS * pc.speed; // a tenth of a second of the finished video is this much of the recording
      for (let t = pc.a; t < pc.b; t += wallStep) {
        const len = Math.min(wallStep, pc.b - t) / pc.speed / 1000;
        const html = await chrome.evaluate<string>(`window.cbx.at(${Math.round(t)}, ${gap > 2000 && t - pc.a < SKIP_CHIP_MS ? gap : 0}, false, ${pc.speed > 1 ? pc.speed : 0})`);
        await shoot(html, len);
        total += len;
      }
      say(`  overlay ${k + 1}/${pieces.length}`);
    }
    // The closing card, held on the last picture of the footage.
    const cardHtml = await chrome.evaluate<string>(`window.cbx.at(${Math.max(info.tEnd, pieces[pieces.length - 1].b) + 5000}, 0, true)`);
    const card = cardHtml.includes("ov-card");
    if (card) { await shoot(cardHtml, HOLD_S); total += HOLD_S; }

    const list = join(tmp, "overlay.txt");
    writeFileSync(list, [...shots.map((s) => `file '${s.file.replace(/'/g, "'\\''")}'\nduration ${s.seconds.toFixed(3)}`), `file '${shots[shots.length - 1].file.replace(/'/g, "'\\''")}'`].join("\n") + "\n");

    // Lay it over the footage.
    const args: string[] = ["-hide_banner", "-loglevel", "error", "-y"];
    const filters: string[] = [];
    let n = 0;
    if (introS) {
      args.push("-f", "lavfi", "-t", String(introS), "-i", `color=c=0x141311:s=${W}x${H}:r=${FPS}`, "-f", "lavfi", "-t", String(introS), "-i", "anullsrc=r=48000:cl=stereo");
      filters.push(`[0:v:0]format=yuv420p,setsar=1[vi]`, `[1:a:0]asetpts=PTS-STARTPTS[ai]`);
      n = 2;
    }
    pieces.forEach((pc, k) => {
      const ss = ((pc.a - pc.part.t0) / 1000).toFixed(3), src = ((pc.b - pc.a) / 1000).toFixed(3), t = ((pc.b - pc.a) / pc.speed / 1000).toFixed(3);
      args.push("-ss", ss, "-t", src, "-i", pc.part.file);
      filters.push(`[${n}:v:0]setpts=(PTS-STARTPTS)/${pc.speed.toFixed(4)},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS},setsar=1,format=yuv420p,trim=duration=${t},setpts=PTS-STARTPTS[v${k}]`);
      if (pc.speed > 1) { n += 1; args.push("-f", "lavfi", "-t", t, "-i", "anullsrc=r=48000:cl=stereo"); filters.push(`[${n}:a:0]asetpts=PTS-STARTPTS[a${k}]`); n += 1; return; }
      if (pc.part.sound) filters.push(`[${n}:a:0]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${t},asetpts=PTS-STARTPTS[a${k}]`);
      n += 1;
      if (!pc.part.sound) { args.push("-f", "lavfi", "-t", t, "-i", "anullsrc=r=48000:cl=stereo"); filters.push(`[${n}:a:0]asetpts=PTS-STARTPTS[a${k}]`); n += 1; }
    });
    args.push("-f", "concat", "-safe", "0", "-i", list);
    const ovInput = n;
    n += 1;
    // What the app said back. It was spoken through the computer, so the glasses' microphone has little or none
    // of it: each answer in the log is spoken again here (the same voice and speed) and laid in where it was said.
    const spokenAt: { input: number; ms: number }[] = [];
    if (o.replies !== false) {
      const all = ((await (await fetch(`${b}/api/glasses/recordings/${id}/data?${[o.derived ? "derived=1" : "", o.extra ? "extra=1" : ""].filter(Boolean).join("&")}`)).json()) as { events: { source: string; at: string; text: string; added?: boolean }[] }).events;
      // The app's answers, and any question put in afterwards (in a second voice, since nobody said it at the time).
      const log = all.filter((e) => e.source === "reply" || (e.source === "voice" && e.added));
      for (const [k, at] of placeReplies(pieces, log.map((e) => Date.parse(e.at)))) {
        const text = log[k].text, file = join(tmp, `reply-${k}.aiff`);
        if (!SAY && !process.env.ELEVENLABS_API_KEY) break;
        // The same voice the answers were spoken in: the kept file when there is one, the computer's voice otherwise.
        const made = await voiceFile(text, 20_000, log[k].source === "voice" ? ASK_VOICE : undefined);
        if (!made && (!SAY || spawnSync(SAY, ["-r", "200", "-o", file, text]).status !== 0 || !existsSync(file))) continue;
        args.push("-i", made ?? file);
        spokenAt.push({ input: n, ms: Math.round(at + introS * 1000) });
        n += 1;
      }
    }
    const hold = card ? HOLD_S : 0;
    filters.push(`${introS ? "[vi][ai]" : ""}${pieces.map((_, k) => `[v${k}][a${k}]`).join("")}concat=n=${pieces.length + (introS ? 1 : 0)}:v=1:a=1[bv][ba]`);
    filters.push(`[bv]tpad=stop_mode=clone:stop_duration=${hold}[bv2]`, `[ba]apad=pad_dur=${hold}[ba2]`);
    spokenAt.forEach((r, k) => filters.push(`[${r.input}:a:0]aresample=48000,aformat=channel_layouts=stereo,adelay=${r.ms}:all=1[r${k}]`));
    if (spokenAt.length) filters.push(`[ba2]${spokenAt.map((_, k) => `[r${k}]`).join("")}amix=inputs=${spokenAt.length + 1}:normalize=0:duration=first[bam]`);
    filters.push(`[${ovInput}:v:0]fps=${FPS},format=rgba[ov]`, `[bv2][ov]overlay=0:0:eof_action=repeat:format=auto,format=yuv420p[v]`);
    const file = join(outDir, `${o.name ?? (o.cut ? "key-moments" : "full")}.mp4`);
    args.push("-filter_complex", filters.join(";"), "-map", "[v]", "-map", spokenAt.length ? "[bam]" : "[ba2]", "-t", total.toFixed(3),
      "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-r", String(FPS), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", file);
    say(`  encoding ${Math.round(total)} s`);
    const r = await run(FFMPEG, args);
    if (r.code !== 0) throw new Error(`ffmpeg: ${r.err.trim().split("\n").slice(-3).join(" | ")}`);
    // The card on its own, as a picture to post next to the video.
    if (card) writeFileSync(join(outDir, "card.png"), Buffer.from((await (async () => { await chrome.evaluate(`document.documentElement.style.background = "#141311"; window.cbx.at(${info.tEnd + 5000}, 0, true)`); return chrome.send<{ data: string }>("Page.captureScreenshot", { format: "png" }); })()).data, "base64"));
    rmSync(tmp, { recursive: true, force: true });
    return { file, seconds: probe(file).seconds, pictures: shots.length, card };
  } finally {
    chrome.close();
  }
}

// ---- Run from the command line ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const id = argv.find((a) => !a.startsWith("--")) ?? latestRecording();
  const cutArg = argv.find((a) => a.startsWith("--cut"));
  const [pre, post] = (cutArg?.split("=")[1] ?? "").split(",").map(Number);
  const kinds = argv.includes("--full") && !cutArg ? [false] : cutArg && !argv.includes("--full") ? [true] : [true, false];
  if (!id) { console.error("No recording yet."); process.exit(1); }
  let failed = false;
  for (const cut of kinds) {
    console.log(`${id} · ${cut ? "key moments" : "whole recording"}`);
    try {
      const r = await exportRecording(id, { cut, derived: argv.includes("--derived"), extra: argv.includes("--extra"), fast: !argv.includes("--no-fast"), name: argv.find((a) => a.startsWith("--name="))?.slice(7), pre: pre > 0 ? pre : undefined, post: post > 0 ? post : undefined, say: (s) => process.stdout.write(`\r${s}        `) });
      console.log(`\r  ${r.file}  ·  ${Math.floor(r.seconds / 60)}:${String(Math.round(r.seconds % 60)).padStart(2, "0")}  ·  ${r.card ? "ends on the closing card" : "no closing card (no SOP with this recording)"}`);
    } catch (e) { failed = true; console.error(`\n  failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  process.exit(failed ? 1 : 0);
}
