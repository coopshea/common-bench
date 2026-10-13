import type { CSSProperties } from "react";
import { colorOf, people, project } from "./data/notebook.ts";
import { objectiveBest } from "./lib/derive.ts";
import { navigate, usePath } from "./lib/hooks.ts";
import { StoreProvider, useStore } from "./state/store.tsx";
import { Workspace } from "./pages/Workspace.tsx";
import { EvalsPage } from "./pages/EvalsPage.tsx";
import { TourBar } from "./components/TourBar.tsx";

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

// One color per person, everywhere: exposed as CSS variables from notebook.people.
const personVars = Object.fromEntries(people.map((p) => [`--c-${p.id}`, p.color])) as CSSProperties;

function Shell() {
  const path = usePath();
  const onEvals = path.startsWith("/evals");
  return (
    <div className="app" style={personVars}>
      <TopBar onEvals={onEvals} />
      {onEvals ? <EvalsPage /> : <Workspace />}
      <TourBar />
    </div>
  );
}

function TopBar({ onEvals }: { onEvals: boolean }) {
  const { state, dispatch } = useStore();
  const best = objectiveBest();
  return (
    <div className="topbar">
      <span className="proj">{project.name}</span>
      <span className="obj">{project.objective.label}</span>
      {best && (
        <button className="best" onClick={() => { navigate("/"); dispatch({ type: "focus", id: best.id }); }}
          onMouseEnter={() => dispatch({ type: "hover", id: best.id })} onMouseLeave={() => dispatch({ type: "hover", id: null })}>
          Best <span className="mono">{best.id}</span> <b>{best.outputs.viscosity_pa_s.toFixed(2)} {project.objective.unit}</b>
          <span className="dot" style={{ background: colorOf(best.owners[0]) }} />
        </button>
      )}
      <span className="spacer" />
      <button className={`navlink ${!onEvals ? "active" : ""}`} onClick={() => navigate("/")}>Project</button>
      <button className={`navlink ${onEvals ? "active" : ""}`} onClick={() => navigate("/evals")}>Evals</button>
      <button className="btn small primary" onClick={() => dispatch({ type: "tour", step: state.tour === null ? 0 : null })}>
        {state.tour === null ? "Tour" : "Exit tour"}
      </button>
    </div>
  );
}
