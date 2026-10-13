// Hover card: how close a trial is to passing every check at once.
// One axis per check, outward is always better; the dashed ring is the pass line.
// A point outside the ring passes that check; inside, it misses (by how far is the distance to the ring).
import { inkOf, personById } from "../../data/notebook.ts";
import { METRICS, STATUS_LABEL, checkStatus, fmtMetric, guardrailFails, limitText, statusOf, type Row } from "../../lib/metrics.ts";
import { STATUS_COLOR } from "./StatusMark.tsx";

const AXIS: Record<string, string> = { viscosity_pa_s: "Thin", uts_mpa: "Tensile", flex_strength_mpa: "Bend", porosity_pct: "Few bubbles", viability_pct: "Cells alive" };
const R = 46; // outer radius, px
const R0 = R / 1.6; // the pass ring

/** Ratio to the limit, oriented so > 1 always means "passes with margin". Log-scaled so big margins don't dominate. */
const reach = (op: "<=" | ">=", v: number, t: number) => {
  const ratio = op === ">=" ? v / t : t / v;
  return R0 * Math.max(0.12, Math.min(1.6, 1 + 0.6 * Math.log2(ratio)));
};

export const RADAR_CARD_W = 280;
export const RADAR_CARD_H = 226;

export function RadarCard({ row, left, top }: { row: Row; left: number; top: number }) {
  const st = statusOf(row);
  const nFail = guardrailFails(row).length;
  const cx = RADAR_CARD_W / 2, cy = 96;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / METRICS.length;
  const pts = METRICS.map((m, i) => {
    const v = row.values[m.key];
    const r = reach(m.op, v, m.threshold);
    return { m, v, cs: checkStatus(m, v), x: cx + r * Math.cos(ang(i)), y: cy + r * Math.sin(ang(i)) };
  });
  const color = STATUS_COLOR[st];
  return (
    <div className="radar-card" style={{ left, top, width: RADAR_CARD_W }}>
      <div className="rc-head">
        <span className="mono rc-id" style={{ color: inkOf(row.owner) }}>{row.id}</span>
        <span className="rc-who">{personById(row.owner).name.split(" ")[0]}{row.arm ? " · estimate" : row.trial?.excluded ? " · excluded" : ""}</span>
        <span className={`st ${st}`}>{st === "goal" ? "✓" : st === "close" ? "○" : "✕"} {st === "fail" ? `${STATUS_LABEL.fail} ${nFail}` : STATUS_LABEL[st]}</span>
      </div>
      <svg width={RADAR_CARD_W} height={RADAR_CARD_H - 34} role="img" aria-label={`${row.id} against every check`}>
        {METRICS.map((_, i) => (
          <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(ang(i))} y2={cy + R * Math.sin(ang(i))} stroke="var(--grid)" strokeWidth={1} />
        ))}
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--grid)" />
        <circle cx={cx} cy={cy} r={R0} fill="var(--goal)" fillOpacity={0.0} stroke="#2f6b3a" strokeDasharray="3 2" strokeWidth={1.2} />
        <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
        {pts.map((p) => (
          <circle key={p.m.key} cx={p.x} cy={p.y} r={3.6} fill={STATUS_COLOR[p.cs]} stroke="#fff" strokeWidth={1} />
        ))}
        {pts.map((p, i) => {
          const a = ang(i);
          const lx = cx + (R + 12) * Math.cos(a);
          const ly = cy + (R + 12) * Math.sin(a);
          const anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
          const dy = Math.sin(a) < -0.5 ? -14 : Math.sin(a) > 0.5 ? 4 : -4;
          return (
            <g key={p.m.key}>
              <text x={lx} y={ly + dy} textAnchor={anchor} className="rc-axis">{AXIS[p.m.key]}</text>
              <text x={lx} y={ly + dy + 12} textAnchor={anchor} className={`rc-val ${p.cs}`}>
                {fmtMetric(p.m, p.v)} <tspan className="rc-lim">{limitText(p.m)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      <div className="rc-foot">dashed ring = pass · outside passes</div>
    </div>
  );
}

/** Beside the dot, flipped and clamped so the card stays inside its chart. */
export function cardPos(cx: number, cy: number, W: number, H: number) {
  const left = cx + 18 + RADAR_CARD_W > W ? Math.max(0, cx - 18 - RADAR_CARD_W) : cx + 18;
  const top = Math.max(0, Math.min(H - RADAR_CARD_H, cy - RADAR_CARD_H / 2));
  return { left, top };
}
