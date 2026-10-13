// Derived views of the notebook. Everything here is computed from notebook.json, never typed in.
import type { Guardrail, GuardrailCheck, LedgerItem, Person, Trial, TrialOutputs } from "../shared/types.ts";
import { notebook, people, project, trials } from "../data/notebook.ts";
import { firstNameOf } from "../data/notebook.ts";
import { fmtMonth, monthsBetween } from "./format.ts";

export const includedTrials = (): Trial[] => trials.filter((t) => !t.excluded);
export const excludedTrials = (): Trial[] => trials.filter((t) => t.excluded);

export interface GuardrailBest {
  guardrail: Guardrail;
  check: GuardrailCheck; // the headline check (first one)
  best: number;
  trialId: string;
  ok: boolean;
}

/** Best-so-far against each guardrail's headline check, over included trials only. */
export function guardrailBests(): GuardrailBest[] {
  const pool = includedTrials();
  return project.guardrails.map((g) => {
    const check = g.checks[0];
    const metric = check.metric as keyof TrialOutputs;
    let bestT = pool[0];
    for (const t of pool) {
      const v = t.outputs[metric] as number;
      const b = bestT.outputs[metric] as number;
      if (check.op === ">=" ? v > b : v < b) bestT = t;
    }
    const best = bestT.outputs[metric] as number;
    const ok = check.op === ">=" ? best >= check.threshold : best <= check.threshold;
    return { guardrail: g, check, best, trialId: bestT.id, ok };
  });
}

/** Best viscosity among included trials that pass every guardrail: the team-visible best. */
export function objectiveBest(): Trial | undefined {
  const pool = includedTrials().filter((t) => t.pass_all);
  return pool.reduce<Trial | undefined>(
    (best, t) => (!best || t.outputs.viscosity_pa_s < best.outputs.viscosity_pa_s ? t : best),
    undefined,
  );
}

/** A trial's rest between end of mixing and start of printing, read from its log. */
export function restGap(t: Trial): { fromId: string; toId: string; hours: number } | null {
  const mixEnd = [...t.log].reverse().find((e) => e.step === "mix");
  const printStart = t.log.find((e) => e.step === "print");
  if (!mixEnd || !printStart) return null;
  return {
    fromId: mixEnd.id,
    toId: printStart.id,
    hours: (Date.parse(printStart.t) - Date.parse(mixEnd.t)) / 3_600_000,
  };
}

/** Marker text for the map: "rested 18 h · excluded". */
export function anomalyLabel(t: Trial): string | null {
  const parts: string[] = [];
  if (t.inputs.rest_h > 2) parts.push(`rested ${Math.round(t.inputs.rest_h)} h`);
  if (t.excluded) parts.push("excluded");
  return parts.length ? parts.join(" · ") : null;
}

export function guardrailCheckText(c: GuardrailCheck): string {
  return `${c.op === ">=" ? "≥" : "≤"} ${c.threshold}${c.unit === "%" ? "%" : " " + c.unit}`;
}

// ---------- Replay timeline ----------

export type ReplayKind = "join" | "leave" | "trial" | "ledger" | "gap";

export interface ReplayEvent {
  kind: ReplayKind;
  id: string;
  date: string; // ISO date; things dated on or before this are visible
  ms: number; // how long the replay dwells on this event
  caption: string;
  who?: Person["id"];
}

const DWELL: Record<ReplayKind, number> = { join: 380, leave: 380, trial: 330, ledger: 750, gap: 900 };

export function replayEvents(seedLedger: LedgerItem[]): ReplayEvent[] {
  const ev: ReplayEvent[] = [];
  for (const p of people) {
    ev.push({ kind: "join", id: `join-${p.id}`, date: p.joined, ms: DWELL.join, caption: `${p.name} joins`, who: p.id });
    if (p.left) ev.push({ kind: "leave", id: `leave-${p.id}`, date: p.left, ms: DWELL.leave, caption: `${p.name} leaves the team`, who: p.id });
  }
  for (const t of trials) {
    const who = t.owners[0];
    const tag = t.excluded ? " · excluded by owner" : t.pass_all ? " · passes" : " · fails strength";
    ev.push({ kind: "trial", id: t.id, date: t.date, ms: DWELL.trial, caption: `${firstNameOf(who)} · ${t.id} · campaign ${t.campaign}${tag}`, who });
  }
  for (const l of seedLedger) {
    const kind = l.kind === "dead_end" ? "records a dead end" : l.kind === "finding" ? "records a finding" : "asks";
    ev.push({ kind: "ledger", id: l.id, date: l.recorded_at, ms: DWELL.ledger, caption: `${firstNameOf(l.owner)} ${kind} (${l.id})`, who: l.owner });
  }
  ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Compress long silences into one visible pause.
  const out: ReplayEvent[] = [];
  for (let i = 0; i < ev.length; i++) {
    const prev = out[out.length - 1];
    if (prev && monthsBetween(prev.date, ev[i].date) >= 6) {
      out.push({
        kind: "gap",
        id: `gap-${i}`,
        date: prev.date,
        ms: DWELL.gap,
        caption: `${monthsBetween(prev.date, ev[i].date)} months with no trials`,
      });
    }
    out.push(ev[i]);
  }
  return out;
}

export const replayTotalMs = (ev: ReplayEvent[]) => ev.reduce((s, e) => s + e.ms, 0);

export function replayDateLabel(e: ReplayEvent | undefined): string {
  return e ? fmtMonth(e.date) : fmtMonth(project.now);
}

/** Count of degassed trials and their max diluent: used for the honest extrapolation note. */
export function degassedSupport(): { n: number; maxDiluent: number; beyond: string[] } {
  const d = trials.filter((t) => t.inputs.degas_min > 0);
  const maxDiluent = Math.max(...d.map((t) => t.inputs.diluent_wt));
  // Trials past that line that still passed: the only support for the far side.
  const beyond = trials.filter((t) => t.inputs.diluent_wt > maxDiluent && t.pass_all).map((t) => t.id);
  return { n: d.length, maxDiluent, beyond };
}

export const seedLedger = notebook.ledger;
