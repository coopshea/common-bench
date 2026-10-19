import { useEffect, useState, type CSSProperties } from "react";
import { people, personById, project, trials } from "./data/notebook.ts";
import { navigate, usePath } from "./lib/hooks.ts";
import { ME, experimentOfTrial, lab, org, parseRoute, pathOf, projectById } from "./lib/org.ts";
import { StoreProvider, noSel, useStore, type Selection } from "./state/store.tsx";
import { FutureDialog, FutureProvider, futureLabel, useFuture, useGo } from "./lib/nav.tsx";
import { Avatar, BackChip, Future, SearchIcon } from "./ds/index.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { ProjectPage } from "./pages/ProjectPage.tsx";
import { ExperimentPage } from "./pages/ExperimentPage.tsx";
import { LabPage } from "./pages/LabPage.tsx";
import { EvalsPage } from "./pages/EvalsPage.tsx";
import { TrialDrawer } from "./components/TrialDrawer.tsx";

export function App() {
  return (
    <StoreProvider>
      <FutureProvider>
        <Shell />
      </FutureProvider>
    </StoreProvider>
  );
}

// One color per person, everywhere: exposed as CSS variables from notebook.people.
const personVars = Object.fromEntries(people.map((p) => [`--c-${p.id}`, p.color])) as CSSProperties;

function Shell() {
  const path = usePath();
  const route = parseRoute(path);
  const { state, dispatch } = useStore();

  // Esc peels one layer: search, then the open step, then the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); dispatch({ type: "search", open: true }); return; }
      if (e.key !== "Escape" || state.drawer) return;
      if (state.search) dispatch({ type: "search", open: false });
      else if (state.sel.step) dispatch({ type: "select", sel: { step: null } });
      else if (state.askOpen) dispatch({ type: "askOpen", open: false });
      else if (state.sel.trial || state.sel.inst) dispatch({ type: "select", sel: noSel });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.search, state.sel, state.askOpen, state.drawer, dispatch]);

  return (
    <div className="app" style={personVars}>
      <TopBar onLab={route.view === "lab"} />
      <main className="page">
        {route.view === "home" && <HomePage />}
        {route.view === "project" && <ProjectPage projectId={route.project} />}
        {route.view === "experiment" && <ExperimentPage projectId={route.project} experimentId={route.experiment} />}
        {route.view === "lab" && <LabPage />}
        {route.view === "evals" && <EvalsPage />}
      </main>
      {state.back && (
        <BackChip label={state.back.label} onBack={() => {
          const b = state.back!;
          dispatch({ type: "back", back: null });
          navigate(b.path);
          dispatch({ type: "select", sel: b.sel });
        }} />
      )}
      {state.search && <Search />}
      {state.drawer && <TrialDrawer />}
      <FutureDialog />
    </div>
  );
}

function TopBar({ onLab }: { onLab: boolean }) {
  const { state, dispatch } = useStore();
  const [menu, setMenu] = useState(false);
  const future = useFuture();
  const go = useGo();
  const health = state.health.state;
  return (
    <header className="top">
      <button className="brand" onClick={() => go(pathOf.home())}>Common Bench</button>
      <div className="cb-nav">
        <div className="cb-toggle" role="tablist" aria-label="View">
          <button role="tab" aria-selected={!onLab} onClick={() => go(pathOf.home())}>Projects</button>
          <button role="tab" aria-selected={onLab} onClick={() => go(pathOf.lab())}>Lab</button>
        </div>
        <button className="cb-circle" aria-label="Search (⌘K)" title="Search (⌘K)" onClick={() => dispatch({ type: "search", open: true })}><SearchIcon /></button>
      </div>
      <div className="me">
        <span className="status-pill" title={health === "live" ? `Live: ${state.health.model ?? ""}` : "Answers replay from a recorded run"}>
          <i className={health} />{project.synthetic_label}
        </span>
        <button className="me-btn" aria-label="Account and lab settings" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <Avatar id={ME} />
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <p className="cb-eyebrow">Lab settings</p>
            {(["scan", "add", "connect", "devices"] as const).map((k) => (
              <button key={k} onClick={() => { setMenu(false); future(k); }}>{futureLabel(k)}<Future /></button>
            ))}
            <hr />
            <button onClick={() => { setMenu(false); go("/evals"); }}>Evals</button>
          </div>
        )}
      </div>
    </header>
  );
}

// ---------- Search: projects, experiments, trials, instruments ----------

function Search() {
  const { dispatch } = useStore();
  const go = useGo();
  const [q, setQ] = useState("");
  const close = () => dispatch({ type: "search", open: false });
  const has = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const on = q.trim().length > 0;
  const projects = on ? org.projects.filter((p) => has(p.title)) : [];
  const exps = on ? org.experiments.filter((x) => has(x.title)) : [];
  const ts = on ? trials.filter((t) => has(`${t.id} ${t.owners.map((o) => personById(o).name).join(" ")}`)) : trials.slice(-5).reverse();
  const insts = on ? lab.instruments.filter((i) => has(i.name)) : [];
  const open = (path: string, sel: Partial<Selection> = {}) => { close(); go(path, sel); };
  const group = (title: string, items: React.ReactNode[]) => items.length > 0 && <div className="grp"><p className="cb-eyebrow">{title}</p>{items}</div>;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="finder" role="dialog" aria-label="Search">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Projects, trials, people, instruments" aria-label="Search" />
        {group("Projects", projects.map((p) => <button key={p.id} className="hitrow" onClick={() => open(pathOf.project(p.id))}>{p.title}</button>))}
        {group("Experiments", exps.map((x) => <button key={x.id} className="hitrow" onClick={() => open(pathOf.experiment(x.project, x.id))}>{x.title}<span className="k">{projectById(x.project)?.title}</span></button>))}
        {group(on ? "Trials" : "Recent trials", ts.map((t) => {
          const x = experimentOfTrial(t)!;
          return <button key={t.id} className="hitrow" onClick={() => open(pathOf.experiment(x.project, x.id), { trial: t.id })}>
            <b className="mono">{t.id}</b><span className="k">{personById(t.owners[0]).name.split(" ")[0]} · {t.date}</span></button>;
        }))}
        {group("Instruments", insts.map((i) => <button key={i.id} className="hitrow" onClick={() => open(pathOf.lab(), { inst: i.id })}>{i.name}</button>))}
      </div>
    </div>
  );
}

