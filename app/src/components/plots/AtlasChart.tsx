// The trade-off chart, atlas style: viscosity (lower is better) against tensile (higher is better), with the goal
// corner in resin cream and Cooper's dead-end call hatched. This experiment's trials are solid; the rest of the
// project is faded behind them. Click selects a trial; double-click flags it for review. `mini` is the card thumbnail.
import { useId } from "react";
import type { LedgerItem } from "../../shared/types.ts";
import { colorOf, personById } from "../../data/notebook.ts";
import { METRICS, type Row } from "../../lib/metrics.ts";

const VISC = METRICS.find((m) => m.key === "viscosity_pa_s")!;
const TENS = METRICS.find((m) => m.key === "uts_mpa")!;
const X0 = 1.0, X1 = 2.8, Y0 = 26, Y1 = 56;

export interface AtlasChartProps {
  rows: Row[];
  inFocus: (r: Row) => boolean;
  ledger: LedgerItem[];
  width?: number;
  height?: number;
  mini?: boolean;
  selected?: string | null;
  hover?: string | null;
  flagged?: Set<string>;
  unusual?: (r: Row) => boolean; // only drawn for the selected trial: never pushed
  onSelect?: (id: string) => void;
  onFlag?: (id: string) => void;
  onHover?: (id: string | null) => void;
}

