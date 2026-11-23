// Before a shoot: is everything a recording needs in place? Run: npm run glasses:check
// It looks, and changes nothing: no recording is started and the glasses' camera stays off.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";

const PORT = Number(process.env.PORT ?? 8787);
const which = (bin: string) => spawnSync("which", [bin], { encoding: "utf8" }).status === 0;
const rows: [("ok" | "warn" | "fail"), string][] = [];
const say = (level: "ok" | "warn" | "fail", text: string) => rows.push([level, text]);

for (const [bin, why] of [["ffmpeg", "records the video"], ["ffprobe", "reads the video"], ["mediamtx", "takes the glasses' stream in"], ["whisper-server", "turns speech into text"]] as const)
  say(which(bin) ? "ok" : "fail", which(bin) ? `${bin} is installed.` : `${bin} is missing (${why}). brew install ${bin === "whisper-server" ? "whisper-cpp" : bin === "ffprobe" ? "ffmpeg" : bin}`);
const model = process.env.GLASSES_WHISPER_MODEL;
say(model && existsSync(model) ? "ok" : "fail", model && existsSync(model) ? "The speech model is where .env.local says." : "GLASSES_WHISPER_MODEL in .env.local doesn't point at a model file: nothing said will be heard.");

const key = Boolean(process.env.ANTHROPIC_API_KEY);
let online = false;
try { await fetch("https://api.anthropic.com", { method: "HEAD", signal: AbortSignal.timeout(4000) }); online = true; } catch { /* offline */ }
say(key && online ? "ok" : "warn", !key ? "No API key: video and voice will record, but there will be no camera log." : online ? "The camera log can reach Claude." : "No internet: video and voice will record, but there will be no camera log.");

const free = spawnSync("df", ["-g", "."], { encoding: "utf8" }).stdout.split("\n")[1]?.split(/\s+/)[3];
if (free) say(Number(free) >= 5 ? "ok" : "warn", `${free} GB free on this disk (a recording is about 20 MB a minute).`);

interface State { device: { connected: boolean; ready?: boolean; model?: string; battery?: number; wifi?: string | null; wifiState?: string }; recording: unknown; voice: string; media: boolean }
let state: State | null = null;
try { state = (await (await fetch(`http://localhost:${PORT}/api/glasses/state`, { signal: AbortSignal.timeout(3000) })).json()) as State; } catch { /* not running */ }
if (!state) say("fail", `Common Bench isn't running on port ${PORT}. Start it: npm run dev`);
else {
  say("ok", "Common Bench is running.");
  const d = state.device;
  say(d.connected ? "ok" : "fail", d.connected ? `Glasses connected${d.model ? ` (${d.model})` : ""}.` : "The glasses aren't connected: open Bench Glasses on this Mac (or Common Bench in the Mentra app) and turn the glasses on.");
  if (d.connected && d.battery != null) say(d.battery >= 30 ? "ok" : "warn", `Glasses battery ${Math.round(d.battery)}%.`);
  // The glasses send video to this Mac over Wi-Fi, so both have to be on one network that lets devices see each other.
  const mine = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address);
  const theirs = d.wifiState?.match(/(\d+\.\d+\.\d+)\.\d+/)?.[1];
  if (d.connected && theirs) say(mine.some((ip) => ip.startsWith(`${theirs}.`)) ? "ok" : "fail", mine.some((ip) => ip.startsWith(`${theirs}.`)) ? `Glasses and this Mac are on the same network (${d.wifi ?? theirs}).` : `The glasses are on ${d.wifi ?? theirs}.x but this Mac is on ${mine.join(", ") || "no network"}: the video can't reach it.`);
  else if (d.connected) say("warn", "The glasses haven't joined a Wi-Fi network: no video until they do.");
  say(state.voice === "off" ? "warn" : "ok", state.voice === "glasses" ? "Answers are spoken through the glasses." : state.voice === "computer" ? "Answers are spoken through this Mac's speakers (the glasses aren't one of its sound outputs)." : "Spoken answers are off.");
  if (state.recording) say("warn", "A recording is running right now.");
}

const mark = { ok: "✓", warn: "!", fail: "✕" };
console.log("");
for (const [level, text] of rows) console.log(`  ${mark[level]} ${text}`);
const bad = rows.filter(([l]) => l === "fail").length, soso = rows.filter(([l]) => l === "warn").length;
console.log(`\n${bad ? `${bad} to fix before recording.` : soso ? "Ready, with the warnings above." : "Ready to record."}`);
console.log("A hotel or guest network often stops devices seeing each other even on the same network: if the video never arrives, put the glasses and this Mac on a phone's hotspot.\n");
process.exitCode = bad ? 1 : 0;
