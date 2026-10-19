// The room, from data: a floor plan and an isometric 3D view of the same layout.
// Fill shows how an instrument is logged (solid = logs itself, dashed = by hand, dotted = not logged); a ring shows who is using it.
import type { Instrument } from "../shared/types.ts";
import { colorOf } from "../data/notebook.ts";
import { lab } from "../lib/org.ts";

const kind = (i: Instrument) => (i.source === "mhs" || i.source === "camera" ? "auto" : i.source === "manual" ? "hand" : "none");
const SHORT: Record<string, string> = {
  mixer: "Mixer", degasser: "Degasser", "printer-1": "Printer 1", "printer-2": "Printer 2", "uv-oven": "UV oven",
  "test-frame": "Test frame", imaging: "Imaging", "plate-reader": "Plate reader", "hot-plate": "Hot plate",
};
export const shortName = (i: Instrument) => SHORT[i.id] ?? i.name;
const label = shortName;

export function FloorPlan({ selected, onSelect, mini = false }: { selected: string | null; onSelect?: (id: string) => void; mini?: boolean }) {
  return (
    <svg className={`plan ${mini ? "mini" : ""}`} viewBox={`0 0 ${lab.width} ${lab.depth}`} role="img" aria-label={`${lab.room} floor plan`}>
      <rect className="room" x={20} y={20} width={lab.width - 40} height={lab.depth - 40} />
      <line className="door" x1={470} x2={530} y1={lab.depth - 20} y2={lab.depth - 20} />
      {lab.benches.map((b) => <rect key={b.name} className="bench" x={b.x} y={b.y} width={b.w} height={b.h} />)}
      {lab.fixtures.map((f) => (
        <g key={f.name}>
          <rect className="fixture" x={f.x} y={f.y} width={f.w} height={f.h} />
          {!mini && <text className="fx-label" x={f.x + f.w / 2} y={f.y + f.h / 2 + 4} textAnchor="middle">{f.name}</text>}
        </g>
      ))}
      {lab.instruments.map((i) => {
        const on = selected === i.id;
        const faded = mini && !on;
        return (
          <g key={i.id} className={`inst ${kind(i)} ${on ? "on" : ""}`} opacity={faded ? 0.35 : 1}
            role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? i.name : undefined}
            onClick={onSelect ? () => onSelect(i.id) : undefined}
            onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i.id); } } : undefined}>
            {i.in_use && !mini && (
              <rect className="busy" x={i.x - 7} y={i.y - 7} width={i.w + 14} height={i.h + 14} rx={9} style={{ stroke: colorOf(i.in_use.by) }} />
            )}
            <rect className="body" x={i.x} y={i.y} width={i.w} height={i.h} rx={5} />
            {(!mini || on) && <text className="name" x={i.x + i.w / 2} y={i.y + i.h / 2 + (mini ? 9 : 4)} textAnchor="middle" fontSize={mini ? 26 : 12}>{label(i)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// Isometric view of the same data. Faces are classed by logging kind, so both themes color them.
export function FloorPlan3D({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const s = 0.62, ox = 400, oy = 70, c = 0.866, h = 0.5, BZ = 45;
  const P = (x: number, y: number, z: number) => `${(ox + (x - y) * c * s).toFixed(1)},${(oy + ((x + y) * h - z) * s).toFixed(1)}`;
  const box = (x: number, y: number, w: number, d: number, z0: number, z1: number, cls: string) => (
    <>
      <polygon className={`${cls} s1`} points={`${P(x + w, y, z0)} ${P(x + w, y + d, z0)} ${P(x + w, y + d, z1)} ${P(x + w, y, z1)}`} />
      <polygon className={`${cls} s2`} points={`${P(x, y + d, z0)} ${P(x + w, y + d, z0)} ${P(x + w, y + d, z1)} ${P(x, y + d, z1)}`} />
      <polygon className={`${cls} top`} points={`${P(x, y, z1)} ${P(x + w, y, z1)} ${P(x + w, y + d, z1)} ${P(x, y + d, z1)}`} />
    </>
  );
  // Draw each instrument right after its bench, so benches never cover what sits on them.
  const benchOf = (i: Instrument) => lab.benches.find((b) => i.x >= b.x && i.x <= b.x + b.w && i.y >= b.y - 20 && i.y <= b.y + b.h);
  const key = (r: { x: number; y: number; w: number; h: number }) => r.x + r.w + r.y + r.h;
  const items = [
    ...lab.benches.map((b) => ({ k: key(b), el: <g key={b.name}>{box(b.x, b.y, b.w, b.h, 0, BZ, "f-bench")}</g> })),
    ...lab.fixtures.map((f) => ({ k: key(f) - 1, el: <g key={f.name}>{box(f.x, f.y, f.w, f.h, 0, f.z, "f-bench")}</g> })),
    ...lab.instruments.map((i) => {
      const b = benchOf(i);
      const [lx, ly] = P(i.x + i.w / 2, i.y + i.h / 2, BZ + i.z + 14).split(",").map(Number);
      return {
        k: (b ? key(b) : key(i)) + (i.x + i.y) / 10000,
        el: (
          <g key={i.id} className={`inst3 ${selected === i.id ? "on" : ""}`} role="button" tabIndex={0} aria-label={i.name}
            onClick={() => onSelect(i.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i.id); } }}>
            {box(i.x, i.y, i.w, i.h, BZ, BZ + i.z, `f-${kind(i)}`)}
            {i.in_use && <circle cx={lx} cy={ly + 8} r={9} style={{ fill: colorOf(i.in_use.by) }} />}
            <text className="iso-label" x={lx} y={ly - 16} textAnchor="middle">{label(i)}</text>
          </g>
        ),
      };
    }),
  ].sort((a, b) => a.k - b.k);
  return (
    <svg className="plan iso" viewBox="60 20 840 560" role="img" aria-label={`${lab.room} in 3D`}>
      <polygon className="f-floor" points={`${P(20, 20, 0)} ${P(980, 20, 0)} ${P(980, 540, 0)} ${P(20, 540, 0)}`} />
      <polygon className="f-wall a" points={`${P(20, 20, 0)} ${P(980, 20, 0)} ${P(980, 20, 220)} ${P(20, 20, 220)}`} />
      <polygon className="f-wall b" points={`${P(20, 20, 0)} ${P(20, 540, 0)} ${P(20, 540, 220)} ${P(20, 20, 220)}`} />
      {items.map((it) => it.el)}
    </svg>
  );
}
