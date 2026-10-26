// The typed handoffs between the coordinator and its three subagents.
// Each subagent ends by calling its submit_* custom tool with one of these. The client validates the
// input against the schema and returns the errors if it doesn't match, so every report the UI shows is typed.
// One schema per question: what have we tried, how well did it work (and why), what do we try next.

import { z } from "zod";
import { DraftPlanShape, LedgerChangeInput } from "../server/tools.ts";

const TrialId = z.string().regex(/^T\d{2,4}[a-z]?$/, 'A trial id, e.g. "T09"');
const EvidenceId = z.string().describe('A trial ("T09"), log entry ("T09-L04") or ledger item ("L2") id');
const Person = z.enum(["cooper", "shreya"]);

// ---------- 1. Historian: "What have we tried?" ----------

export const TriedReport = z.object({
  question: z.string().describe("The question you were given, restated in one line"),
  relevant_trials: z
    .array(
      z.object({
        id: TrialId,
        owner: Person,
        relation: z
          .enum(["direct_match", "near_miss", "contradicts", "context"])
          .describe("direct_match: tried exactly this; near_miss: close but different; contradicts: result disagrees with the region's verdict; context: background"),
        why: z.string().describe("One sentence, with the numbers that make it relevant"),
      }),
    )
    .describe("Most relevant first. At most 12."),
  regions: z
    .array(
      z.object({
        label: z.string().describe('Plain name, e.g. "high diluent (34–40%), not degassed"'),
        trial_ids: z.array(TrialId),
        owner: Person,
        outcome: z.string().describe("What happened there, with numbers"),
        verdict_at_the_time: z.enum(["dead_end", "promising", "abandoned", "active", "none"]),
        ledger_id: z.string().nullable().describe("The ledger item that records the verdict, or null"),
      }),
    )
    .describe("Areas of the recipe space someone already searched"),
  dismissed_results: z
    .array(z.object({ trial_id: TrialId, reason_given: z.string(), worth_revisiting: z.boolean() }))
    .describe("Trials their owner excluded or explained away"),
  not_yet_tried: z.array(z.string()).describe("Gaps: combinations nobody has run, one line each"),
});
export type TriedReportT = z.infer<typeof TriedReport>;

// ---------- 2. Analyst: "How well did it work, and why?" ----------

const Group = z.object({
  label: z.string().describe('e.g. "degassed, diluent > 30%"'),
  trial_ids: z.array(TrialId),
  n: z.number().int(),
  mean: z.number(),
});

export const AnalysisReport = z.object({
  comparisons: z
    .array(
      z.object({
        claim: z.string().describe("One sentence the numbers support"),
        metric: z.string().describe('Field name from the notebook, e.g. "uts_mpa"'),
        group_a: Group,
        group_b: Group,
        computed_by: z
          .string()
          .describe("Where the numbers came from: the tool name, or the script path under /mnt/session/outputs/analysis/"),
      }),
    )
    .describe("Every number here was computed by a tool or a script, never estimated in your head"),
  protocol_diffs: z.array(
    z.object({
      a: TrialId,
      b: TrialId,
      intended: z.array(z.object({ field: z.string(), a: z.string(), b: z.string() })).describe("Variables changed on purpose"),
      unintended: z
        .array(z.object({ step: z.string(), a: z.string(), b: z.string(), evidence_ids: z.array(EvidenceId) }))
        .describe("Differences nobody meant to make"),
    }),
  ),
  likely_cause: z
    .object({
      cause: z.string().describe('e.g. "bubbles from skipping degassing", not "the recipe"'),
      mechanism: z.string().describe("Why it would produce the result, in plain physics"),
      supporting_ids: z.array(EvidenceId),
      against_ids: z.array(EvidenceId).describe("Evidence that cuts the other way; empty if none"),
    })
    .nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  caveats: z.array(z.string()),
});
export type AnalysisReportT = z.infer<typeof AnalysisReport>;

// ---------- 3. Planner: "What do we try next?" ----------
// The plan itself goes through draft_trial / propose_ledger_update (approval-gated, the same schemas the
// Agent SDK path uses). The report says what it proposed and why, so the coordinator can answer.

export const PlanReport = z.object({
  recommendation: z.string().describe("One or two sentences: what to run next and what it settles"),
  draft_proposal_id: z.string().nullable().describe("The id draft_trial returned, or null if you proposed none"),
  ledger_proposal_id: z.string().nullable(),
  control_arm: z.string().describe("What the control isolates, in one sentence"),
  avoids: z.string().describe("The costlier path this replaces, e.g. a six-week material order, or 'nothing'"),
  credit_to: Person.describe("The person whose work produced the finding this plan tests"),
  status: z.enum(["approved", "rejected", "pending"]).describe("What the approval tool returned"),
});
export type PlanReportT = z.infer<typeof PlanReport>;

export const DraftPlan = z.object(DraftPlanShape);
export const LedgerChanges = z.object({ changes: z.array(LedgerChangeInput).min(1).max(4) });

// ---------- Coordinator: the answer the person sees ----------

export const FinalAnswer = z.object({
  answer: z
    .string()
    .describe("Plain answer to the asker, 120–220 words. Cite ids inline in square brackets, e.g. [T09], [T09-L04], [L2]."),
  cited_ids: z.array(EvidenceId),
  reports_used: z.array(z.enum(["historian", "analyst", "planner"])),
  proposals: z.array(z.string()).describe("Proposal ids the planner created, in order"),
});
export type FinalAnswerT = z.infer<typeof FinalAnswer>;

/** JSON Schema for a custom tool's input_schema. */
export function inputSchema(s: z.ZodObject) {
  const { $schema: _drop, ...json } = z.toJSONSchema(s, { target: "draft-7" }) as Record<string, unknown>;
  return json as { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

/** Validate a submit_* input. Returns the parsed value, or an error message the agent can act on. */
export function check<T>(s: z.ZodType<T>, input: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const r = s.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  const issues = r.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, error: `Input doesn't match the schema. Fix these and call again:\n- ${issues.join("\n- ")}` };
}
