// An experiment: its trials, drawn on the map of the whole project (the other experiments faded), and its table.
import { experimentById, experimentsOf, ME, pathOf, projectById, trialsOf } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { useRows } from "../lib/rows.ts";
import type { Row } from "../lib/metrics.ts";
import { personById, trialById } from "../data/notebook.ts";
import { useStore } from "../state/store.tsx";
import { Avatar, Eyebrow, People } from "../ds/index.tsx";
import { TradeoffPlot } from "../components/plots/TradeoffPlot.tsx";
import { TrialsTable } from "../components/TrialsTable.tsx";
import { TrialPanel } from "../components/TrialPanel.tsx";
import { ScopedAsk } from "../components/ScopedAsk.tsx";

export function ExperimentPage({ projectId, experimentId }: { projectId: string; experimentId: string }) {
  const p = projectById(projectId)!;
  const x = experimentById(experimentId)!;
  const { state, dispatch } = useStore();
  const go = useGo();
  const rows = useRows();
  // Approved draft arms (T15a/b) belong to the newest experiment.
  const newest = experimentsOf(p.id).filter((e) => e.campaign).at(-1);
  const inExp = (r: Row) => (r.trial ? r.trial.campaign === x.campaign : x.id === newest?.id);
  const mine = rows.filter(inExp);
  const trial = state.sel.trial ? trialById(state.sel.trial) : undefined;
  const n = trialsOf(x).length;
  return (
    <>
      <button className="cb-link crumb" onClick={() => go(pathOf.project(p.id))}>← {p.title}</button>
      <div className="head"><h1 className="t-page-title">{x.title}</h1><People ids={x.people} me={ME} /></div>
      <div className="split">
        <div className="main-col">
          {x.campaign ? (
            <>
              <section className="block chart">
                <div className="chart-head">
                  <b className="grow">Goal: thin enough and strong enough</b>
                  <span className="key"><span className="cb-mk goal">✓</span>met</span>
                  <span className="key"><span className="cb-mk close" />too thick</span>
                  <span className="key"><span className="cb-mk fail">✕</span>fails</span>
                  {x.people.map((id) => <span key={id} className="key"><i className="line" style={{ background: `var(--person-${id})` }} />{personById(id).name.split(" ")[0]}</span>)}
                </div>
                <div className="chart-box"><TradeoffPlot rows={rows} dim={(r) => !inExp(r)} /></div>
              </section>
              <div className="tbl"><TrialsTable rows={mine} /></div>
            </>
          ) : (
            <section className="block empty"><p className="muted">No trials yet</p></section>
          )}
        </div>
        <aside className="rail" aria-label={trial ? trial.id : "Experiment"}>
          {trial ? <TrialPanel key={trial.id} t={trial} scope="this experiment" /> : (
            <ScopedAsk scope="this experiment" suggestions={x.id === newest?.id ? ["hero"] : []}>
              <section><Eyebrow>Protocol</Eyebrow><div className="doc">{x.protocol}</div></section>
              <section>
                <Eyebrow>People</Eyebrow>
                {x.people.map((id) => <div key={id} className="person"><Avatar id={id} /><span>{personById(id).name}</span></div>)}
              </section>
              <section><Eyebrow>Trials</Eyebrow><div>{n} · {x.when}</div></section>
              {state.drafts.length > 0 && x.id === newest?.id && (
                <section><Eyebrow>Drafted next</Eyebrow>
                  {state.drafts.flatMap((d) => d.arms).map((a) => (
                    <button key={a.id} className="hitrow" onMouseEnter={() => dispatch({ type: "hover", id: a.id })} onMouseLeave={() => dispatch({ type: "hover", id: null })}>
                      <b className="mono">{a.id}</b><span className="k">estimate</span>
                    </button>
                  ))}
                </section>
              )}
            </ScopedAsk>
          )}
        </aside>
      </div>
    </>
  );
}
