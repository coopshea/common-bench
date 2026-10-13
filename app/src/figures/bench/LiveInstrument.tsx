// An instrument that follows the bench clock, and on hover loops its own logged run (any size, anywhere).
import { useEffect, useRef, useState } from "react";
import type { StepId, Trial } from "../../shared/types.ts";
import { InstrumentFigure } from "./InstrumentFigure.tsx";
import { stationAt, type Run, type StationState } from "./timeline.ts";

export interface LiveInstrumentProps {
  trial: Trial;
  runs: Run[];
  step: StepId;
  state: StationState; // from the bench clock
  t: number;
  width: number;
  height: number;
  optional?: boolean;
  label?: string;
}

const LOOP = 2.6; // s per hover loop

export function LiveInstrument({ trial, runs, step, state, t, width, height, optional, label }: LiveInstrumentProps) {
  const run = runs.find((r) => r.step === step && (step !== "test" || r.mode === "tensile"));
  const [hover, setHover] = useState<number | null>(null); // seconds since hover began
  const raf = useRef(0);

  useEffect(() => {
    if (hover === null || !run) return;
    const t0 = performance.now() - hover * 1000;
    const tick = (now: number) => {
      setHover((now - t0) / 1000);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [hover === null, run]);

  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let shown = state;
  let phase = t;
  if (hover !== null && run) {
    const f = (hover % LOOP) / LOOP;
    // run 0 → 85%, hold the finished state for the last 15%
    const k = Math.min(0.9999, f / 0.85);
    shown = stationAt(trial, runs, step, run.start + k * (run.end - run.start));
    if (f >= 0.85) shown = { ...stationAt(trial, runs, step, run.end), status: "running", progress: 1, mode: run.mode };
    phase = hover;
  }
  return (
    <span
      className="live-inst"
      onPointerEnter={() => !reduced && run && setHover(0)}
      onPointerLeave={() => setHover(null)}
    >
      <InstrumentFigure step={step} state={shown} t={phase} width={width} height={height} optional={optional} label={label} />
    </span>
  );
}
