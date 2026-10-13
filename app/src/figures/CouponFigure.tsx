// Porosity CT (Anatomy kit): a cut plane sweeps through the coupon and stops on the imaged cross-section.
// The recorded pores (trial.pores) sit exactly on that mid-plane; the rest of the 3-D cloud is seeded from the trial
// id and sized from the trial's own pores so every slice shows the same porosity on average (area fraction =
// volume fraction). Pure: coupon(trial, slice) → SVG. The wrapper only animates `slice`.
import { useEffect, useMemo, useState } from "react";
import type { Trial } from "../shared/types.ts";
import { project } from "../data/notebook.ts";
import { trim } from "../lib/format.ts";
import { fitProjection, iso, pathOf, type Point3 } from "./anatomy/iso-kit.ts";
import { Line, Solid, box, easeOut, faceX, hash01, type P } from "./anatomy/draw.tsx";

export interface CouponFigureProps {
  trial: Trial;
  size?: number;
}

const S = 6; // section side (world units); data pores are normalized to it
const LX = 8; // coupon length along the scan axis
const MID = LX / 2;

interface Sphere { x: number; y: number; z: number; r: number }

const clouds = new WeakMap<Trial, Sphere[]>();
/** Seeded 3-D pore cloud for a trial. Deterministic, cached per trial object, no shared RNG. */
export function poreCloud(trial: Trial): Sphere[] {
  const hit = clouds.get(trial);
  if (hit) return hit;
  const recorded = trial.pores.map((q) => ({ x: MID, y: q.x * S, z: (1 - q.y) * S, r: q.r * S }));
  const out: Sphere[] = [...recorded];
  if (recorded.length) {
    const rMean = recorded.reduce((a, q) => a + q.r, 0) / recorded.length;
    const n = Math.min(2500, Math.round((0.75 * recorded.length * LX) / rMean));
    for (let i = 0; i < n; i++) {
      const src = recorded[Math.floor(hash01(trial.id, "src", i) * recorded.length)];
      const r = src.r * (0.75 + 0.5 * hash01(trial.id, "r", i));
      const x = r + hash01(trial.id, "x", i) * (LX - 2 * r);
      if (Math.abs(x - MID) < r) continue; // keep the imaged section exactly as recorded
      out.push({ x, y: 0.4 + hash01(trial.id, "y", i) * (S - 0.8), z: 0.4 + hash01(trial.id, "z", i) * (S - 0.8), r });
    }
  }
  clouds.set(trial, out);
  return out;
}

function voids(cloud: Sphere[], s: number, p: P) {
  const out: string[] = [];
  for (const q of cloud) {
    const d = q.x - s;
    if (Math.abs(d) >= q.r) continue;
    const rho = Math.sqrt(q.r * q.r - d * d);
    const pts = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return iso([s, q.y + rho * Math.cos(a), q.z + rho * Math.sin(a)], p);
    });
    out.push(pathOf(pts, true));
  }
  return out.join("");
}

/** The pure figure: the coupon cut at x = slice (MID .. LX). */
export function CouponCT({ trial, slice, width, height }: { trial: Trial; slice: number; width: number; height: number }) {
  const p = useMemo(() => {
    const pts: Point3[] = [];
    for (const x of [0, LX]) for (const y of [0, S]) for (const z of [0, S]) pts.push([x, y, z]);
    return fitProjection(pts, width, height, { pad: 6 });
  }, [width, height]);
  const cloud = poreCloud(trial);
  const s = Math.max(0.01, Math.min(LX, slice));
  return (
    <svg className="iso" width={width} height={height} role="img" aria-label={`Cross-section of ${trial.id}`}>
      <Solid paths={box(0, 0, s, S, 0, S, p, 0.12)} className="printed" />
      <path className="cut-face" d={faceX(s, 0, S, 0, S, p)} />
      <path className="void" d={voids(cloud, s, p)} />
      {s < LX - 0.01 && <Line d={box(s, 0, LX - s, S, 0, S, p, 0.12).outline} tone="faint" className="ghost" />}
    </svg>
  );
}

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function CouponFigure({ trial, size = 150 }: CouponFigureProps) {
  const [slice, setSlice] = useState(MID);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (reduced()) { setSlice(MID); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 1600);
      setSlice(LX - (LX - MID) * easeOut(k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trial, run]);
  const ceiling = project.guardrails.find((g) => g.id === "porosity")?.checks[0].threshold;
  const pass = trial.guardrails.porosity;
  return (
    <div className="ct" onClick={() => setRun((r) => r + 1)} title="Replay">
      <CouponCT trial={trial} slice={slice} width={Math.round(size * 1.5)} height={size} />
      <div className="ct-read">
        <b>{trim(trial.outputs.porosity_pct)}%</b>
        {ceiling !== undefined && <span className={pass ? "" : "over"}>{pass ? "≤" : ">"} {ceiling}%</span>}
      </div>
    </div>
  );
}
