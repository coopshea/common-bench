// A protocol's live state, kept apart on purpose:
// - sop: the protocol as edited in the editor (null until edited), and its versions: who changed what, in order.
//   The only place the SOP changes.
// - run: this trial's settings, what was recorded at the bench (each value timestamped), steps marked done, timers,
//   the photo, and the SOP version it is locked to once it starts. Shared by the protocol page, Print SOP and the trial.
// - history: trials that were finished or set aside when a new one started, newest last. Nothing recorded is thrown away.
// Saved on this device (localStorage) so a reload, a sleeping tablet or a back-swipe never loses a trial.
// Server storage and sharing across devices: issue #9.
import { useMemo, useSyncExternalStore } from "react";
import type { BenchProtocol, PersonId } from "../shared/types.ts";
import { diffProtocols } from "./sopEdit.ts";
import { isCustom } from "./sopLibrary.ts";
import { evaluateAll, type Scope } from "../shared/calc.ts";

export interface Entry { value: number; by: "voice" | "typed" | "timer"; ok: boolean; at: string } // at: ISO time recorded
export interface Note { text: string; at: string; by: "voice" | "typed" }
export interface SopVersion { n: number; by: PersonId | "claude"; approvedBy?: PersonId; at: string; changes: string[]; proto: BenchProtocol }
export interface SopEdits { proto: BenchProtocol | null; versions: SopVersion[] }
export interface RunState {
  name: string;
  params: Scope;
  entries: Record<string, Entry>;
  done: Record<string, string>; // step id → ISO time marked done (steps with nothing to enter)
  timers: Record<string, { start: string; stop?: string }>; // step id → ISO times
  photo: { at: string; src?: string } | null; // src: the picture itself (a small JPEG data URL), when a camera took one
  operator?: string; // who ran it, as typed on this device when the trial started
  notes?: Record<string, Note[]>; // step id → what the operator said or typed about it, in order
  skipped?: Record<string, string>; // step id → ISO time its timer was skipped on purpose
  finished?: string; // ISO time the last step was completed
  pinned: { n: number; proto: BenchProtocol } | null; // the SOP version this trial follows, set when it starts
  last: string | null;
}
/** A trial that is no longer the current one. */
export interface PastRun extends RunState { ended: string } // ended: ISO time it was set aside
interface State { sop: SopEdits; run: RunState; history?: PastRun[] }

const BATCH = "batch_g"; // the param a weighed overshoot rescales
const KEY = "common-bench:bench:v3"; // v3: the person id changed; older saved trials point at a person that no longer exists

const states = new Map<string, State>(load());
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const emit = () => { version++; save(); listeners.forEach((l) => l()); };

function load(): [string, State][] {
  // Anything that isn't the saved list of [id, state] pairs (an old format, a hand-edited value) starts clean rather than crashing the app.
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => Array.isArray(x) && typeof x[0] === "string" && x[1]?.run && x[1]?.sop?.versions?.length) : []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify([...states])); } catch { /* private window or full: keep working in memory */ }
}

export const effective = (p: BenchProtocol, sop: SopEdits) => sop.proto ?? p;
export const lastVersion = (sop: SopEdits) => sop.versions[sop.versions.length - 1];
export const defaultsOf = (p: BenchProtocol, sop: SopEdits): Scope => Object.fromEntries(effective(p, sop).params.map((x) => [x.id, x.value]));
const freshRun = (p: BenchProtocol, sop: SopEdits): RunState =>
  ({ name: p.next_run ?? "", params: defaultsOf(p, sop), entries: {}, done: {}, timers: {}, photo: null, pinned: null, last: null });
const isStarted = (r: RunState) => Object.keys(r.entries).length > 0 || Object.keys(r.done).length > 0 || Object.keys(r.timers).length > 0 || Object.keys(r.notes ?? {}).length > 0;

// Who is at the bench: asked once per device before a trial starts, then stamped on every trial.
const WHO = "common-bench:operator";
export const getOperator = (): string => { try { return localStorage.getItem(WHO) ?? ""; } catch { return ""; } };
export const setOperator = (name: string) => { try { localStorage.setItem(WHO, name.trim()); } catch { /* keep going */ } };
const get = (p: BenchProtocol): State => {
  if (!states.has(p.id)) { const sop: SopEdits = { proto: null, versions: [{ n: 1, by: p.runner, at: p.uploaded, changes: [isCustom(p.id) ? "Created" : "Uploaded"], proto: p }] }; states.set(p.id, { sop, run: freshRun(p, sop) }); }
  return states.get(p.id)!;
};
const set = (p: BenchProtocol, s: State) => { states.set(p.id, s); emit(); };
export const nowIso = () => new Date().toISOString();
/** Today as YYYY-MM-DD in the lab's own time zone (an evening trial belongs to that evening). */
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Forget everything saved for a protocol (its versions and trials): used when an SOP is deleted. */
export const forgetBench = (id: string) => { if (states.delete(id)) emit(); };

