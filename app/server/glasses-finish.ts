// Everything that happens after a recording, in one go, with nobody at the keyboard:
//   1. work through the video again from its sound (npm run reprocess) and write the report,
//   2. make the two video files (npm run export): key moments, and the whole recording,
//   3. say where they are (and with --open, show the folder in Finder).
// The server runs this by itself when a recording stops (GLASSES_AUTOFINISH=0 turns that off).
//
//   npm run finish                 the latest recording
//   npm run finish -- <id> --open  that one, and open the folder when done
//
// What the live log caught is what gets drawn. If the second pass over the sound finds values the live log missed,
// a second key-moments file is made from that pass too (key-moments-rebuilt.mp4), so there is always one to use.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GlassesEvent } from "../src/shared/glasses.ts";
import { exportRecording, latestRecording } from "./glasses-export.ts";
import { readScale } from "./glasses-read.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(APP, "recordings");
const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith("--")) ?? latestRecording();
if (!id || !existsSync(join(ROOT, id, "log.jsonl"))) { console.error("No such recording."); process.exit(1); }
const dir = join(ROOT, id), out = join(dir, "export");
mkdirSync(out, { recursive: true });
const logFile = join(out, "finish.log");
writeFileSync(logFile, "");
const say = (s: string) => { console.log(s); appendFileSync(logFile, s + "\n"); };
const events = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as GlassesEvent) : []);
const values = (ev: GlassesEvent[]) => ev.filter((e) => e.source === "value").map((e) => `${(e.data as { step?: number } | undefined)?.step}:${(e.data as { value?: number } | undefined)?.value}`).sort().join(" ");

say(`Finishing ${id}`);
// 1. The second pass. It fails loudly on its own checks; the videos are still made from the live log.
const tsx = join(APP, "node_modules", ".bin", "tsx");
const re = spawnSync(tsx, ["--env-file-if-exists=.env.local", "server/glasses-reprocess.ts", id], { cwd: APP, encoding: "utf8", timeout: 15 * 60_000 });
appendFileSync(logFile, (re.stdout ?? "") + (re.stderr ?? ""));
say(re.status === 0 ? "Second pass over the sound: passed" : "Second pass over the sound: see the checks in this file");

// 1b. What the scale's display showed as each value was said (needs the key; skipped quietly without one).
if (process.env.GLASSES_READ_SCALE !== "0" && existsSync(join(dir, "derived", "segments.json"))) {
  try {
    const r = await readScale(id, say);
    const read = r.filter((x) => x.readable);
    say(`Displays: ${read.length} of ${r.length} read, ${read.filter((x) => x.agrees).length} agree with what was said${read.some((x) => !x.agrees) ? `, ${read.filter((x) => !x.agrees).length} DIFFER` : ""}. Cut-outs are in derived/readings/.`);
  } catch (e) { say(`Displays not read: ${e instanceof Error ? e.message : String(e)}`); }
}

// 2. The videos.
const live = values(events(join(dir, "log.jsonl"))), rebuilt = values(events(join(dir, "derived", "log.jsonl")));
const jobs: { cut: boolean; derived?: boolean; name?: string }[] = [{ cut: true }, { cut: false }];
if (live && rebuilt && live !== rebuilt) { jobs.push({ cut: true, derived: true, name: "key-moments-rebuilt" }); say(`The live log and the second pass disagree on what was recorded.\n  live:    ${live}\n  rebuilt: ${rebuilt}`); }
let made = 0;
for (const j of jobs) {
  try {
    const r = await exportRecording(id, j);
    made += 1;
    say(`${r.file}  (${Math.floor(r.seconds / 60)}:${String(Math.round(r.seconds % 60)).padStart(2, "0")}${r.card ? ", ends on the closing card" : ""})`);
  } catch (e) { say(`Could not make ${j.name ?? (j.cut ? "key-moments" : "full")}.mp4: ${e instanceof Error ? e.message : String(e)}`); }
}
say(made ? "Done." : "No video was made.");
if (argv.includes("--open") && made && process.platform === "darwin") spawnSync("open", [out]);
process.exit(made ? 0 : 1);
