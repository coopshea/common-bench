// One isometric model per bench instrument, drawn with the Anatomy kit. Each is a pure function of its station
// state (from the log) and an animation phase t (seconds). Same function at 64 px in the row or 300 px zoomed.
// World: a 12 x 12 footprint, 14.5 tall; the viewer sits at +x +y, so the y-max and x-max faces are the fronts.
import type { ReactNode } from "react";
import type { StepId } from "../../shared/types.ts";
import { fitProjection, iso, type Point3 } from "../anatomy/iso-kit.ts";
import { Line, Solid, box, clamp01, cyl, dialY, disc, easeOut, faceY, hash01, poly, seg, type P } from "../anatomy/draw.tsx";
import type { StationState } from "./timeline.ts";

export interface InstrumentProps {
  s: StationState;
  t: number; // animation phase, seconds
  p: P;
}

/** Fit one instrument's bounds [x0, y0, x1, y1, ztop] into w x h. Each instrument fills its own cell. */
export const projectionFor = (step: StepId, w: number, h: number) => {
  const [x0, y0, x1, y1, z1] = BOUNDS[step];
  const corners: Point3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [0, z1]) corners.push([x, y, z]);
  return fitProjection(corners, w, h, { pad: Math.max(2, w * 0.04) });
};

const BOUNDS: Record<StepId, [number, number, number, number, number]> = {
  weigh: [1.5, 1.5, 10.5, 10, 6.6],
  mix: [1.5, 1.5, 10.5, 10.5, 8],
  degas: [1.5, 2, 10.5, 10, 8.9],
  viscosity: [1.5, 2, 10.5, 10, 11.8],
  print: [1.5, 1.5, 10.5, 10.5, 14.2],
  postcure: [1.5, 1.5, 10.5, 10.5, 8.6],
  test: [1.5, 3.5, 10.5, 8.5, 14.6],
};

const on = (s: StationState) => s.status === "running";
const frac = (v: number) => v - Math.floor(v);

/** A needle on a front-face dial: v in 0..1 sweeps 210° → −30°. */
function Needle({ y0, cx, cz, r, v, p }: { y0: number; cx: number; cz: number; r: number; v: number; p: P }) {
  const a = ((210 - 240 * clamp01(v)) * Math.PI) / 180;
  return <Line d={seg([cx, y0, cz], [cx + r * 0.8 * Math.cos(a), y0, cz + r * 0.8 * Math.sin(a)], p)} tone="hi" className="needle" />;
}

function Screen({ y0, x0, x1, z0, z1, lit, p }: { y0: number; x0: number; x1: number; z0: number; z1: number; lit: boolean; p: P }) {
  return <path className={`screen ${lit ? "lit" : ""}`} d={faceY(y0, x0, x1, z0, z1, p)} />;
}

function Progress({ y0, x0, x1, z, v, p }: { y0: number; x0: number; x1: number; z: number; v: number; p: P }) {
  return (
    <g className="progress">
      <Line d={seg([x0, y0, z], [x1, y0, z], p)} tone="faint" />
      {v > 0 && <Line d={seg([x0, y0, z], [x0 + (x1 - x0) * clamp01(v), y0, z], p)} tone="hi" className="bar" />}
    </g>
  );
}


/** Half-width of a dogbone at fraction u (0..1) along its length: grips, tapers, narrow gauge. */
const boneHalf = (u: number) => {
  const g = 0.27, w = 0.6;
  if (u < 0.22 || u > 0.78) return w;
  if (u < 0.32) return w - ((u - 0.22) / 0.1) * (w - g);
  if (u > 0.68) return g + ((u - 0.68) / 0.1) * (w - g);
  return g;
};

/** A dogbone standing in the plane y = y0 (facing the viewer's left), the slice u0..u1 of it mapped to z = zAt(u). */
function Bone({ cx, y0, u0, u1, zAt, p }: { cx: number; y0: number; u0: number; u1: number; zAt: (u: number) => number; p: P }) {
  const n = 24;
  const us = Array.from({ length: n + 1 }, (_, i) => u0 + ((u1 - u0) * i) / n);
  const face = (y: number): Point3[] => [
    ...us.map((u) => [cx - boneHalf(u), y, zAt(u)] as Point3),
    ...[...us].reverse().map((u) => [cx + boneHalf(u), y, zAt(u)] as Point3),
  ];
  return (
    <g className="iso-solid printed">
      <path className="iso-shade" data-shade="1" d={poly(face(y0 - 0.28), p)} />
      <path className="iso-fill" d={poly(face(y0), p)} />
      <path className="iso-line" data-tone="mid" d={poly(face(y0), p)} />
    </g>
  );
}

