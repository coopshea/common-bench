// Check recorded runs in server/cache/ against the hero requirements and print the answer.
//   node_modules/.bin/tsx server/scripts/check-cache.ts [file.json]
// Exit code 1 if the hero recording fails a check.

import { readFileSync } from "node:fs";
import type { AskEvent, Proposal } from "../../src/shared/types.ts";
import { HERO_QUESTION, loadRecordings, normalizeQuestion, type Recording } from "../cache.ts";
import { checkHero } from "../hero-checks.ts";
import { extractCitationIds } from "../notebook.ts";

const file = process.argv[2];
const recs: Recording[] = file ? [JSON.parse(readFileSync(file, "utf8"))] : loadRecordings();
let failed = false;

for (const rec of recs) {
  let answer = "";
  const proposals = new Map<string, Proposal<unknown>>();
  let paceMs = 0;
  for (const en of rec.entries) {
    if (!("event" in en)) continue;
    paceMs += en.dt;
    const e: AskEvent = en.event;
    if (e.type === "answer") answer = e.delta ? answer + e.text : e.text;
    if (e.type === "ledger_proposal" || e.type === "draft") proposals.set(e.proposal.id, e.proposal);
  }
  console.log(`\n# ${rec.question}\n  recorded ${rec.recorded_at} · ${rec.model} · $${rec.cost_usd.toFixed(4)} · ${(rec.ms / 1000).toFixed(1)} s live · replay ≈ ${(paceMs / 1000).toFixed(1)} s + approvals · ${rec.entries.length} entries`);
  console.log(`\n${answer}\n`);
  if (rec.key === normalizeQuestion(HERO_QUESTION)) {
    const c = checkHero({ answer, citations: extractCitationIds(answer), proposals: [...proposals.values()] });
    for (const r of c.results) console.log(`  ${r.ok ? "ok  " : "MISS"} ${r.name}${r.detail && !r.ok ? ` (${r.detail})` : ""}`);
    console.log(`  hero: ${c.pass ? "PASS" : "FAIL"}`);
    if (!c.pass) failed = true;
  }
}
process.exit(failed ? 1 : 0);
