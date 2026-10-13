// The goal in sight: thin enough vs. strong enough. The goal is one corner; every trial is a status mark,
// and thin lines trace each person's path toward (or away from) it.
import { colorOf, inkOf, notebook, people } from "../../data/notebook.ts";
import { METRICS, statusOf, type Row } from "../../lib/metrics.ts";
import { useSize } from "../../lib/hooks.ts";
import { useHighlight } from "../../lib/rows.ts";
import { useStore } from "../../state/store.tsx";
import { StatusMark } from "./StatusMark.tsx";
import { RadarCard, cardPos } from "./RadarCard.tsx";
import { useState } from "react";

const VISC = METRICS.find((m) => m.key === "viscosity_pa_s")!;
const UTS = METRICS.find((m) => m.key === "uts_mpa")!;
const M = { l: 50, r: 16, t: 26, b: 40 };

export function TradeoffPlot({ rows }: { rows: Row[] }) {
  const { state, dispatch } = useStore();
  const hl = useHighlight();
  const [local, setLocal] = useState<string | null>(null);
  const [ref, size] = useSize<HTMLDivElement>();
  const W = Math.max(size.width, 300);
  const H = Math.max(size.height, 200);
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;

  const xs = rows.map((r) => r.values.viscosity_pa_s);
  const ys = rows.map((r) => r.values.uts_mpa);
  const X: [number, number] = [Math.min(1.0, ...xs) - 0.05, Math.max(2.7, ...xs) + 0.05];
  const Y: [number, number] = [Math.min(28, ...ys) - 2, Math.max(55, ...ys) + 2];
  const x = (v: number) => M.l + ((v - X[0]) / (X[1] - X[0])) * pw;
  const y = (v: number) => M.t + ph - ((v - Y[0]) / (Y[1] - Y[0])) * ph;
  const gx = x(VISC.threshold), gy = y(UTS.threshold);

  // the dead end: drawn around the trials it was declared on (the seed ledger), relabeled when disputed
  const deadEnd = state.ledger.find((l) => l.kind === "dead_end");
  const declaredOn = notebook.ledger.find((l) => l.id === deadEnd?.id)?.evidence ?? [];
  const dePts = rows.filter((r) => declaredOn.includes(r.id));
  const box = dePts.length
    ? {
        x0: Math.min(...dePts.map((r) => x(r.values.viscosity_pa_s))) - 14,
        x1: Math.max(...dePts.map((r) => x(r.values.viscosity_pa_s))) + 14,
        y0: Math.min(...dePts.map((r) => y(r.values.uts_mpa))) - 14,
        y1: Math.max(...dePts.map((r) => y(r.values.uts_mpa))) + 14,
      }
    : null;
  const disputed = deadEnd?.status === "disputed";

  const best = rows.filter((r) => r.trial && !r.trial.excluded && statusOf(r) !== "fail").sort((a, b) => a.values.viscosity_pa_s - b.values.viscosity_pa_s)[0];
  const ordered = [...rows].sort((a, b) => Number(a.id === hl) - Number(b.id === hl));
  const xTicks = [1.0, 1.5, 2.0, 2.5].filter((v) => v >= X[0] && v <= X[1]);
  const yTicks = [30, 40, 50].filter((v) => v >= Y[0] && v <= Y[1]);

  return (
    <div className="tradeoff" ref={ref}
      // Re-sorting the hovered dot to the top moves its DOM node, which can swallow mouseleave on fast moves.
      // So the container clears hover itself: when the pointer leaves it, or moves over anything that isn't a dot.
      onMouseLeave={() => { setLocal(null); dispatch({ type: "hover", id: null }); }}
      onMouseMove={(e) => { if (!(e.target as Element).classList?.contains("hit")) { setLocal(null); if (state.hover) dispatch({ type: "hover", id: null }); } }}>
      {size.width > 0 && (
        <svg width={W} height={H} role="img" aria-label="Viscosity against tensile strength for every trial, with the goal corner">
          <rect x={M.l} y={M.t} width={pw} height={ph} fill="#fff" stroke="var(--line)" />
          <rect x={M.l} y={M.t} width={gx - M.l} height={gy - M.t} fill="var(--goal)" />
          <text x={M.l + 10} y={M.t + 20} className="goal-label">Goal</text>

          {yTicks.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={M.l + pw} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              <text x={M.l - 7} y={y(v) + 3.5} textAnchor="end" className="tick">{v}</text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text key={v} x={x(v)} y={M.t + ph + 15} textAnchor="middle" className="tick">{v.toFixed(1)}</text>
          ))}
          <line x1={gx} x2={gx} y1={M.t} y2={M.t + ph} className="limit-line" />
          <line x1={M.l} x2={M.l + pw} y1={gy} y2={gy} className="limit-line" />
          <text x={gx + 5} y={M.t + ph - 6} className="limit-label">≤ {VISC.threshold} {VISC.unit}</text>
          <text x={M.l + pw - 6} y={gy - 6} textAnchor="end" className="limit-label">≥ {UTS.threshold} {UTS.unit}</text>

          <text x={M.l + pw / 2} y={H - 6} textAnchor="middle" className="axis-t">Viscosity, Pa·s · <tspan className="better">← thinner is better</tspan></text>
          <text transform={`translate(14 ${M.t + ph / 2}) rotate(-90)`} textAnchor="middle" className="axis-t">Tensile, MPa · <tspan className="better">stronger is better →</tspan></text>

          {box && (
            <g>
              <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} rx={10}
                fill="none" stroke={disputed ? "var(--ink-3)" : colorOf(deadEnd!.owner)} strokeDasharray="4 3" strokeOpacity={0.7} />
              <text x={box.x0} y={box.y1 + 14} className="de-label" style={{ fill: disputed ? "var(--ink-2)" : inkOf(deadEnd!.owner) }} key={deadEnd!.status}>
                {disputed ? "dead end disputed" : "dead end"}
              </text>
            </g>
          )}

          {/* each person's path in date order */}
          {people.map((p) => {
            const mine = rows.filter((r) => r.owner === p.id && r.trial);
            if (mine.length < 2) return null;
            return <polyline key={p.id} points={mine.map((r) => `${x(r.values.viscosity_pa_s)},${y(r.values.uts_mpa)}`).join(" ")}
              fill="none" stroke={colorOf(p.id)} strokeWidth={1.6} strokeOpacity={0.4} strokeLinejoin="round" />;
          })}

          {ordered.map((r) => {
            const cx = x(r.values.viscosity_pa_s);
            const cy = y(r.values.uts_mpa);
            const on = r.id === hl;
            const excluded = !!r.trial?.excluded;
            const est = !!r.arm;
            const showLabel = on || excluded || est || r.id === best?.id;
            const flip = cx > M.l + pw - 110;
            return (
              <g key={r.id} className="dot-g" style={{ opacity: hl !== null && !on ? 0.4 : 1 }}>
                {excluded && <circle cx={cx} cy={cy} r={12} fill="none" stroke="var(--ink-3)" strokeDasharray="3 2" />}
                <StatusMark status={statusOf(r)} cx={cx} cy={cy} est={est} on={on} />
                {showLabel && (
                  <text x={flip ? cx - 12 : cx + 12} y={cy - 10} textAnchor={flip ? "end" : "start"} className="dot-label">
                    {r.id}{excluded ? " · excluded" : est ? " · estimate" : r.id === best?.id && !on ? " · best" : ""}
                  </text>
                )}
                <circle cx={cx} cy={cy} r={12} fill="transparent" className="hit" tabIndex={0} role="button"
                  aria-label={`${r.id}: ${r.values.viscosity_pa_s} Pa·s, ${r.values.uts_mpa} MPa`}
                  onMouseEnter={() => { setLocal(r.id); dispatch({ type: "hover", id: r.id }); }}
                  onMouseLeave={() => { setLocal(null); dispatch({ type: "hover", id: null }); }}
                  onFocus={() => { setLocal(r.id); dispatch({ type: "hover", id: r.id }); }}
                  onBlur={() => { setLocal(null); dispatch({ type: "hover", id: null }); }}
                  onClick={() => r.trial && dispatch({ type: "drawer", trialId: r.trial.id })}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && r.trial) { e.preventDefault(); dispatch({ type: "drawer", trialId: r.trial.id }); } }} />
              </g>
            );
          })}
        </svg>
      )}
      {(() => {
        const card = local ? rows.find((r) => r.id === local) : undefined;
        return card ? <RadarCard row={card} {...cardPos(x(card.values.viscosity_pa_s), y(card.values.uts_mpa), W, H)} /> : null;
      })()}
    </div>
  );
}