export function useBench(p: BenchProtocol) {
  const s = useSyncExternalStore(subscribe, () => get(p));
  // The title lives on the SOP itself, not in a version: a rename shows everywhere at once.
  const latest = useMemo(() => ({ ...effective(p, s.sop), title: p.title }), [p, s.sop]);
  const trialProto = useMemo(() => (s.run.pinned ? { ...s.run.pinned.proto, title: p.title } : latest), [p.title, s.run.pinned, latest]);
  return {
    proto: latest,
    /** What a trial follows: its locked version once started, otherwise the latest SOP. */
    trialProto,
    sop: s.sop,
    run: s.run,
    /** Earlier trials of this SOP, oldest first. */
    history: s.history ?? [],
    /** Change the protocol itself. An untouched trial follows the new defaults; a started one stays on its version. */
    editSop: (fn: (x: SopEdits) => SopEdits) => {
      const cur = get(p), sop = { ...cur.sop, ...fn(cur.sop) };
      set(p, { sop, run: isStarted(cur.run) ? cur.run : { ...cur.run, params: defaultsOf(p, sop) } });
    },
    /** Change this trial. The first change locks it to the current SOP version. */
    editRun: (fn: (x: RunState) => RunState) => {
      const cur = get(p);
      const next = { ...fn(cur.run), last: today() };
      if (!next.pinned && isStarted(next)) next.pinned = { n: lastVersion(cur.sop).n, proto: effective(p, cur.sop) };
      if (!next.operator && isStarted(next) && getOperator()) next.operator = getOperator();
      set(p, { ...cur, run: next });
    },
    /** Move a started trial onto the latest SOP version (its recorded values stay). */
    adoptLatest: () => { const cur = get(p); set(p, { ...cur, run: { ...cur.run, pinned: { n: lastVersion(cur.sop).n, proto: effective(p, cur.sop) } } }); },
    /** Start a fresh trial. A started one moves to the history; its values are kept. */
    newRun: () => {
      const cur = get(p);
      const history = isStarted(cur.run) ? [...(cur.history ?? []), { ...cur.run, ended: nowIso() }] : cur.history;
      set(p, { ...cur, history, run: { ...freshRun(p, cur.sop), name: nextName(cur.run.name) } });
    },
    /** Save the working protocol as a new version, if anything changed since the last one. */
    commit: (next: BenchProtocol, by: SopVersion["by"], approvedBy?: PersonId) => {
      const cur = get(p), last = lastVersion(cur.sop);
      const changes = diffProtocols(last.proto, next);
      if (!changes.length) return;
      const v: SopVersion = { n: last.n + 1, by, approvedBy, at: today(), changes, proto: next };
      const sop = { proto: next, versions: [...cur.sop.versions, v] };
      set(p, { sop, run: isStarted(cur.run) ? cur.run : { ...cur.run, params: defaultsOf(p, sop) } });
    },
  };
}