export function AtlasChart({ rows, inFocus, ledger, width = 860, height = 440, mini, selected, hover, flagged, unusual, onSelect, onFlag, onHover }: AtlasChartProps) {
  const uid = useId().replace(/:/g, "");
  const m = mini ? { l: 6, r: 6, t: 6, b: 6 } : { l: 58, r: 20, t: 34, b: 58 };
  const W = width, H = height;
  const sx = (v: number) => m.l + ((v - X0) / (X1 - X0)) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - ((v - Y0) / (Y1 - Y0)) * (H - m.t - m.b);
  const dead = ledger.find((l) => l.kind === "dead_end" && l.evidence.length > 0);
  const anyFocus = rows.some(inFocus);
  let deadBox: { x0: number; x1: number; y0: number; y1: number } | null = null;
  if (dead && (!mini || rows.some((r) => inFocus(r) && dead.evidence.includes(r.id)))) {
    const ev = rows.filter((r) => dead.evidence.includes(r.id));
    if (ev.length) {
      const vx = ev.map((r) => r.values.viscosity_pa_s), vy = ev.map((r) => r.values.uts_mpa);
      deadBox = { x0: sx(Math.min(...vx) - 0.07), x1: sx(Math.max(...vx) + 0.07), y0: sy(Math.max(...vy) + 1.6), y1: sy(Math.min(...vy) - 1.6) };
    }
  }
  const deadLabel = dead ? `${dead.status === "active" ? "Dead end" : "Disputed"}, ${personById(dead.owner).name.split(" ")[0]} ${dead.recorded_at.slice(0, 4)}` : "";
  // Focused rows draw last so they sit on top.
  const ordered = [...rows].sort((a, b) => Number(inFocus(a)) - Number(inFocus(b)));
  const sel = selected ? rows.find((r) => r.id === selected) : undefined;
  return (
    <svg className={`atlas-chart ${mini ? "mini" : ""}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={mini ? "Trials in this experiment" : "Viscosity against tensile strength"}>
      <defs>
        <pattern id={`hatch-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" className="ch-hatch" /></pattern>
      </defs>
      <rect className="ch-goal" x={sx(X0)} y={sy(Y1)} width={sx(VISC.threshold) - sx(X0)} height={sy(TENS.threshold) - sy(Y1)} />
      {!mini && (
        <>
          {[1.0, 1.5, 2.0, 2.5].map((v) => (
            <g key={`x${v}`}><path className="ch-grid" d={`M${sx(v)} ${sy(Y0)}V${sy(Y1)}`} /><text className="ch-tick" x={sx(v)} y={sy(Y0) + 18} textAnchor="middle">{v.toFixed(1)}</text></g>
          ))}
          {[30, 40, 50].map((v) => (
            <g key={`y${v}`}><path className="ch-grid" d={`M${sx(X0)} ${sy(v)}H${sx(X1)}`} /><text className="ch-tick" x={sx(X0) - 10} y={sy(v) + 4} textAnchor="end">{v}</text></g>
          ))}
          <path className="ch-axis" d={`M${sx(X0)} ${sy(Y1)}V${sy(Y0)}H${sx(X1)}`} />
          <text className="ch-goal-label" x={sx(X0) + 10} y={sy(Y1) + 20}>Goal</text>
          <text className="ch-title" x={sx(X0)} y={sy(Y0) + 44}>← Viscosity, Pa·s · lower is better</text>
          <text className="ch-title" x={sx(X0) - 44} y={m.t - 16}>↑ Tensile, MPa · higher is better</text>
        </>
      )}
      <path className="ch-thresh" d={`M${sx(VISC.threshold)} ${sy(Y0)}V${sy(Y1)}M${sx(X0)} ${sy(TENS.threshold)}H${sx(X1)}`} />
      {deadBox && (
        <>
          <rect className="ch-dead" x={deadBox.x0} y={deadBox.y0} width={deadBox.x1 - deadBox.x0} height={deadBox.y1 - deadBox.y0} fill={`url(#hatch-${uid})`} />
          {!mini && <text className="ch-dead-label" x={deadBox.x1 + 10} y={deadBox.y1 - 6}>{deadLabel}</text>}
        </>
      )}
      {ordered.map((r) => {
        const x = sx(r.values.viscosity_pa_s), y = sy(r.values.uts_mpa);
        const on = !anyFocus || inFocus(r);
        const c = colorOf(r.owner);
        const rad = mini ? (on ? 3.6 : 2.6) : on ? 6 : 4.5;
        const hl = r.id === hover;
        const cls = `ch-pt ${on ? "" : "faded"} ${r.trial?.excluded ? "excluded" : ""} ${r.arm ? "est" : ""}`;
        const interactive = !mini && onSelect && r.trial;
        return (
          <g key={r.id} className={`ch-mark ${interactive ? "hit" : ""}`}
            onClick={interactive ? () => onSelect!(r.id) : undefined}
            onDoubleClick={interactive && onFlag ? (e) => { e.preventDefault(); onFlag(r.id); } : undefined}
            onMouseEnter={onHover ? () => onHover(r.id) : undefined} onMouseLeave={onHover ? () => onHover(null) : undefined}>
            {interactive && <circle cx={x} cy={y} r={14} fill="transparent" />}
            {r.trial?.excluded || r.arm
              ? <circle className={cls} cx={x} cy={y} r={rad - 0.8} stroke={c} fill="#fff" />
              : <circle className={cls} cx={x} cy={y} r={rad} fill={c} />}
            {!mini && (on || hl) && <text className="ch-id" x={x + 10} y={y + 4}>{r.id}</text>}
            {!mini && hl && r.id !== selected && <circle className="ch-hover" cx={x} cy={y} r={11} />}
            {!mini && flagged?.has(r.id) && (
              <path className="ch-flag" d={`M${x + 8} ${y - 6}v-14m0 1h8l-2 3 2 3h-8`} />
            )}
          </g>
        );
      })}
      {!mini && sel && (() => {
        const x = sx(sel.values.viscosity_pa_s), y = sy(sel.values.uts_mpa);
        const dx = x - 46, dy = y - 40;
        return (
          <g pointerEvents="none">
            <circle className="ch-sel" cx={x} cy={y} r={13} />
            {unusual?.(sel) && (
              <>
                <path className="ch-leader" d={`M${x - 9} ${y - 9}L${dx + 6} ${dy + 8}`} />
                <path className="cb-delta-path" d={`M${dx} ${dy - 8}L${dx + 9} ${dy + 7}H${dx - 9}Z`} />
              </>
            )}
          </g>
        );
      })()}
    </svg>
  );
}
