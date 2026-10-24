// One protocol's live state, shared by the document (before and after) and the bench view (during):
// edited params and formulas, what was recorded at the bench, and the photo. In memory for the session.
import { useSyncExternalStore } from "react";
import type { BenchProtocol } from "../shared/types.ts";
import { evaluateAll, type Scope } from "../shared/calc.ts";

export interface Entry { value: number; by: "voice" | "typed"; ok: boolean }
export interface RunState {
  params: Scope;
  formulas: Record<string, string>; // field id → edited formula
  entries: Record<string, Entry>;
  photo: { at: string } | null;
}

const BATCH = "batch_g"; // the param a weighed overshoot rescales

const states = new Map<string, RunState>();
const listeners = new Set<() => void>();
const fresh = (p: BenchProtocol): RunState => ({ params: Object.fromEntries(p.params.map((x) => [x.id, x.value])), formulas: {}, entries: {}, photo: null });

export function useBenchRun(p: BenchProtocol): [RunState, (fn: (s: RunState) => RunState) => void] {
  const s = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => { if (!states.has(p.id)) states.set(p.id, fresh(p)); return states.get(p.id)!; },
  );
  const update = (fn: (s: RunState) => RunState) => { states.set(p.id, fn(states.get(p.id) ?? fresh(p))); listeners.forEach((l) => l()); };
  return [s, update];
}

export const resetRun = (p: BenchProtocol) => { states.set(p.id, fresh(p)); listeners.forEach((l) => l()); };

/** Planned values from the params, then targets after the first weighed mass resets the batch. */
export function compute(p: BenchProtocol, s: RunState) {
  const fields = p.steps.flatMap((x) => x.fields);
  const formulas = fields.map((f) => ({ id: f.id, formula: s.formulas[f.id] ?? f.formula }));
  const planned = evaluateAll(formulas, s.params);
  const anchor = fields.find((f) => f.scales && s.entries[f.id]);
  const k = anchor && planned.values[anchor.id] ? s.entries[anchor.id].value / planned.values[anchor.id] : 1;
  const scaled = k === 1 ? planned : evaluateAll(formulas, { ...s.params, [BATCH]: s.params[BATCH] * k });
  const target = { ...scaled.values, ...(anchor ? { [anchor.id]: planned.values[anchor.id] } : {}) };
  const stepDone = (i: number) => p.steps[i].fields.every((f) => s.entries[f.id]) && (!p.steps[i].photo || s.photo !== null);
  const current = p.steps.findIndex((_, i) => !stepDone(i));
  return { planned: planned.values, target, errors: planned.errors, k, batch: s.params[BATCH] * k, stepDone, current, done: current === -1, started: Object.keys(s.entries).length > 0 };
}

export const fmt = (x: number | undefined, unit: string) =>
  x === undefined || !Number.isFinite(x) ? "—" : unit === "g" ? x.toFixed(2) : String(Math.round(x * 100) / 100);
