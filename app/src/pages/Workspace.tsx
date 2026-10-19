// The project: the process on top; plots and the trials table on the left; the chat on the right.
import { project } from "../data/notebook.ts";
import { BenchFigure } from "../figures/BenchFigure.tsx";
import { FocusChart } from "../components/plots/FocusChart.tsx";
import { TradeoffPlot } from "../components/plots/TradeoffPlot.tsx";
import { TrialsTable } from "../components/TrialsTable.tsx";
import { AgentPanel } from "../components/AgentPanel.tsx";
import { TrialDrawer } from "../components/TrialDrawer.tsx";
import { tourClass, visiblePanels } from "../components/tour.ts";
import { useRows } from "../lib/rows.ts";
import { fmtMonth } from "../lib/format.ts";
import { useStore } from "../state/store.tsx";
import { people } from "../data/notebook.ts";

export function Workspace() {
  const { state, dispatch, replayDate } = useStore();
  const rows = useRows();
  const replaying = state.replay.cursor !== null;
  const show = visiblePanels(state.tour);
  // From the bench: focus a trial in progress on the plots and bring its row into view.
  const openTrial = (id: string) => {
    dispatch({ type: "focus", id });
    dispatch({ type: "hover", id });
    const row = [...document.querySelectorAll<HTMLTableRowElement>(".table-panel tbody tr")].find((r) => r.querySelector(".id .mono")?.textContent === id);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => dispatch({ type: "hover", id: null }), 1800);
  };
  return (
    <div className="workspace">
      {show.has("process") && (
        <div className={`process-row reveal ${tourClass(state.tour, "process")}`}>
          <BenchFigure stations={project.sop.stations} activeStation={null} live={state.drafts} onOpenTrial={openTrial} />
        </div>
      )}
      <main className={`main ${state.tour !== null ? "touring" : ""} ${show.has("agent") ? "" : "solo"}`}>
        <section className="left">
          <div className={`panel plots ${tourClass(state.tour, "plots")}`}>
            <div className="plots-head">
              <span className="key"><b className="mk goal">✓</b>goal met</span>
              <span className="key"><b className="mk close">○</b>passes checks, too thick</span>
              <span className="key"><b className="mk fail">✕</b>fails a check</span>
              {state.drafts.length > 0 && <span className="key"><b className="mk est" />estimate</span>}
              <span className="key-sep" />
              {people.map((p) => (
                <span className="key" key={p.id}><i className="line" style={{ background: p.color }} />{p.name.split(" ")[0]}</span>
              ))}
              <span className="spacer" />
              {replaying && <span className="replay-date">{replayDate ? fmtMonth(replayDate) : ""}</span>}
              <button className="btn small" onClick={() => dispatch({ type: replaying ? "replay/stop" : "replay/start" })}>
                {replaying ? "Stop" : "Replay"}
              </button>
            </div>
            <div className={`plots-pair ${show.has("focus") ? "" : "solo"}`}>
              <div className="plot-cell">
                <div className="plot-title">Goal: thin enough and strong enough</div>
                <TradeoffPlot rows={rows} />
              </div>
              {show.has("focus") && (
                <div className="plot-cell reveal">
                  <FocusChart rows={rows} />
                </div>
              )}
            </div>
          </div>
          {show.has("table") && (
            <div className={`panel table-panel reveal ${tourClass(state.tour, "table")}`}>
              <TrialsTable rows={rows} />
            </div>
          )}
        </section>
        {show.has("agent") && <AgentPanel />}
      </main>
      {state.drawer && <TrialDrawer />}
    </div>
  );
}
