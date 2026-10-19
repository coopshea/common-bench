// One check in focus, across the recipe map. Tabs pick the check; the x-axis is a recipe variable.
// The limit is drawn once and the passing side is tinted. Each dot shows its state; thin lines are each person's path.
// Hovering a dot opens the radar card: how close that trial is to passing every check.
import { useState } from "react";
import { colorOf, people } from "../../data/notebook.ts";
import { METRICS, checkStatus, limitText, metricByKey, statusOf, type Row, type Status } from "../../lib/metrics.ts";
import { useSize } from "../../lib/hooks.ts";
import { useHighlight } from "../../lib/rows.ts";
import { useStore } from "../../state/store.tsx";
import { StatusMark } from "./StatusMark.tsx";
import { RadarCard, cardPos } from "./RadarCard.tsx";

const M = { l: 50, r: 16, t: 26, b: 40 };
const TAB_LABEL: Record<string, string> = { viscosity_pa_s: "Viscosity", uts_mpa: "Tensile", flex_strength_mpa: "Bend", porosity_pct: "Bubbles", viability_pct: "Cells" };
const XDEF = {
  diluent: { label: "Diluent", hint: "more → thinner", domain: [10, 45] as [number, number], ticks: [10, 20, 30, 40], of: (r: Row) => r.diluent },
  photoinit: { label: "Photoinitiator", hint: "more → stronger cure", domain: [0.5, 2.0] as [number, number], ticks: [0.5, 1, 1.5, 2], of: (r: Row) => r.photoinit },
};

