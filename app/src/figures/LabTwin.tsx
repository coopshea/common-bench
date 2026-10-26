// The lab's digital twin: Room 214 in isometric, built from `lab` in the notebook. Benches are Anatomy slabs; each
// instrument with a model is the same drawing the trial panel uses, placed at its floor-plan position. Instruments
// in use run their animation and hum (a small vibration), ringed in the user's color. Numbered balloons carry how
// each one is logged. Fixtures (fume hood, sink) are drawn as outlines so they never hide equipment.
import { useEffect, useMemo, useState } from "react";
import type { Instrument, StepId, Trial } from "../shared/types.ts";
import { colorOf, personById, trials } from "../data/notebook.ts";
import { lab } from "../lib/org.ts";
import { prefersReducedMotion } from "../lib/hooks.ts";
import { INSTRUMENTS } from "./bench/instruments.tsx";
import { demoOf, playbackOf, runsOf, stationAt, type StationState } from "./bench/timeline.ts";
import { Line, Solid, box, cyl, disc, seg } from "./anatomy/draw.tsx";
import { fitProjection, iso, type Point3 } from "./anatomy/iso-kit.ts";

const U = 0.1; // world units per plan unit
const TW = 1000, TH = 640, BENCH = 9;
// Which bench model draws each instrument; the rest are plain blocks until they have one.
const MODEL: Record<string, StepId> = {
  balance: "weigh", mixer: "mix", degasser: "degas", viscometer: "viscosity",
  "printer-1": "print", "printer-2": "print", "uv-oven": "postcure", "test-frame": "test",
};
const TOP: Record<StepId, number> = { weigh: 6.6, mix: 8, degas: 8.9, viscosity: 11.8, print: 14.2, postcure: 8.6, test: 14.6 };
const PERIOD = 6; // s per loop of a running instrument's animation

type Rect = { x: number; y: number; w: number; h: number };
const inside = (i: Rect, s: Rect) => i.x + i.w / 2 >= s.x && i.x + i.w / 2 <= s.x + s.w && i.y + i.h / 2 >= s.y && i.y + i.h / 2 <= s.y + s.h;
const near = (r: Rect) => r.x + r.w + r.y + r.h;