/** "T15a" → "T15b", "3" → "4": the next trial's suggested name. Anything else starts empty. */
const nextName = (name: string) => {
  const m = name.match(/^(.*?)(\d+)$/);
  if (m) return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, "0")}`;
  const l = name.match(/^(.*\d)([a-y])$/);
  return l ? `${l[1]}${String.fromCharCode(l[2].charCodeAt(0) + 1)}` : "";
};

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
  const target: Record<string, number> = { ...scaled.values, ...(anchor ? { [anchor.id]: planned.values[anchor.id] } : {}) };
  for (const f of fields) if (f.result) target[f.id] = NaN; // a measured result has nothing to aim for
  // With acceptance set on the SOP, a value outside it holds its step until it is fixed or accepted (entry.ok).
  const held = (id: string) => { const e = run.entries[id]; return Boolean(e && !e.ok && outsideAccept(p, e.value, target[id])); };
  // A step is done when its values are in and its photo taken; a step with neither needs an explicit Done.
  // A step with a timer also needs the timer to have been run, or skipped on purpose (which is recorded).
  const stepDone = (i: number) => {
    const s = p.steps[i];
    if (s.timer_min && !run.timers[s.id] && !run.skipped?.[s.id]) return false;
    if (!s.fields.length && !s.photo) return !!run.done[s.id];
    return s.fields.every((f) => run.entries[f.id] && !held(f.id)) && (!s.photo || run.photo !== null);
  };
  const current = p.steps.findIndex((_, i) => !stepDone(i));
  return {
    planned: planned.values, target, scope: scaled.values, errors: planned.errors, k,
    stepDone, held, current, done: current === -1, started: isStarted(run),
  };
}

/** Every time stamped during a trial, in order: the first is when it started, the last is the latest thing done. */
export const timesOf = (r: RunState) => [
  ...Object.values(r.entries).map((e) => e.at), ...Object.values(r.done), ...Object.values(r.skipped ?? {}),
  ...Object.values(r.timers).flatMap((t) => (t.stop ? [t.start, t.stop] : [t.start])), ...Object.values(r.notes ?? {}).flat().map((n) => n.at), ...(r.photo ? [r.photo.at] : []),
].sort();

/** A trial in a line: how long it took, what was recorded, what was off target, what was said. */
export function summarize(p: BenchProtocol, run: RunState) {
  const proto = run.pinned?.proto ?? p, c = compute(proto, run);
  const fields = proto.steps.flatMap((s) => s.fields);
  const times = timesOf(run);
  const off = fields.filter((f) => { const e = run.entries[f.id], o = e ? offBy(e.value, c.target[f.id]) : null; return o !== null && Math.abs(o) > TOLERANCE; });
  return {
    done: c.done, started: times[0], ended: times[times.length - 1],
    minutes: times.length > 1 ? Math.max(1, Math.round((new Date(times[times.length - 1]).getTime() - new Date(times[0]).getTime()) / 60_000)) : 0,
    recorded: fields.filter((f) => run.entries[f.id]).length, total: fields.length, off,
    unconfirmed: fields.filter((f) => run.entries[f.id] && !run.entries[f.id].ok),
    notes: Object.values(run.notes ?? {}).flat().length, skipped: Object.keys(run.skipped ?? {}).length,
  };
}

/** Every trial on this device, for the pages that list them across SOPs (newest activity first). */
export function useAllTrials() {
  useSyncExternalStore(subscribe, () => version);
  return [...states].flatMap(([id, s]) => [...(s.history ?? []), ...(isStarted(s.run) ? [s.run] : [])].map((run) => ({ id, run, current: run === s.run })));
}

/** How far a recorded value is from its target, as a fraction; null when there's no target to compare. */
export const offBy = (value: number, target: number | undefined) =>
  target === undefined || !Number.isFinite(target) || target === 0 ? null : (value - target) / target;
export const TOLERANCE = 0.05;
/** Is this value outside what the SOP accepts for its aim? Never for a measured result, or an SOP with no acceptance. */
export const outsideAccept = (p: BenchProtocol, value: number, target: number | undefined) =>
  Boolean(p.accept) && target !== undefined && Number.isFinite(target) && Math.abs(value - target) > Math.max(Math.abs(target) * p.accept!.pct / 100, p.accept!.abs) + 1e-9;

export const fmt = (x: number | undefined, unit: string) =>
  x === undefined || !Number.isFinite(x) ? "—" : unit === "g" ? x.toFixed(2) : String(Math.round(x * 100) / 100);
export const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

// ---------- Export: every recorded value of every trial, one row each, for a spreadsheet ----------

const cell = (v: string | number | undefined) => { const t = v === undefined ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/** Trials as CSV (long format): one row per recorded value, timer or step marked done. */
export function trialsCsv(p: BenchProtocol, runs: RunState[]): string {
  const rows: (string | number | undefined)[][] = [["sop", "trial", "operator", "sop_version", "step", "measure", "unit", "target", "value", "off_pct", "recorded_at", "method", "confirmed"]];
  for (const run of runs) {
    const proto = run.pinned?.proto ?? p;
    const c = compute(proto, run);
    const head = [p.title, run.name, run.operator ?? "", run.pinned ? `v${run.pinned.n}` : ""];
    for (const [i, st] of proto.steps.entries()) {
      const step = `${i + 1}. ${st.title}`;
      for (const f of st.fields) {
        const e = run.entries[f.id];
        if (!e) continue;
        const off = offBy(e.value, c.target[f.id]);
        rows.push([...head, step, f.label, f.unit, Number.isFinite(c.target[f.id]) ? Math.round(c.target[f.id] * 1000) / 1000 : "", e.value, off === null ? "" : Math.round(off * 1000) / 10, e.at, e.by, e.ok ? "yes" : "no"]);
      }
      const t = run.timers[st.id];
      if (t) rows.push([...head, step, "Timer", "min", st.timer_min, t.stop ? Math.round(((new Date(t.stop).getTime() - new Date(t.start).getTime()) / 60_000) * 100) / 100 : "", "", t.start, "timer", t.stop ? "yes" : "no"]);
      if (run.skipped?.[st.id]) rows.push([...head, step, "Timer skipped", "min", st.timer_min, "", "", run.skipped[st.id], "typed", "yes"]);
      for (const n of run.notes?.[st.id] ?? []) rows.push([...head, step, "Note", "", "", n.text, "", n.at, n.by, "yes"]);
      if (run.done[st.id]) rows.push([...head, step, "Done", "", "", "", "", run.done[st.id], "typed", "yes"]);
      if (st.photo && run.photo) rows.push([...head, step, "Photo", "", "", "", "", run.photo.at, "typed", "yes"]);
    }
  }
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