// ---------- Balance: each addition stacks in the beaker as its own colored layer, in the weighed ratio ----------
const PART_CLASS = ["part-base", "part-diluent", "part-pi"];
function Balance({ s, p }: InstrumentProps) {
  const total = 50;
  const H = 3.4;
  const parts = s.parts ?? [];
  let z = 2.3;
  const layers = parts.map((g, i) => {
    if (g <= 0) return null;
    const h = Math.max(0.24, (g / total) * H); // the photoinitiator is ~1%: keep a visible sliver
    const el = <Solid key={i} paths={cyl(6, 5.6, 1.5, z, h, p)} className={`resin ${PART_CLASS[i] ?? ""}`} crease="none" tone="mid" />;
    z += h;
    return el;
  });
  return (
    <g>
      <Solid paths={box(2, 2.5, 8, 7, 0, 1.6, p)} />
      <Screen y0={9.5} x0={3.6} x1={8.4} z0={0.35} z1={1.2} lit={on(s)} p={p} />
      <Solid paths={cyl(6, 5.6, 0.5, 1.6, 0.4, p)} tone="mid" />
      <Solid paths={cyl(6, 5.6, 3.1, 2.0, 0.25, p)} />
      {layers}
      <Solid paths={cyl(6, 5.6, 1.7, 2.25, 3.8, p)} className="glass" crease="none" tone="mid" />
    </g>
  );
}

// ---------- Planetary mixer: arm revolves, cup counter-rotates, progress fills on the front ----------
function Mixer({ s, t, p }: InstrumentProps) {
  const run = on(s);
  const a = run ? t * 9 : 0.6;
  const cx = 6, cy = 6, z = 7.55;
  const ex = cx + 2.1 * Math.cos(a), ey = cy + 2.1 * Math.sin(a);
  const b = -2 * a;
  const jig = run ? Math.sin(t * 70) * 0.35 : 0;
  return (
    <g transform={`translate(${jig} 0)`}>
      <Solid paths={box(1.5, 1.5, 9, 9, 0, 7, p, 0.9)} />
      <Screen y0={10.5} x0={3} x1={8.8} z0={4.4} z1={5.9} lit={run} p={p} />
      <Progress y0={10.5} x0={3} x1={8.8} z={3.3} v={s.status === "skipped" ? 0 : s.progress} p={p} />
      <Solid paths={cyl(cx, cy, 3.7, 7, 0.5, p, 36)} />
      <Line d={disc(cx, cy, 3.0, z, p, 36)} tone="faint" />
      <Line d={seg([cx, cy, z], [ex, ey, z], p)} tone="mid" />
      <Line d={disc(ex, ey, 0.9, z, p, 18)} tone="hi" />
      <Line d={seg([ex, ey, z], [ex + 0.9 * Math.cos(b), ey + 0.9 * Math.sin(b), z], p)} tone="hi" />
    </g>
  );
}

// ---------- Vacuum degasser: needle drops to vacuum, bubbles rise and thin out ----------
function Degasser({ s, t, p }: InstrumentProps) {
  const run = on(s);
  const vac = run ? easeOut(clamp01(s.progress * 5)) * (s.progress > 0.92 ? (1 - s.progress) / 0.08 : 1) : 0;
  const n = run ? Math.round(12 * (1 - s.progress) + 1) : 0;
  const bubbles: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const u = frac(t * 0.9 + hash01("b", i));
    const x = 6 + (hash01("x", i) - 0.5) * 2.2;
    const y = 6 + (hash01("y", i) - 0.5) * 2.2;
    const [sx, sy] = iso([x, y, 3.7 + u * 3.6], p);
    bubbles.push(<circle key={i} className="bubble" cx={sx} cy={sy} r={p.scale * (0.16 + 0.14 * hash01("r", i)) * 1.26} opacity={1 - u} />);
  }
  return (
    <g>
      <Solid paths={box(1.5, 2, 9, 8, 0, 1.8, p)} />
      <path className="dial-face" d={dialY(10, 4, 0.9, 0.62, p)} />
      <Needle y0={10} cx={4} cz={0.9} r={0.62} v={1 - vac} p={p} />
      <Solid paths={cyl(6, 6, 3.7, 1.8, 0.25, p, 36)} />
      <Solid paths={cyl(6, 6, 1.6, 2.05, 1.6, p)} className="resin" crease="none" tone="mid" />
      <g>{bubbles}</g>
      <Solid paths={cyl(6, 6, 3.3, 2.05, 6.2, p, 36)} className="glass" crease="none" tone="mid" />
      <Solid paths={cyl(6, 6, 0.6, 8.25, 0.6, p)} tone="mid" />
    </g>
  );
}

