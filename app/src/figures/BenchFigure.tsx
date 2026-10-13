// The bench: one Anatomy model per instrument, in process order. Click one to zoom into it as a visual SOP card;
// hover one to watch it run.
// - Top row (no trial): live. Trials in progress (approved draft arms) show on the instrument they're using,
//   in real time, with a completion ring; click the ring to go to that trial.
// - Drawer (with a trial): that trial's logged run, shown finished; ▶ replays it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { DraftTrial, Station, StepId, Trial } from "../shared/types.ts";
import { trials } from "../data/notebook.ts";
import { LiveInstrument } from "./bench/LiveInstrument.tsx";
import { demoOf, playbackOf, runsOf, stationAt, type StationState } from "./bench/timeline.ts";
import { liveRuns, liveStation, startOf } from "./bench/inProgress.ts";
import { usePlayback } from "./bench/usePlayback.ts";
import { StationZoom } from "./bench/StationZoom.tsx";
import { Ring } from "./bench/Ring.tsx";
import "./figures.css";

export interface BenchFigureProps {
  stations: Station[];
  activeStation: StepId | null;
  trial?: Trial;
  onSelectStation?: (id: StepId) => void;
  /** Top row only: trials in progress (approved drafts) and how to open one. */
  live?: DraftTrial[];
  onOpenTrial?: (id: string) => void;
}

// "Test frame · imaging · plate reader" → "Test frame"
export const deviceName = (d: string) => d.split(" · ")[0];

const latest = () => trials.reduce((a, b) => (b.date > a.date ? b : a));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [active, every]);
  return now;
}

export function BenchFigure({ stations, activeStation, trial, onSelectStation, live = [], onOpenTrial }: BenchFigureProps) {
  const inDrawer = !!trial;
  const ref = trial ?? latest(); // the logged run hover replays
  const runs = useMemo(() => runsOf(ref), [ref]);
  const pb = useMemo(() => playbackOf(runs), [runs]);
  const { q, t, playing, play, pause } = usePlayback(pb.duration, ref.id, false);
  const clock = pb.clockAt(q);

  const now = useNow(!inDrawer && live.length > 0);
  const plan = useMemo(() => live.flatMap((d) => liveRuns(d, startOf(d.id, Date.now()))), [live]);

  const [picked, setPicked] = useState<StepId | null>(null);
  const selected = activeStation ?? picked;
  const root = useRef<HTMLDivElement | null>(null);

  // Close the zoom on Escape or a click anywhere outside the bench.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setPicked(null); } };
    const onDown = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setPicked(null); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onDown, true); };
  }, [selected]);

  const select = (id: StepId) => {
    setPicked((cur) => (cur === id ? null : id));
    onSelectStation?.(id);
  };

  const rows = stations.map((s) => {
    if (inDrawer) return { state: stationAt(ref, runs, s.id, clock), arms: [] as string[] };
    return liveStation(plan, s.id, now);
  });
  const sel = stations.find((s) => s.id === selected);
  const w = inDrawer ? 78 : 66;
  const h = inDrawer ? 66 : 58;

  return (
    <div ref={root} className={`bench3d ${inDrawer ? "in-drawer" : "top"}`}>
      {inDrawer && (
        <div className="bench-clock">
          <button type="button" className="bench-play" onClick={playing ? pause : play} aria-label={playing ? "Pause" : "Replay"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <span className="mono">{fmtClock(Math.max(clock, pb.start))}</span>
        </div>
      )}
      <ol className="bench-row" aria-label="Process">
        {stations.map((s, i) => {
          const { state, arms } = rows[i];
          const name = deviceName(s.device);
          const running = state.status === "running";
          return (
            <li key={s.id} className={`inst-cell ${s.id === selected ? "active" : ""}`} data-status={state.status}>
              <button type="button" onClick={() => select(s.id)} aria-label={name}>
                <LiveInstrument step={s.id} state={state} demo={demoOf(ref, runs, s.id)} t={t} width={w} height={h} optional={!s.in_sop} label={name} />
                <span className="inst-text">
                  {s.in_sop && <b>{name}</b>}
                  {inDrawer && <span className="ro mono">{state.readout ?? ""}</span>}
                </span>
              </button>
              {!inDrawer && running && (
                <RunChip arms={arms} state={state} onOpen={onOpenTrial} />
              )}
            </li>
          );
        })}
      </ol>
      {sel && (
        <StationZoom
          station={sel}
          trial={inDrawer ? ref : undefined}
          state={rows[stations.indexOf(sel)].state}
          demo={demoOf(ref, runs, sel.id)}
          t={t}
          clock={clock}
          floating={!inDrawer}
          onClose={() => setPicked(null)}
          live={!inDrawer ? <LiveLines arms={rows[stations.indexOf(sel)].arms} state={rows[stations.indexOf(sel)].state} onOpen={onOpenTrial} /> : null}
        />
      )}
    </div>
  );
}

/** Green dot + completion ring + arm id: one trial in progress on this instrument. Click → that trial. */
function RunChip({ arms, state, onOpen }: { arms: string[]; state: StationState; onOpen?: (id: string) => void }) {
  return (
    <button type="button" className="run-chip" onClick={() => onOpen?.(arms[0])} title={state.readout ?? undefined}>
      <i className="live-dot" />
      <Ring v={state.progress} size={16} />
      <span className="mono">{arms.join(" · ")}</span>
      <span className="mono muted">{state.readout}</span>
    </button>
  );
}

function LiveLines({ arms, state, onOpen }: { arms: string[]; state: StationState; onOpen?: (id: string) => void }) {
  if (!arms.length) return null;
  return (
    <ul className="zoom-log live">
      {arms.map((a) => (
        <li key={a}>
          <button type="button" className="run-chip" onClick={() => onOpen?.(a)}>
            <i className="live-dot" />
            <Ring v={state.progress} size={18} />
            <span className="mono">{a}</span>
          </button>
          <span className="mono">{state.readout}</span>
        </li>
      ))}
    </ul>
  );
}
