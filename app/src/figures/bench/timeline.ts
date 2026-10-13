// The bench as a pure function of (trial, clock). Every instrument's state comes from the trial's own log:
// when a run started, when it ended, what it recorded. No global state, so any trial (or many at once) can play.
import type { LogEntry, StepId, Trial } from "../../shared/types.ts";

const MIN = 60_000;
const at = (e: LogEntry) => Date.parse(e.t);

export type Mode = "weigh" | "mix" | "degas" | "viscosity" | "print" | "postcure" | "tensile" | "bend" | "imaging" | "viability";

export interface Run {
  step: StepId;
  mode: Mode;
  start: number; // ms
  end: number; // ms
  entries: LogEntry[];
}

/** Turn a trial's log into instrument runs. Durations are the logged ones; point readings get a short window. */
export function runsOf(trial: Trial): Run[] {
  const of = (s: StepId) => trial.log.filter((e) => e.step === s);
  const runs: Run[] = [];
  const weigh = of("weigh");
  if (weigh.length) runs.push({ step: "weigh", mode: "weigh", start: at(weigh[0]) - 2 * MIN, end: at(weigh[weigh.length - 1]), entries: weigh });
  const mix = of("mix");
  if (mix.length) {
    const s = mix.find((e) => /start/i.test(e.event)) ?? mix[0];
    const f = mix.find((e) => /end/i.test(e.event));
    runs.push({ step: "mix", mode: "mix", start: at(s), end: f ? at(f) : at(s) + (trial.inputs.mix_min || 2) * MIN, entries: mix });
  }
  for (const e of of("degas")) runs.push({ step: "degas", mode: "degas", start: at(e), end: at(e) + (e.value ?? 10) * MIN, entries: [e] });
  for (const e of of("viscosity")) runs.push({ step: "viscosity", mode: "viscosity", start: at(e) - 4 * MIN, end: at(e), entries: [e] });
  const print = of("print");
  if (print.length) {
    const s = print.find((e) => /start/i.test(e.event)) ?? print[0];
    const f = print.find((e) => /finish/i.test(e.event));
    runs.push({ step: "print", mode: "print", start: at(s), end: f ? at(f) : at(s) + 85 * MIN, entries: print });
  }
  for (const e of of("postcure")) runs.push({ step: "postcure", mode: "postcure", start: at(e), end: at(e) + (e.value ?? 45) * MIN, entries: [e] });
  const test = of("test");
  const modeOf = (e: LogEntry): Mode =>
    /^tensile/i.test(e.event) ? "tensile" : /bend/i.test(e.event) ? "bend" : /porosity|section/i.test(e.event) ? "imaging" : "viability";
  for (const e of test) {
    const m = modeOf(e);
    const last = runs[runs.length - 1];
    if (last.step === "test" && last.mode === m) { last.end = at(e); last.entries.push(e); }
    else runs.push({ step: "test", mode: m, start: at(e) - 5 * MIN, end: at(e), entries: [e] });
  }
  return runs.sort((a, b) => a.start - b.start);
}

export type Status = "skipped" | "idle" | "running" | "done";

export interface StationState {
  step: StepId;
  status: Status;
  mode: Mode | null;
  progress: number; // 0..1 within the current (or last) run
  elapsedMin: number;
  totalMin: number;
  /** The logged entries for this step up to the clock: what the instrument has reported so far. */
  seen: LogEntry[];
  readout: string | null;
}

const fmtClock = (min: number) => {
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
};
const dur = (el: number, tot: number) => (tot < 10 ? `${fmtClock(el)} / ${fmtClock(tot)}` : `${Math.floor(el)} / ${Math.round(tot)} min`);
const num = (v: number) => String(Math.round(v * 100) / 100);

const TEST_WORD: Record<string, string> = { tensile: "pull", bend: "bend", imaging: "section", viability: "cells" };

export function stationAt(trial: Trial, runs: Run[], step: StepId, clock: number): StationState {
  const mine = runs.filter((r) => r.step === step);
  const seen = trial.log.filter((e) => e.step === step && Date.parse(e.t) <= clock);
  const base = { step, seen, elapsedMin: 0, totalMin: 0 };
  if (!mine.length) return { ...base, status: "skipped", mode: null, progress: 0, readout: null };
  const cur = mine.find((r) => clock >= r.start && clock < r.end);
  const last = [...mine].reverse().find((r) => clock >= r.end);
  if (cur) {
    const totalMin = (cur.end - cur.start) / MIN;
    const elapsedMin = (clock - cur.start) / MIN;
    const progress = Math.min(1, elapsedMin / totalMin);
    let readout: string;
    if (step === "weigh") readout = `${num(seen.reduce((s, e) => s + (e.value ?? 0), 0))} g`;
    else if (step === "viscosity") readout = "…";
    else if (step === "test") readout = TEST_WORD[cur.mode] ?? "";
    else readout = dur(elapsedMin, totalMin);
    return { ...base, status: "running", mode: cur.mode, progress, elapsedMin, totalMin, readout };
  }
  if (!last) return { ...base, status: "idle", mode: mine[0].mode, progress: 0, readout: null };
  const allDone = clock >= mine[mine.length - 1].end;
  const lastVal = seen[seen.length - 1];
  let readout: string | null = null;
  if (step === "weigh") readout = `${num(seen.reduce((s, e) => s + (e.value ?? 0), 0))} g`;
  else if (step === "viscosity" && lastVal?.value !== undefined) readout = `${lastVal.value} Pa·s`;
  else if (step === "test") readout = allDone ? `${seen.length} results` : `${seen.length} so far`;
  else readout = `${Math.round((last.end - last.start) / MIN)} min`;
  return { ...base, status: allDone ? "done" : "idle", mode: last.mode, progress: 1, readout, totalMin: (last.end - last.start) / MIN, elapsedMin: (last.end - last.start) / MIN };
}

// ---------- playback: compress a trial's real hours into a few seconds, skipping the idle gaps ----------

export interface Playback {
  duration: number; // s
  clockAt: (p: number) => number;
  start: number;
  end: number;
}

const playSec = (min: number) => Math.min(2.4, 0.45 + 0.025 * min);
const GAP = 0.3;

export function playbackOf(runs: Run[]): Playback {
  const knots: [number, number][] = [];
  let p = 0;
  let prevEnd = -Infinity;
  for (const r of runs) {
    const s = Math.max(r.start, prevEnd);
    if (r.end <= s) continue;
    if (knots.length) { p += GAP; }
    knots.push([p, s]);
    p += playSec((r.end - s) / MIN);
    knots.push([p, r.end]);
    prevEnd = r.end;
  }
  const start = knots[0]?.[1] ?? 0;
  const end = knots[knots.length - 1]?.[1] ?? 0;
  const clockAt = (q: number) => {
    if (q <= 0) return start - 1;
    for (let i = 1; i < knots.length; i++) {
      const [p0, c0] = knots[i - 1];
      const [p1, c1] = knots[i];
      if (q <= p1) return p1 === p0 ? c1 : c0 + ((q - p0) / (p1 - p0)) * (c1 - c0);
    }
    return end;
  };
  return { duration: p, clockAt, start, end };
}
