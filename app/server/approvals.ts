// Pending approvals: one entry per proposal card, shared by live runs and cache replays.
// POST /api/approve/:id applies the change and resolves the waiting permission callback.

import type { DraftTrial, LedgerItem, PersonId, Proposal, ProposalStatus } from "../src/shared/types.ts";
import { APPROVAL_TIMEOUT_MS, type Decision } from "./agent.ts";
import { applyProposal } from "./tools.ts";

interface Entry {
  proposal: Proposal<unknown>;
  resolve: (d: Decision) => void;
  decision: Promise<Decision>;
  timer: NodeJS.Timeout;
}

const entries = new Map<string, Entry>();

/** Register a pending proposal. Resolves with the person's decision, or "reject" on timeout / cancel. */
export function waitForDecision(p: Proposal<unknown>, timeoutMs = APPROVAL_TIMEOUT_MS): Promise<Decision> {
  const existing = entries.get(p.id);
  if (existing) return existing.decision;
  let resolve!: (d: Decision) => void;
  const decision = new Promise<Decision>((r) => (resolve = r));
  const timer = setTimeout(() => settle(p.id, "reject"), timeoutMs);
  entries.set(p.id, { proposal: p, resolve, decision, timer });
  return decision;
}

function settle(id: string, d: Decision): void {
  const e = entries.get(id);
  if (!e || e.proposal.status !== "pending") return;
  clearTimeout(e.timer);
  e.proposal.status = d === "approve" ? "approved" : "rejected";
  e.resolve(d);
}

/** Reject anything still pending for these ids (client went away). */
export function cancel(ids: string[]): void {
  for (const id of ids) settle(id, "reject");
}

export function decide(
  id: string,
  decision: Decision,
  by: PersonId,
): { found: boolean; status?: ProposalStatus; ledger?: LedgerItem[]; draft?: DraftTrial } {
  const e = entries.get(id);
  if (!e) return { found: false };
  if (e.proposal.status !== "pending") return { found: true, status: e.proposal.status };
  let applied: { ledger?: LedgerItem[]; draft?: DraftTrial } = {};
  if (decision === "approve") applied = applyProposal(e.proposal, by); // apply first, then release the agent
  settle(id, decision);
  return { found: true, status: e.proposal.status, ...applied };
}

export function pendingIds(): string[] {
  return [...entries.values()].filter((e) => e.proposal.status === "pending").map((e) => e.proposal.id);
}
