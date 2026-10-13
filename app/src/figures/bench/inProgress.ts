// Trials in progress on the bench: approved draft arms (T15a/b) run the SOP in real time from the moment they're
// approved. Planned durations come from the SOP and the arm's recipe; nothing here is a measured result.
import type { DraftTrial, StepId } from "../../shared/types.ts";
import type { Mode, StationState } from "./timeline.ts";

const MIN = 60_000;
export const SPEED = 1; // 1 = real time

const PLAN: [StepId, number][] = [["weigh", 8], ["mix", 2], ["degas", 10], ["viscosity", 4], ["print", 85], ["postcure", 45], ["test", 30]];
const BATCH_G = 50;

export interface LiveRun {
  armId: string;
  step: StepId;
  start: number;
  end: number;
  parts: number[]; // g of base monomer, diluent, photoinitiator (weigh only)
}

// When each draft was approved (first seen on the bench). Kept across remounts so the clock doesn't restart.
const started = new Map<string, number>();
export const startOf = (draftId: string, now: number) => {
  if (!started.has(draftId)) started.set(draftId, now);
  return started.get(draftId)!;
};

/** Planned runs for every arm of a draft. Arm i starts once arm i−1 is off the balance. */
export function liveRuns(d: DraftTrial, t0: number): LiveRun[] {
  const out: LiveRun[] = [];
  d.arms.forEach((a, i) => {
    const dil = a.recipe.diluent_wt / 100;
    const pi = a.recipe.photoinit_wt / 100;
    const parts = [BATCH_G * (1 - dil - pi), BATCH_G * dil, BATCH_G * pi];
    let t = t0 + (i * 8 * MIN) / SPEED;
    for (const [step, min] of PLAN) {
      const m = step === "degas" ? a.recipe.degas_min : step === "mix" ? (a.recipe.mix_min ?? min) : min;
      if (!m) continue;
      out.push({ armId: a.id, step, start: t, end: t + (m * MIN) / SPEED, parts });
      t += (m * MIN) / SPEED;
    }
  });
  return out;
}

const fmt = (min: number) => (min < 10 ? `${Math.floor(min)}:${String(Math.floor((min % 1) * 60)).padStart(2, "0")}` : `${Math.floor(min)}`);

export interface LiveStation {
  state: StationState;
  arms: string[]; // arm ids on this instrument now
}

/** What one instrument is doing right now. */
export function liveStation(runs: LiveRun[], step: StepId, now: number): LiveStation {
  const cur = runs.filter((r) => r.step === step && now >= r.start && now < r.end);
  if (!cur.length) {
    return { arms: [], state: { step, status: "idle", mode: null, progress: 0, elapsedMin: 0, totalMin: 0, seen: [], readout: null } };
  }
  const r = cur[0];
  const totalMin = ((r.end - r.start) / MIN) * SPEED;
  const elapsedMin = ((now - r.start) / MIN) * SPEED;
  const progress = Math.min(1, elapsedMin / totalMin);
  let parts: number[] | undefined;
  let readout = `${fmt(elapsedMin)} / ${fmt(totalMin)}${totalMin >= 10 ? " min" : ""}`;
  if (step === "weigh") {
    // three additions, one after another
    parts = r.parts.map((g, i) => g * Math.max(0, Math.min(1, progress * 3 - i)));
    readout = `${(Math.round(parts.reduce((a, b) => a + b, 0) * 10) / 10).toFixed(1)} g`;
  }
  const mode: Mode = step === "test" ? "tensile" : step;
  return { arms: [...new Set(cur.map((c) => c.armId))], state: { step, status: "running", mode, progress, elapsedMin, totalMin, seen: [], readout, parts } };
}
