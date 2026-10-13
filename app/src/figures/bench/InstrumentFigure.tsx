// One instrument as a standalone figure at any size. The bench row and the zoom view both render this.
import { useMemo } from "react";
import type { StepId } from "../../shared/types.ts";
import { INSTRUMENTS, projectionFor } from "./instruments.tsx";
import type { StationState } from "./timeline.ts";

export interface InstrumentFigureProps {
  step: StepId;
  state: StationState;
  t: number;
  width: number;
  height: number;
  optional?: boolean; // off-SOP: drawn dashed
  label?: string;
}

export function InstrumentFigure({ step, state, t, width, height, optional, label }: InstrumentFigureProps) {
  const p = useMemo(() => projectionFor(step, width, height), [step, width, height]);
  const Draw = INSTRUMENTS[step];
  return (
    <svg
      className={`iso inst ${optional ? "optional" : ""}`}
      data-status={state.status}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? step}
    >
      <Draw s={state} t={t} p={p} />
    </svg>
  );
}
