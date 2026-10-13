// The bench: one Anatomy model per instrument, in process order, each animating from the trial's own log
// (MHS-style passive logging). Click an instrument to zoom into it as a visual SOP card.
// Without a trial (the top row) it plays the most recent trial; with one (the drawer) it plays that trial.
import { useEffect, useMemo, useState } from "react";
import type { Station, StepId, Trial } from "../shared/types.ts";
import { inkOf, trials } from "../data/notebook.ts";
import { LiveInstrument } from "./bench/LiveInstrument.tsx";
import { playbackOf, runsOf, stationAt } from "./bench/timeline.ts";
import { usePlayback } from "./bench/usePlayback.ts";
import { StationZoom } from "./bench/StationZoom.tsx";
import "./figures.css";

export interface BenchFigureProps {
  stations: Station[];
  activeStation: StepId | null;
  trial?: Trial;
  onSelectStation?: (id: StepId) => void;
}

// "Test frame · imaging · plate reader" → "Test frame"
export const deviceName = (d: string) => d.split(" · ")[0];

const latest = () => trials.reduce((a, b) => (b.date > a.date ? b : a));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function BenchFigure({ stations, activeStation, trial, onSelectStation }: BenchFigureProps) {
  const tr = trial ?? latest();
  const inDrawer = !!trial;
  const runs = useMemo(() => runsOf(tr), [tr]);
  const pb = useMemo(() => playbackOf(runs), [runs]);
  const { q, t, playing, play, pause } = usePlayback(pb.duration, tr.id);
  const clock = pb.clockAt(q);
  const [picked, setPicked] = useState<StepId | null>(null);
  const selected = activeStation ?? picked;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setPicked(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selected]);

  const select = (id: StepId) => {
    setPicked((cur) => (cur === id ? null : id));
    onSelectStation?.(id);
  };
  const states = stations.map((s) => stationAt(tr, runs, s.id, clock));
  const sel = stations.find((s) => s.id === selected);
  const w = inDrawer ? 78 : 66;
  const h = inDrawer ? 66 : 58;

  return (
    <div className={`bench3d ${inDrawer ? "in-drawer" : "top"}`}>
      <div className="bench-clock">
        <button type="button" className="bench-play" onClick={playing ? pause : play} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : q >= pb.duration ? "↻" : "▶"}
        </button>
        {!inDrawer && <b className="mono" style={{ color: inkOf(tr.owners[0]) }}>{tr.id}</b>}
        <span className="mono">{fmtClock(Math.max(clock, pb.start))}</span>
      </div>
      <ol className="bench-row" aria-label="Process">
        {stations.map((s, i) => {
          const st = states[i];
          const name = deviceName(s.device);
          return (
            <li key={s.id} className={`inst-cell ${s.id === selected ? "active" : ""}`} data-status={st.status}>
              <button type="button" onClick={() => select(s.id)} title={s.in_sop ? name : undefined} aria-label={name}>
                <LiveInstrument trial={tr} runs={runs} step={s.id} state={st} t={t} width={w} height={h} optional={!s.in_sop} label={name} />
                <span className="inst-text">
                  {s.in_sop && <b>{name}</b>}
                  <span className="ro mono">{st.readout ?? ""}</span>
                  <i className="bar" style={{ transform: `scaleX(${st.status === "running" ? st.progress : 0})` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {sel && (
        <StationZoom
          station={sel}
          trial={tr}
          state={states[stations.indexOf(sel)]}
          runs={runs}
          t={t}
          clock={clock}
          floating={!inDrawer}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}
