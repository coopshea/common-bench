import { useEffect, useState, type CSSProperties } from "react";
import { people, personById, project, trials } from "./data/notebook.ts";
import { navigate, usePath } from "./lib/hooks.ts";
import { ME, experimentOfTrial, lab, org, parseRoute, pathOf, projectById } from "./lib/org.ts";
import { StoreProvider, noSel, useStore, type Selection } from "./state/store.tsx";
import { FutureDialog, FutureProvider, futureLabel, useFuture, useGo } from "./lib/nav.tsx";
import { Avatar, BackChip, BrandMark, Later, SearchIcon } from "./ds/index.tsx";
import { FlagDialog, FlagToast, ReviewList } from "./components/Review.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { ProjectPage } from "./pages/ProjectPage.tsx";
import { ExperimentPage } from "./pages/ExperimentPage.tsx";
import { LabPage } from "./pages/LabPage.tsx";
import { BenchPage } from "./pages/BenchPage.tsx";
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
      if (state.flagging) dispatch({ type: "flagging", target: null });
      else if (state.search) dispatch({ type: "search", open: false });
      else if (state.sel.step) dispatch({ type: "select", sel: { step: null } });
      else if (state.askOpen) dispatch({ type: "askOpen", open: false });
      else if (state.sel.trial || state.sel.inst) dispatch({ type: "select", sel: noSel });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.search, state.sel, state.askOpen, state.drawer, state.flagging, dispatch]);

  return (
    <div className="app cb" style={personVars}>
      <TopBar view={route.view} />
      <main className="page">
        {route.view === "home" && <HomePage />}
        {route.view === "project" && <ProjectPage projectId={route.project} />}
        {route.view === "experiment" && <ExperimentPage projectId={route.project} experimentId={route.experiment} />}
        {route.view === "lab" && <LabPage />}
        {route.view === "bench" && <BenchPage protocolId={route.protocol} mode={route.mode} />}
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
      <FlagDialog />
      <FlagToast />
    </div>
  );
}

function TopBar({ view }: { view: string }) {
  const { state, dispatch } = useStore();
  const [menu, setMenu] = useState(false);
  const future = useFuture();
  const go = useGo();
  const health = state.health.state;
  const me = personById(ME);
  return (
    <header className="topnav">
      <button className="brand" onClick={() => go(pathOf.home())}>
        <BrandMark /><span><b>Common Bench</b></span>
      </button>
      <nav className="nav" aria-label="Main">
        <div className="seg" role="group">
          {([["Projects", pathOf.home()], ["SOPs", pathOf.bench()], ["Lab", pathOf.lab()]] as const).map(([label, path]) => {
            const on = label === "Lab" ? view === "lab" : label === "SOPs" ? view === "bench" : view !== "lab" && view !== "bench";
            return <button key={label} className={on ? "on" : ""} aria-pressed={on} onClick={() => go(path)}>{label}</button>;
          })}
        </div>
        <button className="cb-round" aria-label="Search (⌘K)" title="Search (⌘K)" onClick={() => dispatch({ type: "search", open: true })}><SearchIcon /></button>
      </nav>
      <div className="me">
        <span className="synth" title={health === "live" ? `Live: ${state.health.model ?? ""}` : "Answers replay from a recorded run"}>
          <i className={`health ${health}`} />{project.synthetic_label}
        </span>
        <button className="me-btn" aria-label={`Account menu, ${me.name}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <Avatar id={ME} size="lg" />
          {state.flags.length > 0 && <span className="badge">{state.flags.length}</span>}
        </button>
        {menu && (
          <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
            <div className="menu-me"><Avatar id={ME} /><div><div className="h3">{me.name}</div><div className="cb-label">{me.role}</div></div></div>
            <hr />
            <p className="cb-label pad">Sent for review</p>
            <ReviewList onOpen={() => setMenu(false)} />
            <hr />
            {(["scan", "add", "connect", "devices"] as const).map((k) => (
              <button key={k} role="menuitem" onClick={() => { setMenu(false); future(k); }}>{futureLabel(k)}<Later /></button>
            ))}
            <hr />
            <button role="menuitem" onClick={() => { setMenu(false); go("/evals"); }}>Evals</button>
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
  const group = (title: string, items: React.ReactNode[]) => items.length > 0 && <div className="grp"><p className="cb-label">{title}</p>{items}</div>;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet finder" role="dialog" aria-label="Search">
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

