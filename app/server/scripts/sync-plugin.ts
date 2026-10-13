// Copy the Skill into the plugin so both stay identical. Run after editing skills/.
//   node_modules/.bin/tsx server/scripts/sync-plugin.ts          (copy)
//   node_modules/.bin/tsx server/scripts/sync-plugin.ts --check  (exit 1 if they differ)

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../skills/lab-notebook-analyst/SKILL.md", import.meta.url));
const dstDir = fileURLToPath(new URL("../../plugin/skills/lab-notebook-analyst/", import.meta.url));
const dst = `${dstDir}SKILL.md`;
const same = existsSync(dst) && readFileSync(src, "utf8") === readFileSync(dst, "utf8");

if (process.argv.includes("--check")) {
  console.log(same ? "plugin Skill is in sync" : "plugin Skill differs from skills/: run sync-plugin.ts");
  process.exit(same ? 0 : 1);
}
mkdirSync(dstDir, { recursive: true });
copyFileSync(src, dst);
console.log(`${same ? "unchanged" : "copied"}: skills/lab-notebook-analyst/SKILL.md → plugin/skills/lab-notebook-analyst/SKILL.md`);