/** Running instruments loop through the latest trial that used them (the current user's newest run). */
function useLoop(on: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!on || prefersReducedMotion()) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => { setT((now - t0) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  return t;
}

export const instrumentNumber = (id: string) => lab.instruments.findIndex((i) => i.id === id) + 1;

/** A consumable to fetch from (get) or return to (put) a fixture: drawn as a bottle on it, with its name. */
export interface TwinItem { name: string; at: string; mode: "get" | "put" }

export function LabTwin({ selected, onSelect, booked, active, items = [] }: {
  selected: string | null; onSelect: (id: string) => void; booked?: Set<string>;
  active?: string; // the bench view's current instrument: only it runs, the rest dim
  items?: TwinItem[];
}) {
  const ref: Trial = useMemo(() => [...trials].reverse().find((t) => t.owners.includes("shreya")) ?? trials[trials.length - 1], []);
  const R = useMemo(() => runsOf(ref), [ref]);
  const PB = useMemo(() => playbackOf(R), [R]);
  const running = active !== undefined ? !!MODEL[active] : lab.instruments.some((i) => i.in_use && MODEL[i.id]);
  const t = useLoop(running);

  const pR = useMemo(() => {
    const room: Point3[] = [];
    for (const x of [0, lab.width * U]) for (const y of [0, lab.depth * U]) for (const z of [0, 17]) room.push([x, y, z]);
    return fitProjection(room, TW, TH, { pad: 56 });
  }, []);

  const stateOf = (step: StepId, live: boolean): StationState => {
    if (live) {
      const demo = demoOf(ref, R, step);
      if (demo) return demo((t % PERIOD) / PERIOD);
    }
    return stationAt(ref, R, step, PB.start - 60_000);
  };

  const balloons: { id: string; ax: number; ay: number; front: boolean; source: string }[] = [];
  const kids: React.ReactNode[] = [];

  // Floor and a faint 1 m grid.
  kids.push(<Solid key="floor" paths={box(0, 0, lab.width * U, lab.depth * U, -0.6, 0.6, pR, 0)} tone="mid" crease="none" className="floor" />);
  for (let x = 10; x < lab.width * U; x += 10) kids.push(<Line key={`gx${x}`} d={seg([x, 0, 0], [x, lab.depth * U, 0], pR)} tone="faint" />);
  for (let y = 10; y < lab.depth * U; y += 10) kids.push(<Line key={`gy${y}`} d={seg([0, y, 0], [lab.width * U, y, 0], pR)} tone="faint" />);

  // Fixtures first, as outlines on the floor plus a dashed silhouette: they're the room, not equipment.
  for (const f of lab.fixtures) {
    const h = (f.z ?? 90) * U;
    kids.push(
      <g key={f.name} className={`tw-fixture ${items.some((it) => it.at === f.name) ? "hot" : ""}`}>
        <Solid paths={box(f.x * U, f.y * U, f.w * U, f.h * U, 0, h, pR, 0.2)} tone="faint" crease="none" className="ghost" />
        {f.name === "Sink" && <Line d={disc((f.x + f.w / 2) * U, (f.y + f.h / 2) * U, 2, h + 0.01, pR)} tone="faint" />}
      </g>,
    );
  }

  for (const b of [...lab.benches].sort((a, c) => near(a) - near(c))) {
    kids.push(<Solid key={b.name} paths={box(b.x * U, b.y * U, b.w * U, b.h * U, 0, BENCH, pR, 0.2)} tone="mid" className="surface" />);
    const mine = lab.instruments.filter((i) => inside(i, b)).sort((a, c) => near(a) - near(c));
    for (const inst of mine) kids.push(instrument(inst, BENCH));
  }

  function instrument(inst: Instrument, sh: number) {
    const cx = (inst.x + inst.w / 2) * U, cy = (inst.y + inst.h / 2) * U;
    const step = MODEL[inst.id];
    const live = !!step && (active !== undefined ? inst.id === active : !!inst.in_use);
    const on = selected === inst.id;
    let top: number;
    let body: React.ReactNode;
    if (step) {
      const k = (Math.min(inst.w, inst.h) * U) / 9;
      const p = { ...pR, origin: iso([cx - 6 * k, cy - 6 * k, sh], pR), scale: pR.scale * k };
      const Draw = INSTRUMENTS[step];
      body = <g className="tw-body"><Draw s={stateOf(step, live)} t={live ? t : 0.6} p={p} /></g>;
      top = sh + TOP[step] * k;
    } else {
      const hh = Math.max(1.2, inst.z * U);
      body = (
        <g className="tw-body generic">
          <Solid paths={box(inst.x * U, inst.y * U, inst.w * U, inst.h * U, sh, hh, pR, 0.3)} />
          {inst.id === "hot-plate" && <Line d={disc(cx, cy, Math.min(inst.w, inst.h) * U * 0.32, sh + hh + 0.01, pR)} tone="mid" />}
          {inst.id === "imaging" && <Solid paths={cyl(cx, cy, 1.1, sh + hh, 2.2, pR)} tone="hi" />}
        </g>
      );
      top = sh + hh + (inst.id === "imaging" ? 2.2 : 0);
    }
    const [ax, ay] = iso([cx, cy, top], pR);
    balloons.push({ id: inst.id, ax, ay, front: inst.y > lab.depth / 2, source: inst.source });
    const ringR = (Math.max(inst.w, inst.h) * U) / 2 + 1;
    return (
      <g key={inst.id} className={`tw-inst ${live ? "running" : ""} ${on ? "on" : ""} ${active !== undefined && inst.id !== active ? "dim" : ""}`} role="button" tabIndex={0} aria-label={inst.name}
        onClick={() => onSelect(inst.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(inst.id); } }}>
        {on && <path className="tw-sel" d={disc(cx, cy, ringR + 1.2, sh + 0.02, pR, 48)} />}
        {inst.in_use && active === undefined && <path className="tw-ring" d={disc(cx, cy, ringR, sh + 0.02, pR, 48)} style={{ stroke: colorOf(inst.in_use.by) }} />}
        {body}
      </g>
    );
  }

  // Names on the floor in front of each bench and fixture.
  const floorLabel = (r: Rect & { name: string }, cls: string) => {
    const [x, y] = iso([r.x * U, (r.y + r.h) * U + 2.2, 0], pR);
    return <text key={`l-${r.name}`} className={cls} x={x} y={y} dy={10} transform={`rotate(26.57 ${x} ${y})`}>{r.name}</text>;
  };

  // Consumables: bottles standing on their fixture, named, solid to fetch and dashed to put back.
  const itemMarks = lab.fixtures.flatMap((f) => {
    const here = items.filter((it) => it.at === f.name);
    const long = f.h > f.w;
    return here.map((it, j) => {
      const u = (j + 1) / (here.length + 1);
      const cx = (f.x + (long ? f.w / 2 : f.w * u)) * U, cy = (f.y + (long ? f.h * u : f.h / 2)) * U;
      const top = (f.z ?? 90) * U;
      const [lx, ly] = iso([cx, cy, top + 3.2], pR);
      return (
        <g key={`${f.name}-${it.name}`} className={`tw-item ${it.mode}`}>
          <Solid paths={cyl(cx, cy, 1.3, top, 3, pR)} tone="hi" />
          <path className="tw-item-ring" d={disc(cx, cy, 3.2, top + 0.02, pR, 32)} />
          <path className="tw-leader" d={`M${lx} ${ly}L${lx + 8} ${ly - 8 - j * 26}`} />
          <text x={lx + 10} y={ly - 6 - j * 26}>{it.mode === "put" ? "↩ " : ""}{it.name}</text>
        </g>
      );
    });
  });

  // Bench view: the current instrument is named above it instead of the numbered balloons.
  function activeLabel() {
    const b = balloons.find((x) => x.id === active);
    const inst = lab.instruments.find((i) => i.id === active);
    if (!b || !inst) return null;
    return <g className="tw-item active"><text x={b.ax} y={b.ay - 18} textAnchor="middle">{inst.name}</text></g>;
  }

  const backBand = Math.min(...balloons.filter((b) => !b.front).map((b) => b.ay)) - 34;
  return (
    <svg className="iso twin" viewBox={`0 0 ${TW} ${TH}`} role="img" aria-label={`${lab.room}, isometric`}>
      {kids}
      {itemMarks}
      {balloons.map((b) => {
        const u = lab.instruments.find((i) => i.id === b.id)?.in_use;
        if (!u) return null;
        return (
          <g key={`u-${b.id}`} className="tw-user">
            <title>{`${personById(u.by).name} · until ${u.until}`}</title>
            <circle cx={b.ax - 22} cy={b.ay - 10} r={13} style={{ fill: colorOf(u.by) }} />
            <text x={b.ax - 22} y={b.ay - 10} dy={4.5}>{personById(u.by).initials}</text>
          </g>
        );
      })}
      {active !== undefined ? activeLabel() : <>
        {lab.benches.map((b) => floorLabel(b, "tw-bench"))}
        {lab.fixtures.map((f) => floorLabel(f, "tw-bench fixture"))}
      </>}
      {active === undefined && balloons.map((b) => {
        const by = b.front ? b.ay - 46 : backBand;
        const n = instrumentNumber(b.id);
        const on = selected === b.id;
        const s = 7, X = b.ax + 15, Y = by - s / 2;
        return (
          <g key={`b-${b.id}`} className={`tw-balloon ${on ? "sel" : ""}`} onClick={() => onSelect(b.id)}>
            <path className="tw-leader" d={`M${b.ax} ${b.ay}V${by + 11}`} />
            <circle cx={b.ax} cy={by} r={11} />
            <text x={b.ax} y={by} dy={4}>{n}</text>
            <rect className={`tw-log ${b.source === "mhs" || b.source === "camera" ? "fill" : ""}`} x={X} y={Y} width={s} height={s} />
            {b.source === "manual" && <path className="tw-log-half" d={`M${X} ${Y}h${s / 2}v${s}h-${s / 2}z`} />}
            {booked?.has(b.id) && <path className="tw-booked" d={`M${b.ax - 15 - 8} ${by - 4}h8v8h-8z M${b.ax - 23} ${by - 1}h8`} />}
          </g>
        );
      })}
    </svg>
  );
}
