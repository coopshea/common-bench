// A protocol's live state, kept apart on purpose:
// - sop: the protocol as edited in the editor (null until edited), and its versions: who changed what, in order.
//   The only place the SOP changes.
// - run: this trial's settings, what was recorded at the bench (each value timestamped), steps marked done, timers,
//   the photo, and the SOP version it is locked to once it starts. Shared by the protocol page, Print SOP and the trial.
// Saved on this device (localStorage) so a reload, a sleeping tablet or a back-swipe never loses a trial.
// Server storage and sharing across devices: issue #9.
import { useSyncExternalStore } from "react";
import type { BenchProtocol, PersonId } from "../shared/types.ts";
import { diffProtocols } from "./sopEdit.ts";
import { evaluateAll, type Scope } from "../shared/calc.ts";

export interface Entry { value: number; by: "voice" | "typed" | "timer"; ok: boolean; at: string } // at: ISO time recorded
export interface SopVersion { n: number; by: PersonId | "claude"; approvedBy?: PersonId; at: string; changes: string[]; proto: BenchProtocol }
export interface SopEdits { proto: BenchProtocol | null; versions: SopVersion[] }
export interface RunState {
  name: string;
  params: Scope;
  entries: Record<string, Entry>;
  done: Record<string, string>; // step id → ISO time marked done (steps with nothing to enter)
  timers: Record<string, { start: string; stop?: string }>; // step id → ISO times
  photo: { at: string } | null;
  pinned: { n: number; proto: BenchProtocol } | null; // the SOP version this trial follows, set when it starts
  last: string | null;
}
interface State { sop: SopEdits; run: RunState }

const BATCH = "batch_g"; // the param a weighed overshoot rescales
const KEY = "common-bench:bench:v2";

const states = new Map<string, State>(load());
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const emit = () => { version++; save(); listeners.forEach((l) => l()); };

function load(): [string, State][] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify([...states])); } catch { /* private window or full: keep working in memory */ }
}

export const effective = (p: BenchProtocol, sop: SopEdits) => sop.proto ?? p;
export const lastVersion = (sop: SopEdits) => sop.versions[sop.versions.length - 1];
export const defaultsOf = (p: BenchProtocol, sop: SopEdits): Scope => Object.fromEntries(effective(p, sop).params.map((x) => [x.id, x.value]));
const freshRun = (p: BenchProtocol, sop: SopEdits): RunState =>
  ({ name: p.next_run ?? "", params: defaultsOf(p, sop), entries: {}, done: {}, timers: {}, photo: null, pinned: null, last: null });
const isStarted = (r: RunState) => Object.keys(r.entries).length > 0 || Object.keys(r.done).length > 0 || Object.keys(r.timers).length > 0;
const get = (p: BenchProtocol): State => {
  if (!states.has(p.id)) { const sop: SopEdits = { proto: null, versions: [{ n: 1, by: p.runner, at: p.uploaded, changes: ["Uploaded"], proto: p }] }; states.set(p.id, { sop, run: freshRun(p, sop) }); }
  return states.get(p.id)!;
};
const set = (p: BenchProtocol, s: State) => { states.set(p.id, s); emit(); };
export const nowIso = () => new Date().toISOString();

export function useBench(p: BenchProtocol) {
  const s = useSyncExternalStore(subscribe, () => get(p));
  const latest = effective(p, s.sop);
  return {
    proto: latest,
    /** What a trial follows: its locked version once started, otherwise the latest SOP. */
    trialProto: s.run.pinned?.proto ?? latest,
    sop: s.sop,
    run: s.run,
    /** Change the protocol itself. An untouched trial follows the new defaults; a started one stays on its version. */
    editSop: (fn: (x: SopEdits) => SopEdits) => {
      const cur = get(p), sop = { ...cur.sop, ...fn(cur.sop) };
      set(p, { sop, run: isStarted(cur.run) ? cur.run : { ...cur.run, params: defaultsOf(p, sop) } });
    },
    /** Change this trial. The first change locks it to the current SOP version. */
    editRun: (fn: (x: RunState) => RunState) => {
      const cur = get(p);
      const next = { ...fn(cur.run), last: nowIso().slice(0, 10) };
      if (!next.pinned && isStarted(next)) next.pinned = { n: lastVersion(cur.sop).n, proto: effective(p, cur.sop) };
      set(p, { ...cur, run: next });
    },
    /** Move a started trial onto the latest SOP version (its recorded values stay). */
    adoptLatest: () => { const cur = get(p); set(p, { ...cur, run: { ...cur.run, pinned: { n: lastVersion(cur.sop).n, proto: effective(p, cur.sop) } } }); },
    newRun: () => { const cur = get(p); set(p, { ...cur, run: freshRun(p, cur.sop) }); },
    /** Save the working protocol as a new version, if anything changed since the last one. */
    commit: (next: BenchProtocol, by: SopVersion["by"], approvedBy?: PersonId) => {
      const cur = get(p), last = lastVersion(cur.sop);
      const changes = diffProtocols(last.proto, next);
      if (!changes.length) return;
      const v: SopVersion = { n: last.n + 1, by, approvedBy, at: nowIso().slice(0, 10), changes, proto: next };
      const sop = { proto: next, versions: [...cur.sop.versions, v] };
      set(p, { sop, run: isStarted(cur.run) ? cur.run : { ...cur.run, params: defaultsOf(p, sop) } });
    },
  };
}

/** Last activity for sorting the list: this device's trial, the last recorded run, or the upload. */
export function useLastActivity() {
  useSyncExternalStore(subscribe, () => version);
  return (p: BenchProtocol) => [states.get(p.id)?.run.last, p.last_run, p.uploaded].filter(Boolean).sort().at(-1)!;
}

/** Planned values from the trial's settings, then targets after the first weighed mass resets the batch. */
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
  // A step is done when its values are in and its photo taken; a step with neither needs an explicit Done.
  const stepDone = (i: number) => {
    const s = p.steps[i];
    if (!s.fields.length && !s.photo) return !!run.done[s.id];
    return s.fields.every((f) => run.entries[f.id]) && (!s.photo || run.photo !== null);
  };
  const current = p.steps.findIndex((_, i) => !stepDone(i));
  return {
    planned: planned.values, target, scope: scaled.values, errors: planned.errors, k,
    stepDone, current, done: current === -1, started: isStarted(run),
  };
}

/** How far a recorded value is from its target, as a fraction; null when there's no target to compare. */
export const offBy = (value: number, target: number | undefined) =>
  target === undefined || !Number.isFinite(target) || target === 0 ? null : (value - target) / target;
export const TOLERANCE = 0.05;

export const fmt = (x: number | undefined, unit: string) =>
  x === undefined || !Number.isFinite(x) ? "—" : unit === "g" ? x.toFixed(2) : String(Math.round(x * 100) / 100);
export const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
