// Tensile dogbone (Anatomy kit): grips pull it apart along the trial's curve. Ductile trials neck, then tear;
// brittle trials snap clean at outputs.elongation_pct. Pure function of (trial, strain).
import { useMemo } from "react";
import type { Trial } from "../shared/types.ts";
import { extrude, fitProjection, type Plane, type Point3 } from "./anatomy/iso-kit.ts";
import { Solid, box, hash01 } from "./anatomy/draw.tsx";

export interface DogboneFigureProps {
  trial: Trial;
  strain: number; // %, 0 .. trial.outputs.elongation_pct (at or past it, the specimen is broken)
  width?: number;
  height?: number;
}

const GRIP = 5, TAPER = 2.2, GAUGE = 7, WG = 4, WN = 2, T = 0.8;
const VIS = 0.05; // exaggeration: 1% strain → 5% visible stretch

/** Half-width along the specimen at position x (from its left end), for a stretched gauge of length g. */
function halfWidth(x: number, g: number, neck: number, xf: number) {
  let w: number;
  if (x <= GRIP) w = WG / 2;
  else if (x <= GRIP + TAPER) w = WG / 2 - ((x - GRIP) / TAPER) * (WG - WN) / 2;
  else if (x <= GRIP + TAPER + g) w = WN / 2;
  else if (x <= GRIP + 2 * TAPER + g) w = WN / 2 + ((x - GRIP - TAPER - g) / TAPER) * (WG - WN) / 2;
  else w = WG / 2;
  if (neck > 0) w -= neck * (WN / 2) * 0.55 * Math.exp(-(((x - xf) / 0.9) ** 2));
  return w;
}

export function DogboneFigure({ trial, strain, width = 300, height = 110 }: DogboneFigureProps) {
  const elong = trial.outputs.elongation_pct;
  const ductile = trial.outputs.fracture === "ductile";
  const broken = strain >= elong;
  const s = Math.min(strain, elong);
  const g = GAUGE * (1 + s * VIS);
  const L = 2 * GRIP + 2 * TAPER + g;
  const xfRel = 0.5 + (hash01(trial.id, "xf") - 0.5) * 0.5; // where it fails, seeded per trial
  const xf = GRIP + TAPER + g * xfRel;
  const neckStart = 0.6 * elong;
  const neck = ductile && s > neckStart ? Math.min(1, (s - neckStart) / (elong - neckStart)) : 0;
  const gap = broken ? (ductile ? 0.9 : 1.6) : 0;

  // Camera fixed per trial (fit at full stretch) so the view never jumps while pulling.
  const p = useMemo(() => {
    const Lmax = 2 * GRIP + 2 * TAPER + GAUGE * (1 + elong * VIS) + 1.6;
    const pts: Point3[] = [];
    for (const x of [0, Lmax]) for (const y of [-WG / 2 - 0.4, WG / 2 + 0.4]) for (const z of [0, T + 1.3]) pts.push([x, y, z]);
    return fitProjection(pts, width, height, { pad: 6, azimuth: 72, elevation: 34 });
  }, [elong, width, height]);

  // Fracture edge across the width (u: 0..1): brittle = nearly flat with small jags; ductile = cup-cone slant.
  const edge = (u: number) =>
    ductile ? 0.7 * Math.abs(u - 0.5) - 0.18 : (hash01(trial.id, "j", Math.round(u * 5)) - 0.5) * 0.22;

  const N = 64;
  const hw = (x: number) => halfWidth(x, g, neck, xf);
  const end = (x: number, cut: boolean, down: boolean): Plane[] => {
    const h = hw(x);
    const pts = (cut ? [0, 1, 2, 3, 4, 5, 6].map((i) => i / 6) : [0, 1]).map((u) => [x + (cut ? edge(u) : 0), -h + 2 * h * u] as Plane);
    return down ? pts : pts.reverse();
  };
  const piece = (from: number, to: number, cutLeft: boolean, cutRight: boolean, dx: number) => {
    const xs = Array.from({ length: N - 1 }, (_, i) => from + ((to - from) * (i + 1)) / N);
    const ring: Plane[] = [
      ...xs.map((x) => [x, -hw(x)] as Plane),
      ...end(to, cutRight, true),
      ...[...xs].reverse().map((x) => [x, hw(x)] as Plane),
      ...end(from, cutLeft, false),
    ].map(([x, y]) => [x + dx, y] as Plane);
    return extrude(ring, 0, T, p, { convex: false });
  };

  const jaw = (x: number) => box(x - 0.2, -WG / 2 - 0.4, GRIP - 0.6, WG + 0.8, T, 1.2, p, 0.2);
  const right = broken ? gap : 0;

  return (
    <svg className="iso" width={width} height={height} role="img" aria-label={`Tensile specimen ${trial.id}`}>
      {broken ? (
        <>
          <Solid paths={piece(0, xf, false, true, 0)} className="printed" crease="none" tone="hi" />
          <Solid paths={piece(xf, L, true, false, right)} className="printed" crease="none" tone="hi" />
        </>
      ) : (
        <Solid paths={piece(0, L, false, false, 0)} className="printed" crease="none" tone="hi" />
      )}
      <Solid paths={jaw(0)} />
      <Solid paths={jaw(L - GRIP + 0.6 + right)} />
    </svg>
  );
}
