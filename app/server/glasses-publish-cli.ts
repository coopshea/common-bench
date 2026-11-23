// Publish a finished recording's replay to the hosted copy of the app, so it opens on the web by a private link.
//
//   npm run publish-trial                     the latest recording
//   npm run publish-trial -- <id>             that one
//   npm run publish-trial -- <id> --remove    take its copy down (the link stops working)
//   npm run publish-trial -- --list           the links given out from this computer
//   npm run publish-trial -- <id> --to=http://localhost:8799   somewhere other than PUBLISH_TO
//
// Needs PUBLISH_KEY (the same value the hosted copy has) and, unless --to is given, PUBLISH_TO; both can sit in
// .env.local. See server/glasses-publish.ts for what is sent and who can see it.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishRecording, publishedLinks, unpublishRecording } from "./glasses-publish.ts";

const ROOT = process.env.RECORDINGS_DIR ?? fileURLToPath(new URL("../recordings/", import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const which = (bin: string) => ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", ...(process.env.PATH ?? "").split(":")].map((d) => join(d, bin)).find((p) => existsSync(p));

if (argv.includes("--list")) {
  const links = publishedLinks(ROOT);
  console.log(links.length ? links.map((l) => `${l.id}  ${l.url}`).join("\n") : "Nothing is published from this computer.");
  process.exit(0);
}

const latest = () => (existsSync(ROOT) ? readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, "log.jsonl"))).map((d) => d.name).sort().pop() : undefined);
const id = argv.find((a) => !a.startsWith("--")) ?? latest();
const to = flag("to") ?? process.env.PUBLISH_TO ?? "https://labworkers.app";
const key = process.env.PUBLISH_KEY;
if (!id) { console.error("No recording to publish."); process.exit(1); }
if (!key) { console.error("Set PUBLISH_KEY (in .env.local) to the hosted copy's publish key."); process.exit(1); }

try {
  if (argv.includes("--remove")) {
    console.log((await unpublishRecording({ root: ROOT, id, to, key })) ? `Removed ${id} from ${to}. Its link no longer works.` : `${id} was not published to ${to} from this computer.`);
  } else {
    console.log(`Publishing ${id} to ${to}`);
    const r = await publishRecording({ root: ROOT, id, to, key, ffmpeg: which("ffmpeg"), say: (s) => console.log(s) });
    console.log(`Sent ${r.sent} files (${(r.bytes / 1024 / 1024).toFixed(1)} MB)${r.skipped ? `, ${r.skipped} already there` : ""}.\nAnyone with this link can watch it:\n${r.url}`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
