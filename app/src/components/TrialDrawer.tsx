// Trial detail (only if someone asks): numbers, curves over the other trials, figures, and the log timeline.
import { useEffect, useRef, useState } from "react";
import type { Trial } from "../shared/types.ts";
import { colorOf, inkOf, personById, project, trialById, trials } from "../data/notebook.ts";
import { anomalyLabel, restGap } from "../lib/derive.ts";
import { fmtDate, fmtTime, trim } from "../lib/format.ts";
import { useStore } from "../state/store.tsx";
import { BenchFigure } from "../figures/BenchFigure.tsx";
import { DogboneFigure } from "../figures/DogboneFigure.tsx";
import { BendFigure, peakDeflection } from "../figures/BendFigure.tsx";
import { CouponFigure } from "../figures/CouponFigure.tsx";
import { useTween } from "../figures/useTween.ts";
import { Avatar, Check, SourceBadge } from "./bits.tsx";

const stepName = (id: string) => project.sop.stations.find((s) => s.id === id)?.label ?? id;

function CurvesChart({
  pick,
  focus,
  xLabel,
  yLabel,
  floor,
  at,
}: {
  pick: (t: Trial) => [number, number][];
  focus: Trial;
  xLabel: string;
  yLabel: string;
  floor?: number;
  at?: number; // x on the focus curve: a dot that follows the animated specimen
}) {
  const W = 300;
  const H = 150;
  const m = { l: 34, r: 8, t: 8, b: 28 };
  const xMax = Math.max(...trials.flatMap((t) => pick(t).map((p) => p[0])));
  const yMax = Math.max(...trials.flatMap((t) => pick(t).map((p) => p[1])));
  const x = (v: number) => m.l + (v / xMax) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (v / yMax) * (H - m.t - m.b);
  const path = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join("");
  return (
    <svg width={W} height={H} role="img" aria-label={`${yLabel} vs ${xLabel}`}>
      <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke="var(--line-2)" />
      <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} stroke="var(--line-2)" />
      {trials.filter((t) => t.id !== focus.id).map((t) => (
        <path key={t.id} d={path(pick(t))} fill="none" stroke={colorOf(t.owners[0])} strokeOpacity={0.16} strokeWidth={1} />
      ))}
      {floor !== undefined && (
        <>
          <line x1={m.l} x2={W - m.r} y1={y(floor)} y2={y(floor)} stroke="var(--ink-3)" strokeDasharray="3 3" />
          <text x={W - m.r} y={y(floor) - 3} textAnchor="end" fontSize={9.5} fill="var(--ink-3)">floor {floor}</text>
        </>
      )}
      <path d={path(pick(focus))} fill="none" stroke={colorOf(focus.owners[0])} strokeWidth={2.2} strokeLinejoin="round" />
      {at !== undefined && (() => {
        const pts = pick(focus);
        const i = pts.findIndex((q) => q[0] >= at);
        const [a, b] = i <= 0 ? [pts[Math.max(0, i)], pts[Math.max(0, i)]] : [pts[i - 1], pts[i]];
        const yv = b[0] === a[0] ? b[1] : a[1] + ((at - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
        return <circle cx={x(Math.min(at, b[0]))} cy={y(i < 0 ? pts[pts.length - 1][1] : yv)} r={4} fill="#fff" stroke={colorOf(focus.owners[0])} strokeWidth={2} />;
      })()}
      <text x={m.l + (W - m.l - m.r) / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--ink-3)">{xLabel}</text>
      <text transform={`translate(10 ${m.t + (H - m.t - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={10} fill="var(--ink-3)">{yLabel}</text>
      <text x={m.l - 4} y={m.t + 8} textAnchor="end" fontSize={9.5} fill="var(--ink-4)">{Math.round(yMax)}</text>
      <text x={W - m.r} y={H - m.b + 11} textAnchor="end" fontSize={9.5} fill="var(--ink-4)">{trim(xMax, 1)}</text>
    </svg>
  );
}

export function TrialDrawer() {
  const { state, dispatch } = useStore();
  const t = state.drawer ? trialById(state.drawer.trialId) : undefined;
  const logId = state.drawer?.logId;
  const [strain, setStrain] = useState(0);
  const [defl, setDefl] = useState(0);
  const hlRef = useRef<HTMLDivElement | null>(null);
  const pull = useTween(setStrain);
  const press = useTween(setDefl);

  useEffect(() => {
    if (!t) return;
    pull(0, t.outputs.elongation_pct);
    press(0, peakDeflection(t));
  }, [t, pull, press]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dispatch({ type: "drawer", trialId: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  useEffect(() => {
    hlRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [logId, t?.id]);

  if (!t) return null;
  const owner = personById(t.owners[0]);
  const o = t.outputs;
  const anomaly = anomalyLabel(t);
  const rest = restGap(t);
  const close = () => dispatch({ type: "drawer", trialId: null });
  const tensileFloor = project.guardrails.find((g) => g.id === "tensile")!.checks[0].threshold;
  const backfilled = t.log.some((e) => e.backfilled);

  return (
    <>
      <div className="drawer-scrim" onClick={close} />
      <aside className="drawer" aria-label={`Trial ${t.id}`}>
        <div className="drawer-head">
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: inkOf(owner.id) }}>{t.id}</span>
          <Avatar id={owner.id} size="sm" />
          <span style={{ fontWeight: 600 }}>{owner.name.split(" ")[0]}</span>
          <span className="muted">· {fmtDate(t.date)}</span>
          {t.excluded && <span className="tag amber">excluded</span>}
          <span style={{ flex: 1 }} />
          <button className="btn small" onClick={close}>Close</button>
        </div>
        <div className="drawer-body">
          <h3 style={{ marginTop: 2 }}>Notes</h3>
          <ul className="notes">
            {t.notes.map((n) => (
              <li key={n.id}>
                <span className="step-chip">{stepName(n.step)}</span>
                <span className="when">{fmtDate(n.t)} · {fmtTime(n.t)}</span>
                <span className="text">{n.text}</span>
              </li>
            ))}
          </ul>

          <h3>Recipe and results</h3>
          <div className="kv">
            <div><div className="k">Diluent</div><div className="v">{trim(t.inputs.diluent_wt)}%</div></div>
            <div><div className="k">Photoinitiator</div><div className="v">{trim(t.inputs.photoinit_wt)}%</div></div>
            <div><div className="k">Viscosity</div><div className="v">{o.viscosity_pa_s.toFixed(2)} Pa·s <Check ok={o.viscosity_pa_s <= project.objective.target} /></div></div>
            <div><div className="k">Bubbles (porosity)</div><div className="v">{trim(o.porosity_pct)}% <Check ok={t.guardrails.porosity} /></div></div>
            <div><div className="k">Tensile strength</div><div className="v">{trim(o.uts_mpa, 1)} MPa <Check ok={t.guardrails.tensile} /></div></div>
            <div><div className="k">Bend strength</div><div className="v">{trim(o.flex_strength_mpa, 1)} MPa <Check ok={t.guardrails.bend} /></div></div>
            <div><div className="k">Cells alive</div><div className="v">{trim(o.viability_pct, 1)}% <Check ok={t.guardrails.cytotox} /></div></div>
          </div>

          <h3>Process</h3>
          <BenchFigure stations={project.sop.stations} activeStation={null} trial={t} />

          <h3>Tests</h3>
          <div className="figs">
            <div className="fig">
              <div className="fh"><span>Tensile</span></div>
              <CurvesChart pick={(x) => x.curve} focus={t} xLabel="strain, %" yLabel="stress, MPa" floor={tensileFloor} at={strain} />
            </div>
            <div className="fig">
              <div className="fh"><span>3-point bend</span></div>
              <CurvesChart pick={(x) => x.flex_curve} focus={t} xLabel="deflection, mm" yLabel="load, N" at={defl} />
            </div>
          </div>

          <h3>Specimens</h3>
          <div className="figs">
            <div className="fig">
              <div className="fh"><span>Dogbone</span></div>
              <DogboneFigure trial={t} strain={strain} />
              <div className="spec-play">
                <button type="button" className="bench-play" onClick={() => pull(0, o.elongation_pct)} aria-label="Play pull">▶</button>
                <input type="range" min={0} max={o.elongation_pct} step={0.01} value={strain} onChange={(e) => setStrain(Number(e.target.value))} aria-label="Strain" />
              </div>
            </div>
            <div className="fig">
              <div className="fh"><span>Bend bar</span></div>
              <BendFigure trial={t} deflection={defl} />
              <div className="spec-play">
                <button type="button" className="bench-play" onClick={() => press(0, peakDeflection(t))} aria-label="Play bend">▶</button>
                <input type="range" min={0} max={peakDeflection(t)} step={0.01} value={defl} onChange={(e) => setDefl(Number(e.target.value))} aria-label="Deflection" />
              </div>
            </div>
            <div className="fig" style={{ gridColumn: "1 / -1" }}>
              <div className="fh"><span>Cross-section</span></div>
              <CouponFigure trial={t} />
            </div>
          </div>

          <h3>Instrument log{backfilled && <span className="muted" style={{ fontWeight: 400 }}> · imported from instrument exports</span>}</h3>
          <div>
            {t.log.map((e, i) => {
              const prev = t.log[i - 1];
              const gapH = prev ? (Date.parse(e.t) - Date.parse(prev.t)) / 3_600_000 : 0;
              const isRest = !!rest && e.id === rest.toId;
              const newDay = !prev || prev.t.slice(0, 10) !== e.t.slice(0, 10);
              const hl = e.id === logId;
              return (
                <div key={e.id}>
                  {prev && gapH >= 2 && (
                    <div className={`loggap ${isRest && rest.hours > 2 ? "amber" : ""}`}>
                      {isRest
                        ? `${rest.hours.toFixed(1)} h between mixing and printing`
                        : `${gapH.toFixed(1)} h gap`}
                    </div>
                  )}
                  <div className={`logline ${hl ? "hl" : ""}`} ref={hl ? hlRef : undefined}>
                    <span className="num" style={{ color: "var(--ink-3)", fontSize: 11.5 }}>
                      {newDay ? fmtDate(e.t).replace(/ \d{4}$/, "") + " " : ""}{fmtTime(e.t)}
                    </span>
                    <span><SourceBadge source={e.source} /></span>
                    <span>
                      {e.event}
                      {e.value !== undefined && <b> · {trim(e.value)} {e.unit}</b>}
                      <span className="muted"> · {e.device}</span>
                    </span>
                    <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      <span className="lid">{e.id}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
}
