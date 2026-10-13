// 3-point bend (Anatomy kit): the nose presses the bar on two supports; it bows along flex_curve, then cracks at
// peak load: through for brittle trials, part-way for ductile ones. Pure function of (trial, deflection).
import { useMemo } from "react";
import type { Trial } from "../shared/types.ts";
import { fitProjection, type Point3 } from "./anatomy/iso-kit.ts";
import { Solid, box, hash01, poly, type P } from "./anatomy/draw.tsx";

export interface BendFigureProps {
  trial: Trial;
  deflection: number; // mm, 0 .. the deflection at peak load (past it, the bar is cracked)
  width?: number;
  height?: number;
}

/** Deflection at peak load, from the trial's bend curve. */
export function peakDeflection(trial: Trial): number {
  let best = trial.flex_curve[0];
  for (const p of trial.flex_curve) if (p[1] > best[1]) best = p;
  return best[0];
}

const L = 16, W = 2.4, H = 1, S0 = 2, S1 = 14, VIS = 1.5; // VIS: world units of sag at peak (exaggerated)
const N = 32;

/** One piece of the bar from x0 to x1 with top surface z(x); its visible faces: top, front (+y), right end (+x). */
function Bar({ x0, x1, z, p }: { x0: number; x1: number; z: (x: number) => number; p: P }) {
  const xs = Array.from({ length: N + 1 }, (_, i) => x0 + ((x1 - x0) * i) / N);
  const top: Point3[] = [...xs.map((x) => [x, 0, z(x)] as Point3), ...[...xs].reverse().map((x) => [x, W, z(x)] as Point3)];
  const front: Point3[] = [...xs.map((x) => [x, W, z(x)] as Point3), ...[...xs].reverse().map((x) => [x, W, z(x) - H] as Point3)];
  const endPts: Point3[] = [[x1, 0, z(x1)], [x1, W, z(x1)], [x1, W, z(x1) - H], [x1, 0, z(x1) - H]];
  return (
    <g className="iso-solid printed">
      <path className="iso-shade" data-shade="2" d={poly(front, p)} />
      <path className="iso-shade" data-shade="1" d={poly(endPts, p)} />
      <path className="iso-top" d={poly(top, p)} />
      <path className="iso-line" data-tone="hi" d={poly(front, p)} />
      <path className="iso-line" data-tone="hi" d={poly(top, p)} />
      <path className="iso-line" data-tone="hi" d={poly(endPts, p)} />
    </g>
  );
}

export function BendFigure({ trial, deflection, width = 300, height = 110 }: BendFigureProps) {
  const peak = peakDeflection(trial);
  const cracked = deflection >= peak;
  const through = cracked && trial.outputs.fracture === "brittle";
  const d = Math.min(deflection, peak);
  const sag = (d / peak) * VIS;
  const base = 2.2; // bar bottom rests on the supports
  const shape = (x: number) => (x <= S0 || x >= S1 ? 0 : Math.sin((Math.PI * (x - S0)) / (S1 - S0)));
  // Past the end supports the bar tips up a little, as a bent beam does.
  const lift = (x: number) => (x < S0 ? ((S0 - x) / S0) * sag * 0.35 : x > S1 ? ((x - S1) / (L - S1)) * sag * 0.35 : 0);
  const z = (x: number) => base + H - sag * shape(x) + lift(x);
  const mid = L / 2 + (hash01(trial.id, "crack") - 0.5) * 0.4;
  const open = through ? 0.25 : 0;

  const p = useMemo(() => {
    const pts: Point3[] = [];
    for (const x of [0, L]) for (const y of [-0.5, W + 0.5]) for (const zz of [0, base + H + 3.2]) pts.push([x, y, zz]);
    return fitProjection(pts, width, height, { pad: 6, azimuth: 72, elevation: 30 });
  }, [width, height]);

  const nz = z(mid);
  // Ductile crack climbs ~60% of the height from the tension (bottom) side; brittle goes through.
  const crackTop = through ? 1 : 0.6;
  const crack: Point3[] = Array.from({ length: 6 }, (_, i) => {
    const f = i / 5;
    return [mid + (hash01(trial.id, "c", i) - 0.5) * 0.16, W, nz - H + f * H * crackTop] as Point3;
  });

  return (
    <svg className="iso" width={width} height={height} role="img" aria-label={`Bend bar ${trial.id}`}>
      <Solid paths={box(S0 - 0.4, -0.3, 0.8, W + 0.6, 0, base, p, 0.35)} />
      <Solid paths={box(S1 - 0.4, -0.3, 0.8, W + 0.6, 0, base, p, 0.35)} />
      {through ? (
        <>
          <Bar x0={0} x1={mid - open} z={z} p={p} />
          <Bar x0={mid + open} x1={L} z={z} p={p} />
        </>
      ) : (
        <Bar x0={0} x1={L} z={z} p={p} />
      )}
      {cracked && !through && <path className="iso-line crack" data-tone="hi" d={poly(crack, p).replace(/Z$/, "")} />}
      <Solid paths={box(L / 2 - 0.35, -0.3, 0.7, W + 0.6, z(L / 2), 3.0, p, 0.3)} tone="hi" />
    </svg>
  );
}
