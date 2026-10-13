// An instrument showing its current state; on hover it loops one run of itself (any size, anywhere).
// The loop is owned by refs and stops the moment the pointer leaves or the component unmounts.
import { useEffect, useRef, useState } from "react";
import type { StepId } from "../../shared/types.ts";
import { InstrumentFigure } from "./InstrumentFigure.tsx";
import type { StationState } from "./timeline.ts";

export interface LiveInstrumentProps {
  step: StepId;
  state: StationState; // what the instrument is doing now
  /** The state at fraction f (0..1) of a representative run, for the hover loop. Omit to disable hover. */
  demo?: (f: number) => StationState;
  t?: number;
  width: number;
  height: number;
  optional?: boolean;
  label?: string;
}

const LOOP = 2.6; // s per hover loop
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function LiveInstrument({ step, state, demo, t = 0, width, height, optional, label }: LiveInstrumentProps) {
  const [hover, setHover] = useState<number | null>(null); // seconds since hover began
  const raf = useRef(0);
  const on = useRef(false);

  const stop = () => {
    on.current = false;
    cancelAnimationFrame(raf.current);
    setHover(null);
  };
  const start = () => {
    if (!demo || reduced() || on.current) return;
    on.current = true;
    const t0 = performance.now();
    const tick = (now: number) => {
      if (!on.current) return;
      setHover((now - t0) / 1000);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => { on.current = false; cancelAnimationFrame(raf.current); }, []);

  let shown = state;
  let phase = t;
  if (hover !== null && demo) {
    const f = (hover % LOOP) / LOOP;
    shown = demo(Math.min(1, f / 0.85)); // run, then hold the finished state for the last 15%
    phase = hover;
  }
  return (
    <span className="live-inst" onPointerEnter={start} onPointerLeave={stop}>
      <InstrumentFigure step={step} state={shown} t={phase} width={width} height={height} optional={optional} label={label} />
    </span>
  );
}
