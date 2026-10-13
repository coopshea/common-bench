// React renderers for the Anatomy kit's solids and lines (after kit/react/draw.tsx), plus small world helpers
// every figure shares. Pure: paths in, JSX out.
import type { ReactNode } from "react";
import {
  circleRing, extrude, iso, pathOf, slabOf,
  type Plane, type Point3, type Projection, type SolidPaths, type Tone,
} from "./iso-kit.ts";

export type P = Projection;

interface SolidProps {
  paths: SolidPaths;
  tone?: Tone;
  crease?: Tone | "none";
  lit?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Solid({ paths, tone = "hi", crease = "faint", lit = false, className, children }: SolidProps) {
  return (
    <g className={className ? `iso-solid ${className}` : "iso-solid"} data-lit={lit ? "" : undefined}>
      <path className="iso-fill" d={paths.fill} />
      {paths.shades.map((d, i) => (d ? <path key={i} className="iso-shade" data-shade={i} d={d} /> : null))}
      <path className="iso-top" d={paths.top} />
      {crease !== "none" && paths.crease ? <path className="iso-line" data-tone={crease} d={paths.crease} /> : null}
      {children}
      <path className="iso-line iso-edge" data-tone={tone} d={paths.outline} />
    </g>
  );
}

export function Line({ d, tone = "lo", className }: { d: string; tone?: Tone; className?: string }) {
  return d ? <path className={className ? `iso-line ${className}` : "iso-line"} data-tone={tone} d={d} /> : null;
}

// ---------- world helpers (x right-down, y left-down, z up; the viewer sits at +x +y) ----------

export const box = (x: number, y: number, w: number, d: number, z: number, h: number, p: P, r = 0.35) =>
  slabOf({ x, y, w, d, r }, z, h, p, 4);

export const cyl = (cx: number, cy: number, r: number, z: number, h: number, p: P, steps = 28) =>
  extrude(circleRing(cx, cy, r, steps), z, h, p, { convex: true });

/** A closed polygon of 3-D points, projected. */
export const poly = (pts: Point3[], p: P) => pathOf(pts.map((q) => iso(q, p)), true);

/** Rectangle on the front-left face plane y = y0. */
export const faceY = (y0: number, x0: number, x1: number, z0: number, z1: number, p: P) =>
  poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], p);

/** Rectangle on the front-right face plane x = x0. */
export const faceX = (x0: number, y0: number, y1: number, z0: number, z1: number, p: P) =>
  poly([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], p);

/** Circle on a horizontal plane. */
export const disc = (cx: number, cy: number, r: number, z: number, p: P, steps = 28) =>
  pathOf(circleRing(cx, cy, r, steps).map(([x, y]) => iso([x, y, z], p)), true);

/** Circle on the plane y = y0 (a dial on the front-left face). */
export const dialY = (y0: number, cx: number, cz: number, r: number, p: P, steps = 24) =>
  pathOf(Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return iso([cx + r * Math.cos(a), y0, cz + r * Math.sin(a)], p);
  }), true);

export const seg = (a: Point3, b: Point3, p: P) => pathOf([iso(a, p), iso(b, p)]);

export const ring = (pts: Plane[]) => pts;

/** Deterministic 0..1 hash (no global RNG): same inputs, same picture, in any order, in parallel. */
export function hash01(...parts: (string | number)[]) {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
