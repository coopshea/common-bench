// A protocol's live state, kept apart on purpose:
// - sop: the protocol as edited in the editor (null until edited), and its versions: who changed what, in order.
//   The only place the SOP changes. In memory only for now (issue: persist SOP edits with real version control).
// - run: this run's params, what was recorded at the bench, the photo. Shared by View, Print and Run.
// In memory for the session.
import { useSyncExternalStore } from "react";
import type { BenchProtocol, PersonId } from "../shared/types.ts";
import { diffProtocols } from "./sopEdit.ts";
import { evaluateAll, type Scope } from "../shared/calc.ts";

export interface Entry { value: number; by: "voice" | "typed"; ok: boolean }
export interface SopVersion { n: number; by: PersonId | "claude"; approvedBy?: PersonId; at: string; changes: string[]; proto: BenchProtocol }
export interface SopEdits { proto: BenchProtocol | null; versions: SopVersion[] }
export interface RunState { name: string; params: Scope; entries: Record<string, Entry>; photo: { at: string } | null; last: string | null }
interface State { sop: SopEdits; run: RunState }

const BATCH = "batch_g"; // the param a weighed overshoot rescales

const states = new Map<string, State>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const emit = () => { version++; listeners.forEach((l) => l()); };

export const effective = (p: BenchProtocol, sop: SopEdits) => sop.proto ?? p;
export const lastVersion = (sop: SopEdits) => sop.versions[sop.versions.length - 1];
export const defaultsOf = (p: BenchProtocol, sop: SopEdits): Scope => Object.fromEntries(effective(p, sop).params.map((x) => [x.id, x.value]));
const freshRun = (p: BenchProtocol, sop: SopEdits): RunState => ({ name: p.next_run ?? "", params: defaultsOf(p, sop), entries: {}, photo: null, last: null });
const get = (p: BenchProtocol): State => {
  if (!states.has(p.id)) { const sop: SopEdits = { proto: null, versions: [{ n: 1, by: p.runner, at: p.uploaded, changes: ["Uploaded"], proto: p }] }; states.set(p.id, { sop, run: freshRun(p, sop) }); }
  return states.get(p.id)!;
};
const set = (p: BenchProtocol, s: State) => { states.set(p.id, s); emit(); };

export function useBench(p: BenchProtocol) {
  const s = useSyncExternalStore(subscribe, () => get(p));
  return {
    proto: effective(p, s.sop),
    sop: s.sop,
    run: s.run,
    /** Change the protocol itself. An untouched run follows the new defaults. */
    editSop: (fn: (x: SopEdits) => SopEdits) => {
      const cur = get(p), sop = fn(cur.sop);
      const untouched = Object.keys(cur.run.entries).length === 0;
      set(p, { sop: { ...cur.sop, ...sop }, run: untouched ? { ...cur.run, params: defaultsOf(p, { ...cur.sop, ...sop }) } : cur.run });
    },
    editRun: (fn: (x: RunState) => RunState) => {
      const cur = get(p);
      set(p, { ...cur, run: { ...fn(cur.run), last: new Date().toISOString().slice(0, 10) } });
    },
    newRun: () => { const cur = get(p); set(p, { ...cur, run: freshRun(p, cur.sop) }); },
    /** Save the working protocol as a new version, if anything changed since the last one. */
    commit: (next: BenchProtocol, by: SopVersion["by"], approvedBy?: PersonId) => {
      const cur = get(p), last = cur.sop.versions[cur.sop.versions.length - 1];
      const changes = diffProtocols(last.proto, next);
      if (!changes.length) return;
      const v: SopVersion = { n: last.n + 1, by, approvedBy, at: new Date().toISOString().slice(0, 10), changes, proto: next };
      const sop = { proto: next, versions: [...cur.sop.versions, v] };
      const untouched = Object.keys(cur.run.entries).length === 0;
      set(p, { sop, run: untouched ? { ...cur.run, params: defaultsOf(p, sop) } : cur.run });
    },
  };
}

/** Last activity for sorting the list: this session's run, the last recorded run, or the upload. */
export function useLastActivity() {
  useSyncExternalStore(subscribe, () => version);
  return (p: BenchProtocol) => [states.get(p.id)?.run.last, p.last_run, p.uploaded].filter(Boolean).sort().at(-1)!;
}

/** Planned values from the run's params, then targets after the first weighed mass resets the batch. */
export function compute(p: BenchProtocol, run: RunState) {
  const fields = p.steps.flatMap((x) => x.fields);
  const formulas = fields.map((f) => ({ id: f.id, formula: f.formula }));
  const params = { ...Object.fromEntries(p.params.map((x) => [x.id, x.value])), ...run.params };
  const planned = evaluateAll(formulas, params);
  const anchor = fields.find((f) => f.scales && run.entries[f.id]);
  const k = anchor && planned.values[anchor.id] ? run.entries[anchor.id].value / planned.values[anchor.id] : 1;
  const scope = k === 1 ? params : { ...params, [BATCH]: params[BATCH] * k };
  const scaled = k === 1 ? planned : evaluateAll(formulas, scope);
  const target = { ...scaled.values, ...(anchor ? { [anchor.id]: planned.values[anchor.id] } : {}) };
  const stepDone = (i: number) => p.steps[i].fields.every((f) => run.entries[f.id]) && (!p.steps[i].photo || run.photo !== null);
  const current = p.steps.findIndex((_, i) => !stepDone(i));
  return {
    planned: planned.values, target, scope: scaled.values, errors: planned.errors, k,
    stepDone, current, done: current === -1, started: Object.keys(run.entries).length > 0,
  };
}

export const fmt = (x: number | undefined, unit: string) =>
  x === undefined || !Number.isFinite(x) ? "—" : unit === "g" ? x.toFixed(2) : String(Math.round(x * 100) / 100);
