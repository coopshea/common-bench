// What the hero answer must do (BRIEF "The hero moment"). Used before saving a recording to
// the cache, and handy for prompt iteration. Deterministic checks only.

import type { DraftTrial, LedgerChange } from "../src/shared/types.ts";
import type { RunAgentResult } from "./agent.ts";
import { citationFor, extractCitationIds } from "./notebook.ts";

export interface HeroCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

type HeroInput = Pick<RunAgentResult, "answer" | "citations" | "proposals">;

export function checkHero(r: HeroInput): { pass: boolean; results: HeroCheck[] } {
  const a = r.answer;
  const cited = extractCitationIds(a);
  // Evidence lives in the table; the prose around it must stay short.
  const prose = a.split("\n").filter((l) => !l.trim().startsWith("|")).join(" ");
  const words = prose.split(/\s+/).filter(Boolean).length;
  const tableRows = a.split("\n").filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]+\|\s*$/.test(l)).length;
  const ledger = r.proposals.find((p) => p.kind === "ledger");
  const draft = r.proposals.find((p) => p.kind === "draft");
  const changes = (ledger?.payload ?? []) as LedgerChange[];
  const l2 = changes.find((c) => c.op === "update" && c.id === "L2") as Extract<LedgerChange, { op: "update" }> | undefined;
  const add = changes.find((c) => c.op === "add") as Extract<LedgerChange, { op: "add" }> | undefined;
  const d = draft?.payload as DraftTrial | undefined;
  const arm = (degassed: boolean) =>
    d?.arms.find((x) => x.recipe.diluent_wt === 38 && x.recipe.photoinit_wt === 1.7 && x.recipe.degas_min > 0 === degassed);

  const results: HeroCheck[] = [
    { name: "leads with campaign B: 1.19–1.44 Pa·s with the current diluent", ok: /1\.19/.test(a) && /1\.44/.test(a) },
    { name: "names the degassing confound", ok: /degas/i.test(a) },
    { name: "cites T08, T13 and T09", ok: ["T08", "T13", "T09"].every((id) => cited.includes(id)), detail: cited.join(" ") },
    { name: "cites T09's log gap", ok: cited.includes("T09-L05") || cited.includes("T09-L07") || /18\.2/.test(a) },
    { name: "brittle → flaw-sensitive, bubbles are flaws", ok: /brittle/i.test(a) && /flaw/i.test(a) && /bubble/i.test(a) },
    { name: "credits Shreya", ok: /\byou(r)?\b|shreya/i.test(a) },
    { name: "states uncertainty", ok: /uncertain|small sample|few trials|only \w+ |extrapolat|single|one trial|one specimen|not (yet )?(proven|tested|shown)|untested|can't prove|cannot prove|caveat/i.test(a) },
    { name: "proposes T15a and T15b (control)", ok: /T15a/.test(a) && /T15b/.test(a) && /control/i.test(a) },
    { name: "nothing to order (no DiluentX)", ok: /nothing (needs|to) (be )?order|no need to order|don't need to order|no order|nothing to buy/i.test(a) },
    { name: "time contrast vs DiluentX (afternoon vs 6 weeks)", ok: /6 weeks|six weeks|6-week|six-week/i.test(a) && /afternoon|a day|one day|same day|this week|days?\b/i.test(a) },
    { name: "brackets hold only ids", ok: [...a.matchAll(/\[([^\]]*)\]/g)].every((m) => /^\s*(T\d{2}(-L\d{2})?|L\d{1,3})(\s*,\s*(T\d{2}(-L\d{2})?|L\d{1,3}))*\s*$/.test(m[1])) },
    { name: "every cited id exists", ok: cited.every((id) => citationFor(id) !== null), detail: cited.filter((id) => !citationFor(id)).join(" ") },
    { name: `prose under ~120 words outside the table (${words})`, ok: words <= 125 },
    { name: "evidence table with 3–4 rows", ok: tableRows >= 4 && tableRows <= 5, detail: `${tableRows - 1} rows` },
    { name: "hypothesis stated tentatively", ok: /^Hypothesis:.*\b(may|might|could|would)\b/im.test(a) },
    { name: "the new finding is credited to Shreya in the text", ok: !/finding (under|for|owned by) (Cooper|him)\b/i.test(a) },
    { name: "opening sentence states facts, not causes", ok: !/\b(because|due to|caused by|removes|explains)\b/i.test(a.split(/\n\s*\n/)[0] ?? "") },
    {
      name: "ledger: L2 → disputed, confounded by degassing (see T09, T13)",
      ok:
        l2?.patch.status === "disputed" &&
        /reason disputed: confounded by degassing/i.test(l2.patch.status_note ?? "") &&
        /T09/.test(l2.patch.status_note ?? "") &&
        /T13/.test(l2.patch.status_note ?? ""),
      detail: l2?.patch.status_note,
    },
    {
      name: "ledger: new candidate finding owned by Shreya, pending T15",
      ok:
        add?.item.owner === "shreya" &&
        add.item.status === "candidate" &&
        add.item.pending_on === "T15" &&
        /degass/i.test(add.item.text) &&
        /barrier/i.test(add.item.text),
      detail: add?.item.text,
    },
    { name: "draft: T15a = 38% / 1.7% PI / degas (treatment)", ok: arm(true)?.role === "treatment" && arm(true)?.id === "T15a" },
    { name: "draft: T15b = same, no degas (control)", ok: arm(false)?.role === "control" && arm(false)?.id === "T15b" },
    { name: "draft: owner Shreya, nothing to order", ok: d?.owner === "shreya" && d?.nothing_to_order === true },
  ];
  return { pass: results.every((x) => x.ok), results };
}
