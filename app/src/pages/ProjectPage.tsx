// The project page: the goal, what's known and what's open (each tied to the trials behind it), and the experiments.
import { useState } from "react";
import type { OrgProject } from "../shared/types.ts";
import { personById, project as nb, trialById } from "../data/notebook.ts";
import { ME, experimentOfTrial, experimentsOf, knownAndOpen, pathOf, projectById, thrustById, type KnownItem } from "../lib/org.ts";
import { FutureButton, useGo } from "../lib/nav.tsx";
import { useRows } from "../lib/rows.ts";
import { useStore } from "../state/store.tsx";
import { Avatar, DocIcon, Later, People } from "../ds/index.tsx";
import { ScopedAsk } from "../components/ScopedAsk.tsx";
import { AtlasChart } from "../components/plots/AtlasChart.tsx";

export function ProjectPage({ projectId }: { projectId: string }) {
  const p = projectById(projectId)!;
  const { state } = useStore();
  const go = useGo();
  const rows = useRows();
  const [creating, setCreating] = useState(false);
  const th = thrustById(p.thrust);
  const { known, open } = knownAndOpen(p, state.ledger);
  const exps = experimentsOf(p.id);
  const openTrial = (id: string) => {
    const t = trialById(id);
    const x = t && experimentOfTrial(t);
    if (x) go(pathOf.experiment(x.project, x.id), { trial: id });
  };
  const entry = (k: KnownItem) => (
    <div key={k.id ?? k.text} className={`entry ${k.id && state.flash[k.id] ? "flash" : ""}`}>
      {k.owner ? <Avatar id={k.owner} size="sm" /> : <span />}
      <div>
        <p>{k.text}</p>
        <div className="cites">
          {k.ids?.length ? k.ids.map((id) => <button key={id} onClick={() => openTrial(id)}>{id}</button>) : k.cite && <span>{k.cite}</span>}
          {k.id && state.ledger.find((l) => l.id === k.id)?.pending_on && <span className="cb-label">pending {state.ledger.find((l) => l.id === k.id)!.pending_on}</span>}
        </div>
      </div>
    </div>
  );
  return (
    <div className="pg-split">
      <div className="pg-main">
        <div className="pg-title">
          <nav className="crumbs" aria-label="Breadcrumb"><button onClick={() => go(pathOf.home())}>{th.title}</button><span aria-hidden="true">/</span></nav>
          <h1 className="h1">{p.title}</h1>
        </div>
        <section className="state" aria-label="Goal and deliverable">
          <div><span className="cb-label">Goal</span><p className="big">{p.goal}</p></div>
          <div><span className="cb-label">Deliverable</span><p className="big">{p.deliverable}</p></div>
        </section>
        <section className="ledger">
          <div><h2 className="h3">What we know</h2>{known.length ? known.map(entry) : <p className="cb-label">Nothing established yet</p>}</div>
          <div><h2 className="h3">Open questions</h2>{open.length ? open.map(entry) : <p className="cb-label">None written down</p>}</div>
        </section>
        <section className="exps-sect" aria-labelledby="exps">
          <h2 id="exps" className="h2">Experiments</h2>
          <div className="exps">
            <button className="newcard" onClick={() => setCreating(true)}>
              <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="none" stroke="currentColor" /><path d="M20 12v16M12 20h16" stroke="currentColor" strokeWidth="1.5" /></svg>
              <span>New experiment</span>
            </button>
            {exps.map((x) => (
              <button key={x.id} className="exp" onClick={() => go(pathOf.experiment(p.id, x.id))}>
                <span className="exp-fig">
                  {x.campaign
                    ? <AtlasChart mini width={300} height={150} rows={rows.filter((r) => r.trial)} inFocus={(r) => r.trial?.campaign === x.campaign} ledger={state.ledger} />
                    : <span className="cb-label">No trials yet</span>}
                </span>
                <span className="t">{x.title}</span>
                <span className="exp-foot"><span className="cb-label">{x.when}</span><People ids={x.people} me={ME} size="sm" /></span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <aside className="pg-panel" aria-label="Project">
        <ScopedAsk scope="This project" suggestions={p.id === nb.id ? ["hero"] : []}>
          <ProjectRail p={p} />
        </ScopedAsk>
      </aside>
      {creating && <NewExperiment onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProjectRail({ p }: { p: OrgProject }) {
  const th = thrustById(p.thrust);
  return (
    <>
      <section className="pn-stack"><span className="cb-label">Why</span><p className="why">{p.why}</p></section>
      <section className="pn-sect">
        <h3 className="h3">People</h3>
        {p.people.map((id) => {
          const who = personById(id);
          return (
            <div key={id} className="person"><Avatar id={id} you={id === ME} /><div><div>{who.name}</div><div className="cb-label">{who.role.split(" · ")[0]}</div></div></div>
          );
        })}
      </section>
      <section className="pn-sect">
        <h3 className="h3">Documents</h3>
        <div className="docs">
          <span className="doc"><DocIcon />{th.funding}</span>
          {p.docs.map((d) => <span key={d} className="doc"><DocIcon />{d}</span>)}
        </div>
      </section>
      <section className="pn-sect row-start"><FutureButton k="report" /></section>
    </>
  );
}

function NewExperiment({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<string | null>(null);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="New experiment">
        <div className="pn-row"><h2 className="h2">New experiment</h2><button className="cb-round sm" aria-label="Close" onClick={onClose}>×</button></div>
        <input className="field" placeholder="Name" aria-label="Experiment name" autoFocus />
        <label className="drop">
          <input type="file" accept=".pdf,.doc,.docx,.md,.txt,image/*" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
          {file ?? "Drop an SOP, or a photo of a paper one"}
        </label>
        <div className="pn-row end">
          <button className="cb-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cb-btn primary" onClick={onClose}>Create<Later /></button>
        </div>
      </div>
    </div>
  );
}
