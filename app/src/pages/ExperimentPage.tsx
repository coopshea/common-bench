// An experiment: its trials on the map of the whole project (the other experiments faded), and its table.
// Click a trial to open it in the panel; double-click to flag it for review.
import { useMemo } from "react";
import { experimentById, experimentsOf, ME, pathOf, projectById, thrustById } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { useHighlight, useRows } from "../lib/rows.ts";
import { guardrailFails, statusOf, type Row } from "../lib/metrics.ts";
import { personById, project, trialById } from "../data/notebook.ts";
import { trim } from "../lib/format.ts";
import { useStore } from "../state/store.tsx";
import { Avatar, Delta, People } from "../ds/index.tsx";
import { AtlasChart } from "../components/plots/AtlasChart.tsx";
import { TrialPanel, stepsOf } from "../components/TrialPanel.tsx";
import { ScopedAsk } from "../components/ScopedAsk.tsx";
import { useFlag } from "../components/Review.tsx";

const ICON = { goal: "✓", close: "○", fail: "✕" } as const;
const LABEL = { goal: "Goal met", close: "Guardrails pass", fail: "Fails a guardrail" } as const;

export function ExperimentPage({ projectId, experimentId }: { projectId: string; experimentId: string }) {
  const p = projectById(projectId)!;
  const x = experimentById(experimentId)!;
  const { state, dispatch } = useStore();
  const go = useGo();
  const flag = useFlag();
  const rows = useRows();
  const hl = useHighlight();
  // Approved draft arms (T15a/b) belong to the newest experiment.
  const newest = experimentsOf(p.id).filter((e) => e.campaign).at(-1);
  const inExp = (r: Row) => (r.trial ? r.trial.campaign === x.campaign : x.id === newest?.id);
  const mine = rows.filter(inExp);
  const trial = state.sel.trial ? trialById(state.sel.trial) : undefined;
  const flagged = useMemo(() => new Set(state.flags.map((f) => f.target.sel.trial).filter(Boolean) as string[]), [state.flags]);
  const select = (id: string) => dispatch({ type: "select", sel: { trial: id } });
  const flagTrial = (id: string) => flag({ kind: "trial", label: id, sel: { trial: id, step: null, inst: null } });
  const unusualRest = (r: Row) => !!r.trial && r.trial.id === state.sel.trial && stepsOf(r.trial).some((s) => s.id === "print" && s.dev);
  return (
    <div className="pg-split">
      <div className="pg-main">
        <div className="pg-title">
          <nav className="crumbs" aria-label="Breadcrumb">
            <button onClick={() => go(pathOf.home())}>{thrustById(p.thrust).title}</button><span aria-hidden="true">/</span>
            <button onClick={() => go(pathOf.project(p.id))}>{p.title}</button><span aria-hidden="true">/</span>
          </nav>
          <div className="pg-titlerow">
            <h1 className="h1">{x.title}</h1>
            <div className="pn-row"><span className="cb-label">{x.when} · {x.protocol}</span><People ids={x.people} me={ME} /></div>
          </div>
        </div>
        {x.campaign ? (
          <>
            <section className="chartbox" aria-label="Trade-off chart">
              <AtlasChart rows={rows} inFocus={inExp} ledger={state.ledger} selected={state.sel.trial} hover={hl} flagged={flagged}
                unusual={(r) => !!r.trial && stepsOf(r.trial).some((s) => s.dev)}
                onSelect={select} onFlag={flagTrial} onHover={(id) => dispatch({ type: "hover", id })} />
              <div className="key">
                {x.people.map((id) => <span key={id}><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill={`var(--person-${id})`} /></svg>This experiment</span>)}
                <span><svg width="26" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="var(--person-cooper)" opacity=".28" /><circle cx="19" cy="6" r="4.5" fill="var(--person-greeshma)" opacity=".28" /></svg>Rest of project</span>
                <span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="#fff" stroke="var(--ink-2)" strokeWidth="2" /></svg>Excluded or estimate</span>
                {trial && stepsOf(trial).some((s) => s.dev) && <span><Delta size={13} />Differs from SOP</span>}
                <span><svg width="18" height="12" aria-hidden="true"><rect x=".5" y=".5" width="17" height="11" fill="none" stroke="var(--ink-3)" /><path d="M3 11 11 1M9 11 17 1" stroke="#a39d92" /></svg>Called a dead end</span>
                <span className="cb-label grow-r">Double-click a trial to flag it</span>
              </div>
            </section>
            <section className="tbl" aria-label="Trials">
              <table>
                <thead><tr><th scope="col">Trial</th><th scope="col">Diluent</th><th scope="col">Rest</th><th scope="col">Viscosity</th><th scope="col">Tensile</th><th scope="col">Porosity</th><th scope="col">Result</th></tr></thead>
                <tbody onMouseLeave={() => dispatch({ type: "hover", id: null })}>
                  {[...mine].sort((a, b) => (a.date + a.id < b.date + b.id ? -1 : 1)).map((r) => {
                    const st = statusOf(r);
                    const on = r.id === state.sel.trial;
                    return (
                      <tr key={r.id} className={`${on ? "sel" : ""} ${r.id === hl && !on ? "hov" : ""} ${r.arm ? "est" : ""}`} aria-selected={on}
                        onMouseEnter={() => dispatch({ type: "hover", id: r.id })}
                        onClick={() => r.trial && select(r.id)}
                        onDoubleClick={(e) => { e.preventDefault(); if (r.trial) flagTrial(r.id); }}>
                        <td><span className="idcell">{r.id}{flagged.has(r.id) && <span className="flagdot" title="Flagged for review" />}</span></td>
                        <td>{trim(r.diluent, 0)}%</td>
                        <td>{r.trial ? <span className="withmark">{unusualRest(r) && <Delta size={13} />}{trim(r.trial.inputs.rest_h, 1)} h</span> : "—"}</td>
                        <td>{trim(r.values.viscosity_pa_s)}</td>
                        <td>{trim(r.values.uts_mpa, 1)}</td>
                        <td>{trim(r.values.porosity_pct)}%</td>
                        <td>
                          <span className="withmark">
                            {r.trial?.excluded && <span className="cb-label">excluded</span>}
                            {r.arm && <span className="cb-label">estimate</span>}
                            <span className={`res ${st}`} title={st === "fail" ? `Fails ${guardrailFails(r).map((m) => m.label.toLowerCase()).join(", ")}` : LABEL[st]} aria-label={LABEL[st]}>{ICON[st]}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        ) : (
          <p className="cb-label">No trials yet</p>
        )}
      </div>
      <aside className={`pg-panel ${trial ? "wide" : ""}`} aria-label={trial ? trial.id : "Experiment"}>
        {trial ? <TrialPanel key={trial.id} t={trial} scope="This experiment" /> : (
          <ScopedAsk scope="This experiment" suggestions={x.id === newest?.id ? ["hero"] : []}>
            <section className="pn-stack"><span className="cb-label">Protocol</span><p className="why">{x.protocol === `SOP ${project.sop.version}` ? `SOP ${project.sop.version}, ${project.sop.stations.filter((s) => s.in_sop).length} steps` : x.protocol}</p></section>
            <section className="pn-sect">
              <h3 className="h3">People</h3>
              {x.people.map((id) => <div key={id} className="person"><Avatar id={id} you={id === ME} /><div>{personById(id).name}</div></div>)}
            </section>
            {state.drafts.length > 0 && x.id === newest?.id && (
              <section className="pn-sect">
                <h3 className="h3">Drafted next</h3>
                {state.drafts.flatMap((d) => d.arms).map((a) => (
                  <button key={a.id} className="line-btn" onMouseEnter={() => dispatch({ type: "hover", id: a.id })} onMouseLeave={() => dispatch({ type: "hover", id: null })}>
                    <b className="mono">{a.id}</b><span className="cb-label">estimate</span>
                  </button>
                ))}
              </section>
            )}
          </ScopedAsk>
        )}
      </aside>
    </div>
  );
}
