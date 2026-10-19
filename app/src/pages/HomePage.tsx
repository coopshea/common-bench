// Home is navigation only: your projects, then the lab's research thrusts. Title and people, nothing else.
import { useState } from "react";
import { ME, myProjects, org, pathOf, projectsIn, thrustById } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { Eyebrow, ProjectCard, ProjectRow } from "../ds/index.tsx";
import type { Thrust } from "../shared/types.ts";

export function HomePage() {
  const go = useGo();
  const [showClosed, setShowClosed] = useState(false);
  const live = org.thrusts.filter((t) => !t.closed);
  const closed = org.thrusts.filter((t) => t.closed);
  const thrust = (t: Thrust) => (
    <section key={t.id} className="thrust">
      <h2 className="t-card-title">{t.title}</h2>
      <p className="blurb">{t.blurb}</p>
      <div className="rows">
        {projectsIn(t.id).map((p) => <ProjectRow key={p.id} title={p.title} people={p.people} me={ME} onOpen={() => go(pathOf.project(p.id))} />)}
      </div>
    </section>
  );
  return (
    <div className="home">
      <Eyebrow>Your projects</Eyebrow>
      <div className="cb-grid">
        {myProjects().map((p) => (
          <ProjectCard key={p.id} meta={thrustById(p.thrust).title} title={p.title} people={p.people} me={ME} onOpen={() => go(pathOf.project(p.id))} />
        ))}
      </div>
      <Eyebrow>Research thrusts</Eyebrow>
      {live.map(thrust)}
      <button className="cb-link" onClick={() => setShowClosed((s) => !s)}>{showClosed ? "Hide" : "Show"} closed ({closed.length})</button>
      {showClosed && <div className="closed">{closed.map(thrust)}</div>}
    </div>
  );
}
