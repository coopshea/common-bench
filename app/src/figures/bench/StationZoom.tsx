// Zoomed view of one instrument: the same model, large, beside its SOP card and either the trial's log for this
// step (drawer) or the trials running on it now (top row). Hover the model to watch it run.
import type { ReactNode } from "react";
import type { Station, Trial } from "../../shared/types.ts";
import { SourceBadge } from "../../components/bits.tsx";
import { fmtTime, trim } from "../../lib/format.ts";
import { LiveInstrument } from "./LiveInstrument.tsx";
import type { StationState } from "./timeline.ts";

export interface StationZoomProps {
  station: Station;
  trial?: Trial;
  state: StationState;
  demo?: (f: number) => StationState;
  t: number;
  clock: number;
  floating: boolean;
  onClose: () => void;
  live?: ReactNode;
}

export function StationZoom({ station, trial, state, demo, t, clock, floating, onClose, live }: StationZoomProps) {
  const entries = trial ? trial.log.filter((e) => e.step === station.id) : [];
  return (
    <div className={`station-zoom ${floating ? "floating" : ""}`} role="dialog" aria-label={station.label}>
      <LiveInstrument step={station.id} state={state} demo={demo} t={t} width={floating ? 280 : 230} height={floating ? 230 : 190} optional={!station.in_sop} label={station.device} />
      <div className="zoom-body">
        <div className="zoom-head">
          <b>{station.label}</b>
          <span className="muted">{station.device}</span>
          <SourceBadge source={station.source} />
          {!station.in_sop && <span className="tag">not in SOP</span>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn small ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="zoom-card">{station.card}</p>
        {live}
        {trial && (
          <ul className="zoom-log">
            {entries.length === 0 && <li className="none">{trial.id}: not run</li>}
            {entries.map((e) => (
              <li key={e.id} className={Date.parse(e.t) > clock ? "future" : ""}>
                <span className="mono when">{fmtTime(e.t)}</span>
                <span>{e.event}{e.value !== undefined && <b> · {trim(e.value)} {e.unit}</b>}</span>
                <span className="lid">{e.id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