// ---------- Viscometer: spindle turns in the cup; dial needle settles on the logged viscosity ----------
function Viscometer({ s, t, p }: InstrumentProps) {
  const run = on(s);
  const v = s.seen[s.seen.length - 1]?.value;
  const target = v !== undefined ? v : 0;
  const reading = run ? easeOut(s.progress) * (target || 1.8) : s.status === "done" ? target : 0;
  const a = run ? t * 12 : 0.4;
  const fz = 8.2;
  return (
    <g>
      <Solid paths={box(1.5, 2, 9, 8, 0, 1.2, p)} />
      <Solid paths={cyl(3.2, 3.6, 0.45, 1.2, 11, p)} tone="mid" />
      <Solid paths={box(2.4, 3.2, 7, 4.2, 9.2, 2.6, p, 0.5)} />
      <path className="dial-face" d={dialY(7.4, 6.6, 10.5, 0.95, p)} />
      <Needle y0={7.4} cx={6.6} cz={10.5} r={0.95} v={reading / 3} p={p} />
      <Line d={seg([6, 5.6, 9.2], [6, 5.6, 2.6], p)} tone="hi" />
      <Line d={disc(6, 5.6, 0.7, fz, p, 16)} tone="mid" />
      <Line d={seg([6, 5.6, fz], [6 + 0.7 * Math.cos(a), 5.6 + 0.7 * Math.sin(a), fz], p)} tone="hi" />
      <Solid paths={cyl(6, 5.6, 1.55, 1.25, 2.2, p)} className="resin" crease="none" tone="mid" />
      <Solid paths={cyl(6, 5.6, 1.75, 1.2, 2.7, p)} className="glass" crease="none" tone="mid" />
    </g>
  );
}

// ---------- DLP printer: plate climbs, parts grow out of the vat, the projector flickers per layer ----------
function Printer({ s, t, p }: InstrumentProps) {
  const run = on(s);
  const lift = s.status === "skipped" || s.status === "idle" ? 0 : s.progress;
  const zp = 6.75 + lift * 5.2;
  const part = zp - 6.6;
  const flick = run && frac(t * 7) < 0.55;
  return (
    <g>
      <Solid paths={box(1.5, 1.5, 9, 9, 0, 5.5, p, 0.6)} />
      <Screen y0={10.5} x0={6.4} x1={9.4} z0={3.0} z1={4.5} lit={run} p={p} />
      <Progress y0={10.5} x0={2.6} x1={5.6} z={3.75} v={lift} p={p} />
      <Solid paths={box(1.8, 4.6, 1.2, 2.8, 5.5, 8.7, p, 0.2)} tone="mid" />
      <Solid paths={box(3.6, 2.6, 6.2, 6.8, 5.5, 1.1, p, 0.3)} />
      <Solid paths={box(3.95, 2.95, 5.5, 6.1, 5.5, 0.95, p, 0.2)} className="resin" crease="none" tone="mid" />
      {flick && <path className="uv" d={poly([[4.6, 3.6, 6.47], [8.8, 3.6, 6.47], [8.8, 8.6, 6.47], [4.6, 8.6, 6.47]], p)} />}
      {part > 0.1 && [4.6, 6.1, 7.6].map((y) => (
        <Bone key={y} cx={6.6} y0={y} u0={0} u1={Math.min(1, part / 5.2)} zAt={(u) => zp - u * 5.2} p={p} />
      ))}
      <Solid paths={box(2.9, 5.2, 1.8, 1.6, zp + 0.1, 0.6, p, 0.15)} tone="mid" />
      <Solid paths={box(4.4, 3.6, 4.4, 5.0, zp, 0.45, p, 0.2)} />
    </g>
  );
}

