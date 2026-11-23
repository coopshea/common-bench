// Questions put to a recording after the fact: the chemistry exchange (the molecules, a hypothesis, how much gas to
// expect) laid into a quiet stretch of a finished recording, asked in one voice and answered in the app's own.
// Nobody said these at the time, so every line is marked as added and the video says so on the panel.
//
//   npm run ask-after -- <id>              right after the last amount weighed before the first measurement
//   npm run ask-after -- <id> --at 5:40    starting that far into the recording's video
//
// The answers are the trial's own (src/lib/glassesAsk.ts), worked from what was weighed in that recording.
// Writes recordings/<id>/extra.jsonl; `npm run export -- <id> --cut --extra` then draws and voices it.
// Needs an ElevenLabs key, to know how long each line takes to say.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { answer } from "../src/lib/glassesAsk.ts";
import type { RunState } from "../src/lib/benchRun.ts";
import type { GlassesContext, GlassesEvent } from "../src/shared/glasses.ts";
import { ASK_VOICE } from "./glasses-export.ts";
import { voiceFile } from "./voice.ts";

const ROOT = fileURLToPath(new URL("../recordings", import.meta.url));
export const QUESTIONS = [
  "Can you pull up the molecules and show me the electronegativity?",
  "I hypothesize the hydrogen on the acid hops to the bicarbonate, and that releases carbon dioxide.",
  "How much gas should I expect?",
];
const seconds = (file: string) => Number(spawnSync("/opt/homebrew/bin/ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout) || 0;

const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith("--") && !/^\d+:\d+$/.test(a));
if (!id || !existsSync(join(ROOT, id, "session.json"))) { console.error("Which recording? npm run ask-after -- <id>"); process.exit(1); }
const dir = join(ROOT, id);
const meta = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as { parts?: { n: number; t0: number }[]; context: GlassesContext | null };
const proto = meta.context?.protocol;
if (!proto?.reaction) { console.error("This recording's SOP has no reaction to ask about."); process.exit(1); }
const run = JSON.parse(readFileSync(join(dir, "trial.json"), "utf8")) as RunState;
const log = readFileSync(join(dir, "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as GlassesEvent);
const t0 = meta.parts?.[0]?.t0 ?? statSync(join(dir, readdirSync(dir).filter((f) => /^video-\d+\.mp4$/.test(f)).sort()[0])).birthtimeMs;

// Where it starts: said outright, or once the last weighing before the first measurement has been answered.
const atArg = argv[argv.indexOf("--at") + 1], results = new Set(proto.steps.flatMap((s) => s.fields).filter((f) => f.result).map((f) => f.label));
const values = log.filter((e) => e.source === "value");
const firstResult = values.findIndex((e) => results.has((e.data as { label?: string } | undefined)?.label ?? ""));
const lastWeighed = values[(firstResult < 0 ? values.length : firstResult) - 1];
let t = argv.includes("--at") && /^\d+:\d+$/.test(atArg) ? t0 + (Number(atArg.split(":")[0]) * 60 + Number(atArg.split(":")[1])) * 1000 : lastWeighed ? Date.parse(lastWeighed.at) + 7000 : t0 + 5000;

// By default: only the mechanism, drawn plain for nine seconds, with nothing said. --dialogue adds the spoken exchange.
if (!argv.includes("--dialogue")) {
  writeFileSync(join(dir, "extra.jsonl"), JSON.stringify({ id: "added-mechanism", at: new Date(t).toISOString(), source: "mark", kind: "mechanism", text: "Mechanism", added: true }) + "\n");
  console.log(`Wrote the mechanism at ${Math.floor((t - t0) / 60000)}:${String(Math.floor(((t - t0) / 1000) % 60)).padStart(2, "0")}. Next: npm run export -- ${id} --cut --extra`);
  process.exit(0);
}
const out: GlassesEvent[] = [];
for (const [k, q] of QUESTIONS.entries()) {
  const a = answer(q, proto, run, null);
  if (!a) { console.log(`  no answer to: ${q}`); continue; }
  const qf = await voiceFile(q, 20_000, ASK_VOICE), af = await voiceFile(a, 20_000);
  if (!qf || !af) { console.error("The voice service didn't answer (is ELEVENLABS_API_KEY set and still good?)."); process.exit(1); }
  out.push({ id: `added-q${k}`, at: new Date(t).toISOString(), source: "voice", text: q, added: true } as GlassesEvent);
  t += seconds(qf) * 1000 + 450;
  out.push({ id: `added-a${k}`, at: new Date(t).toISOString(), source: "reply", text: a, added: true } as GlassesEvent);
  console.log(`  ${Math.floor((Date.parse(out[out.length - 2].at) - t0) / 60000)}:${String(Math.floor(((Date.parse(out[out.length - 2].at) - t0) / 1000) % 60)).padStart(2, "0")}  “${q}”\n        → ${a}`);
  t += seconds(af) * 1000 + 900;
}
writeFileSync(join(dir, "extra.jsonl"), out.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`Wrote ${out.length} added lines, ending ${Math.round((t - Date.parse(out[0].at)) / 1000)} s after they start. Next: npm run export -- ${id} --cut --extra`);
