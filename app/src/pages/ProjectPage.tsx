// The project page: the goal, what's known and what's open (which decide what to ask next), and the experiments.
import { useState } from "react";
import type { OrgProject } from "../shared/types.ts";
import { personById, project as nb } from "../data/notebook.ts";
import { ME, experimentsOf, knownAndOpen, pathOf, projectById, thrustById } from "../lib/org.ts";
import { FutureButton, useGo } from "../lib/nav.tsx";
import { useStore } from "../state/store.tsx";
import { Avatar, Eyebrow, Future, NewCard, People, ProjectCard } from "../ds/index.tsx";
import { ScopedAsk } from "../components/ScopedAsk.tsx";

export function ProjectPage({ projectId }: { projectId: string }) {
  const p = projectById(projectId)!;
  const { state } = useStore();
  const go = useGo();
  const [creating, setCreating] = useState(false);
  const th = thrustById(p.thrust);
  const { known, open } = knownAndOpen(p, state.ledger);
  const exps = experimentsOf(p.id);
  return (
    <>
      <button className="cb-link crumb" onClick={() => go(pathOf.home())}>← {th.title}</button>
      <div className="head"><h1 className="t-page-title">{p.title}</h1><People ids={p.people} me={ME} /></div>
      <div className="split">
        <div className="main-col">
          <section className="block goal">
            <Eyebrow>Goal</Eyebrow>
            <div className="goal-text">{p.goal}</div>
            <div className="small muted">Delivers: {p.deliverable}</div>
          </section>
          <div className="ku">
            <section className="block">
              <Eyebrow>What we know</Eyebrow>
              {known.length ? <ul className="claims">{known.map((k) => <li key={k.text}>{k.text}{k.cite && <span className="cite-t">{k.cite}</span>}</li>)}</ul>
                : <p className="small muted">Nothing established yet</p>}
            </section>
            <section className="block">
              <Eyebrow>Open questions</Eyebrow>
              {open.length ? <ul className="claims">{open.map((k) => <li key={k.text}>{k.text}{k.cite && <span className="cite-t">{k.cite}</span>}</li>)}</ul>
                : <p className="small muted">None written down</p>}
            </section>
          </div>
          <section>
            <Eyebrow>Experiments</Eyebrow>
            <div className="cb-grid">
              <NewCard label="New experiment" onClick={() => setCreating(true)} />
              {exps.map((x) => (
                <ProjectCard key={x.id} meta={`${x.when} · ${x.protocol}`} title={x.title} people={x.people} me={ME}
                  onOpen={() => go(pathOf.experiment(p.id, x.id))} />
              ))}
            </div>
          </section>
        </div>
        <aside className="rail" aria-label="Project">
          <ScopedAsk scope="this project" suggestions={p.id === nb.id ? ["hero"] : []}>
            <ProjectRail p={p} />
          </ScopedAsk>
        </aside>
      </div>
      {creating && <NewExperiment p={p} onClose={() => setCreating(false)} />}
    </>
  );
}

function ProjectRail({ p }: { p: OrgProject }) {
  const th = thrustById(p.thrust);
  return (
    <>
      <section><Eyebrow>Why</Eyebrow><p className="why">{p.why}</p></section>
      <section>
        <Eyebrow>People</Eyebrow>
        {p.people.map((id) => (
          <div key={id} className="person"><Avatar id={id} /><span>{personById(id).name}</span><span className="muted small">{personById(id).status === "former" ? "Former" : "Current"}</span></div>
        ))}
      </section>
      <section>
        <Eyebrow>Documents</Eyebrow>
        <div className="doc">{th.funding}</div>
        {p.docs.map((d) => <div key={d} className="doc">{d}</div>)}
      </section>
      <section><FutureButton k="report" /></section>
    </>
  );
}

type Mode = "upload" | "write" | "copy";

function NewExperiment({ p, onClose }: { p: OrgProject; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("upload");
  const [file, setFile] = useState<string | null>(null);
  const protocols = [...new Set(experimentsOf(p.id).map((x) => x.protocol))];
  const opt = (m: Mode, label: string) => (
    <button className={`opt ${mode === m ? "on" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
  );
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="finder dialog wide" role="dialog" aria-label="New experiment">
        <h2>New experiment</h2>
        <input className="name" placeholder="Name" aria-label="Experiment name" autoFocus />
        <Eyebrow>Protocol</Eyebrow>
        <div className="opts">{opt("upload", "Upload SOP")}{opt("write", "Write one")}{opt("copy", "Copy existing")}</div>
        {mode === "upload" && (
          <label className="drop">
            <input type="file" accept=".pdf,.doc,.docx,.md,.txt,image/*" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
            {file ?? "Drop an SOP, or a photo of a paper one"}
          </label>
        )}
        {mode === "write" && <textarea className="sop" placeholder={"1. Weigh\n2. Mix\n3. …"} aria-label="Steps" />}
        {mode === "copy" && (
          <div className="drop list">{protocols.length ? protocols.map((x) => <label key={x}><input type="radio" name="copy" /> {x}</label>) : "No protocols yet"}</div>
        )}
        <div className="actions">
          <button className="cb-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cb-btn" onClick={onClose}>Create <Future /></button>
        </div>
      </div>
    </div>
  );
}