// ---------- UV oven: window glows, turntable turns, fan spins on top ----------
function Oven({ s, t, p }: InstrumentProps) {
  const run = on(s);
  const a = run ? t * 10 : 0.3;
  const glow = run ? 0.55 + 0.25 * Math.sin(t * 6) : 0;
  const sh = run ? Math.sin(t * 2.4) * 0.9 : 0;
  return (
    <g>
      <Solid paths={box(1.5, 1.5, 9, 9, 0, 8.6, p, 0.6)} />
      <path className="window" d={faceY(10.5, 3, 8.6, 1.6, 6.8, p)} />
      {glow > 0 && <path className="uv" style={{ opacity: glow }} d={faceY(10.5, 3, 8.6, 1.6, 6.8, p)} />}
      {[0, 1, 2].map((i) => (
        <path key={i} className="printed-sil" d={faceY(10.5, 4.2 + i * 1.3 + sh, 4.7 + i * 1.3 + sh, 2.2, 4.4, p)} />
      ))}
      <Line d={seg([3, 10.5, 2.1], [8.6, 10.5, 2.1], p)} tone="mid" />
      <Progress y0={10.5} x0={3} x1={8.6} z={7.6} v={s.status === "skipped" || s.status === "idle" ? 0 : s.progress} p={p} />
      <Line d={disc(6, 6, 2.2, 8.6, p, 30)} tone="mid" />
      {[0, 1, 2].map((i) => {
        const b = a + (i * Math.PI * 2) / 3;
        return <Line key={i} d={seg([6, 6, 8.6], [6 + 2 * Math.cos(b), 6 + 2 * Math.sin(b), 8.6], p)} tone="hi" />;
      })}
    </g>
  );
}

// ---------- Test frame (Instron-style): the crosshead pulls one dogbone until it snaps. Only the tensile run moves it. ----------
function Frame({ s, p }: InstrumentProps) {
  const pulling = on(s) && s.mode === "tensile";
  const pulled = !pulling && s.seen.some((e) => /^tensile/i.test(e.event));
  const v = pulling ? s.progress : pulled ? 1 : 0;
  const zc = 8.4 + 1.1 * v;
  const lo = 2.2, hi = zc - 0.3; // bone ends, inside the grips
  const broke = v > 0.93;
  const gap = broke ? 0.6 : 0;
  const zAt = (u: number) => lo + u * (hi - lo);
  return (
    <g>
      <Solid paths={box(1.5, 3.5, 9, 5, 0, 1.6, p)} />
      <Solid paths={cyl(3, 6, 0.45, 1.6, 12, p)} tone="mid" />
      <Solid paths={box(5.3, 5.3, 1.4, 1.4, 1.6, 1.3, p, 0.1)} tone="mid" />
      {broke ? (
        <>
          <Bone cx={6} y0={6.6} u0={0} u1={0.5} zAt={zAt} p={p} />
          <Bone cx={6} y0={6.6} u0={0.5} u1={1} zAt={(u) => zAt(u) + gap} p={p} />
        </>
      ) : (
        <Bone cx={6} y0={6.6} u0={0} u1={1} zAt={zAt} p={p} />
      )}
      <Solid paths={box(5.3, 5.3, 1.4, 1.4, zc - 1.3 + gap, 1.3, p, 0.1)} tone="mid" />
      <Solid paths={cyl(9, 6, 0.45, 1.6, 12, p)} tone="mid" />
      <Solid paths={box(2.2, 5.1, 7.6, 1.8, zc + gap, 1.0, p, 0.2)} />
      <Solid paths={cyl(6, 6, 0.55, zc + gap + 1.0, 0.7, p)} tone="mid" />
      <Solid paths={box(1.8, 5, 8.4, 2, 13.6, 1, p, 0.2)} />
    </g>
  );
}

export const INSTRUMENTS: Record<StepId, (props: InstrumentProps) => ReactNode> = {
  weigh: Balance,
  mix: Mixer,
  degas: Degasser,
  viscosity: Viscometer,
  print: Printer,
  postcure: Oven,
  test: Frame,
};
