// Run one question live through runAgent and print the event stream compactly.
//   node_modules/.bin/tsx --env-file=.env.local server/scripts/ask.ts "question" [--record | --reject] [--model claude-haiku-5-5] [--json out.json]
// Default approvals: auto-approve each proposal after 1.5 s (like a person clicking).

import { writeFileSync } from "node:fs";
import { runAgent } from "../agent.ts";
import { HERO_QUESTION } from "../cache.ts";
import { checkHero } from "../hero-checks.ts";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const question = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && ["--model", "--json"].includes(args[i - 1]))) ?? HERO_QUESTION;

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
let answerOpen = false;

const res = await runAgent({
  question,
  model: opt("--model"),
  approvals: flag("--record")
    ? "record"
    : async () => {
        await new Promise((r) => setTimeout(r, 1500));
        return flag("--reject") ? "reject" : "approve";
      },
  onEvent: (e) => {
    if (e.type === "answer") {
      if (!answerOpen) process.stdout.write(`${stamp()} ANSWER${e.delta ? "" : " (reset)"}: `);
      answerOpen = e.delta;
      process.stdout.write(e.text);
      return;
    }
    if (answerOpen) {
      process.stdout.write("\n");
      answerOpen = false;
    }
    if (e.type === "trace") console.log(`${stamp()} TRACE ${e.step.status.padEnd(7)} ${e.step.label}${e.step.summary ? `  →  ${e.step.summary}` : ""}`);
    else if (e.type === "diff") console.log(`${stamp()} DIFF ${e.diff.a} vs ${e.diff.b}: ${e.diff.rows.filter((r) => r.kind !== "same").map((r) => `${r.field}=${r.kind}`).join(", ")} | related ${e.diff.related.map((r) => r.trial).join(",")}`);
    else if (e.type === "citations") console.log(`${stamp()} CITATIONS ${e.items.map((c) => c.id).join(", ")}`);
    else if (e.type === "ledger_proposal" || e.type === "draft") console.log(`${stamp()} ${e.type.toUpperCase()} [${e.proposal.status}] ${e.proposal.title} :: ${e.proposal.summary}`);
    else if (e.type === "done") console.log(`${stamp()} DONE cost $${e.cost_usd} ms ${e.ms} model ${e.model}`);
    else if (e.type === "error") console.log(`${stamp()} ERROR ${e.message}`);
  },
});

console.log("\n--- answer words:", res.answer.split(/\s+/).filter(Boolean).length, "| tools:", res.tool_calls.map((t) => t.name).join(", "));
if (question === HERO_QUESTION) {
  const c = checkHero(res);
  console.log("--- hero checks:", c.pass ? "PASS" : "FAIL");
  for (const r of c.results) console.log(`   ${r.ok ? "ok  " : "MISS"} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
}
const out = opt("--json");
if (out) writeFileSync(out, JSON.stringify(res, null, 2));
