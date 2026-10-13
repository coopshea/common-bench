// The project: the process on top; plots and the trials table on the left; the chat on the right.
import { project } from "../data/notebook.ts";
import { BenchFigure } from "../figures/BenchFigure.tsx";
import { FocusChart } from "../components/plots/FocusChart.tsx";
import { TradeoffPlot } from "../components/plots/TradeoffPlot.tsx";
import { TrialsTable } from "../components/TrialsTable.tsx";
import { AgentPanel } from "../components/AgentPanel.tsx";
import { TrialDrawer } from "../components/TrialDrawer.tsx";
import { tourClass } from "../components/tour.ts";
import { useRows } from "../lib/rows.ts";
import { fmtMonth } from "../lib/format.ts";
import { useStore } from "../state/store.tsx";
import { people } from "../data/notebook.ts";

export function Workspace() {
  const { state, dispatch, replayDate } = useStore();
  const rows = useRows();
  const replaying = state.replay.cursor !== null;
  return (
    <div className="workspace">
      <div className={`process-row ${tourClass(state.tour, "process")}`}>
        <BenchFigure stations={project.sop.stations} activeStation={null} />
      </div>
      <main className={`main ${state.tour !== null ? "touring" : ""}`}>
        <section className="left">
          <div className={`panel plots ${tourClass(state.tour, "plots")}`}>
            <div className="plots-head">
              <span className="key"><b className="mk goal">✓</b>goal met</span>
              <span className="key"><b className="mk close">○</b>passes checks, too thick</span>
              <span className="key"><b className="mk fail">✕</b>fails a check</span>
              <span className="key"><b className="mk est" />estimate</span>
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
            <div className="plots-pair">
              <div className="plot-cell">
                <div className="plot-title">Goal: thin enough and strong enough</div>
                <TradeoffPlot rows={rows} />
              </div>
              <div className="plot-cell">
                <FocusChart rows={rows} />
              </div>
            </div>
          </div>
          <div className={`panel table-panel ${tourClass(state.tour, "table")}`}>
            <TrialsTable rows={rows} />
          </div>
        </section>
        <AgentPanel />
      </main>
      {state.drawer && <TrialDrawer />}
    </div>
  );
}