export function FocusChart({ rows }: { rows: Row[] }) {
  const { state, dispatch } = useStore();
  const hl = useHighlight();
  const [local, setLocal] = useState<string | null>(null);
  const m = metricByKey(state.metric);
  const xd = XDEF[state.xAxis];
  const isGoal = m.key === "viscosity_pa_s";
  const [ref, size] = useSize<HTMLDivElement>();
  const W = Math.max(size.width, 260);
  const H = Math.max(size.height, 200);
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;

  const vals = [...rows.map((r) => r.values[m.key]), m.threshold];
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.12 || 1;
  const Y: [number, number] = [lo - pad, hi + pad];
  const y = (v: number) => M.t + ph - ((v - Y[0]) / (Y[1] - Y[0])) * ph;
  const xv = (v: number) => M.l + ((v - xd.domain[0]) / (xd.domain[1] - xd.domain[0])) * pw;
  const ty = y(m.threshold);
  const passTop = m.op === ">=" ? M.t : ty;
  const passH = m.op === ">=" ? ty - M.t : M.t + ph - ty;

  // identical recipes at similar values sit side by side
  const dodge = new Map<string, number>();
  const groups = new Map<string, Row[]>();
  rows.forEach((r) => {
    const key = `${xd.of(r)}|${Math.round(y(r.values[m.key]) / 14)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  });
  groups.forEach((g) => g.forEach((r, i) => dodge.set(r.id, (i - (g.length - 1) / 2) * 13)));
  const px = (r: Row) => xv(xd.of(r)) + (dodge.get(r.id) ?? 0);

  const status = (r: Row): Status => (isGoal ? statusOf(r) : checkStatus(m, r.values[m.key]));
  const best = rows.filter((r) => r.trial && !r.trial.excluded && statusOf(r) !== "fail").sort((a, b) => a.values.viscosity_pa_s - b.values.viscosity_pa_s)[0];
  const ordered = [...rows].sort((a, b) => Number(a.id === hl) - Number(b.id === hl));
  const yTicks = niceTicks(Y[0], Y[1], 4);
  const card = local ? rows.find((r) => r.id === local) : undefined;

  return (
    <div className="focus-chart">
      <div className="focus-head">
        <div className="tabs" role="tablist" aria-label="Check in focus">
          {METRICS.map((mm) => {
            const fails = rows.filter((r) => r.trial && checkStatus(mm, r.values[mm.key]) !== "goal").length;
            return (
              <button key={mm.key} role="tab" aria-selected={mm.key === m.key} className={mm.key === m.key ? "on" : ""}
                onClick={() => dispatch({ type: "metric", key: mm.key })} title={mm.label}>
                {TAB_LABEL[mm.key]}
                {mm.key !== "viscosity_pa_s" && fails > 0 && <span className="fails">{fails}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="focus-body" ref={ref}
      // Re-sorting the hovered dot to the top moves its DOM node, which can swallow mouseleave on fast moves.
      // So the container clears hover itself: when the pointer leaves it, or moves over anything that isn't a dot.
      onMouseLeave={() => { setLocal(null); dispatch({ type: "hover", id: null }); }}
      onMouseMove={(e) => { if (!(e.target as Element).classList?.contains("hit")) { setLocal(null); if (state.hover) dispatch({ type: "hover", id: null }); } }}>
        {size.width > 0 && (
          <svg width={W} height={H} role="img" aria-label={`${m.label} against ${xd.label.toLowerCase()}, with the limit ${limitText(m)}`}>
            <rect x={M.l} y={M.t} width={pw} height={ph} fill="#fff" stroke="var(--line)" />
            <rect x={M.l} y={passTop} width={pw} height={Math.max(0, passH)} fill="var(--goal)" />
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={M.l} x2={M.l + pw} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
                <text x={M.l - 7} y={y(v) + 3.5} textAnchor="end" className="tick">{fmtTick(v)}</text>
              </g>
            ))}
            {xd.ticks.map((v) => (
              <text key={v} x={xv(v)} y={M.t + ph + 15} textAnchor="middle" className="tick">{v}%</text>
            ))}
            <line x1={M.l} x2={M.l + pw} y1={ty} y2={ty} className="limit-line" />
            <text x={M.l + pw - 6} y={m.op === ">=" ? ty - 6 : ty + 14} textAnchor="end" className="limit-label">{limitText(m)}</text>
            <text transform={`translate(13 ${M.t + ph / 2}) rotate(-90)`} textAnchor="middle" className="axis-t">
              {m.label}{m.unit === "%" ? ", %" : m.unit ? `, ${m.unit}` : ""} · <tspan className="better">{m.op === "<=" ? "lower is better" : "higher is better"}</tspan>
            </text>

            {/* recipe axis: pick diluent or photoinitiator */}
            <foreignObject x={M.l} y={H - 22} width={pw} height={22}>
              <div className="axis-switch">
                {(["diluent", "photoinit"] as const).map((a) => (
                  <button key={a} className={state.xAxis === a ? "on" : ""} onClick={() => dispatch({ type: "xaxis", axis: a })}>
                    {XDEF[a].label} %
                  </button>
                ))}
                <span className="hint">{xd.hint}</span>
              </div>
            </foreignObject>

            {/* each person's path, in date order, across the recipe map */}
            {people.map((p) => {
              const mine = rows.filter((r) => r.owner === p.id && r.trial);
              if (mine.length < 2) return null;
              return <polyline key={p.id} points={mine.map((r) => `${px(r)},${y(r.values[m.key])}`).join(" ")} fill="none" stroke={colorOf(p.id)} strokeWidth={1.6} strokeOpacity={0.4} strokeLinejoin="round" />;
            })}

            {ordered.map((r) => {
              const cx = px(r), cy = y(r.values[m.key]);
              const on = r.id === hl;
              const excluded = !!r.trial?.excluded;
              const est = !!r.arm;
              const showLabel = on || excluded || est || r.id === best?.id;
              return (
                <g key={r.id} style={{ opacity: hl !== null && !on ? 0.4 : 1 }} className="dot-g">
                  {excluded && <circle cx={cx} cy={cy} r={12} fill="none" stroke="var(--ink-3)" strokeDasharray="3 2" />}
                  <StatusMark status={status(r)} cx={cx} cy={cy} est={est} on={on} />
                  {showLabel && (
                    <text x={cx} y={cy - 14} textAnchor="middle" className="dot-label">
                      {r.id}{excluded ? " · excluded" : est ? " est." : r.id === best?.id && !on ? " · best" : ""}
                    </text>
                  )}
                  <circle cx={cx} cy={cy} r={12} fill="transparent" className="hit" tabIndex={0} role="button"
                    aria-label={`${r.id}: ${m.label} ${r.values[m.key]}`}
                    onMouseEnter={() => { setLocal(r.id); dispatch({ type: "hover", id: r.id }); }}
                    onMouseLeave={() => { setLocal(null); dispatch({ type: "hover", id: null }); }}
                    onFocus={() => { setLocal(r.id); dispatch({ type: "hover", id: r.id }); }}
                    onBlur={() => { setLocal(null); dispatch({ type: "hover", id: null }); }}
                    onClick={() => r.trial && dispatch({ type: "select", sel: { trial: r.trial.id } })}
                    onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && r.trial) { e.preventDefault(); dispatch({ type: "select", sel: { trial: r.trial.id } }); } }} />
                </g>
              );
            })}
          </svg>
        )}
        {card && <RadarCard row={card} {...cardPos(px(card), y(card.values[m.key]), W, H)} />}
      </div>
    </div>
  );
}

function niceTicks(lo: number, hi: number, n: number): number[] {
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
const fmtTick = (v: number) => (Math.abs(v) < 10 ? String(+v.toFixed(2)) : String(Math.round(v)));
