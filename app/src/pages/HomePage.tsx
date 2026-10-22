// Home is navigation only: your projects, then the lab's research thrusts. Title and people, nothing else.
import { useState } from "react";
import { ME, myProjects, org, pathOf, projectsIn } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { People } from "../ds/index.tsx";
import type { Thrust } from "../shared/types.ts";

export function HomePage() {
  const go = useGo();
  const [showClosed, setShowClosed] = useState(false);
  const live = org.thrusts.filter((t) => !t.closed);
  const closed = org.thrusts.filter((t) => t.closed);
  const thrust = (t: Thrust) => (
    <div key={t.id} className="thrust">
      <div className="thrust-head"><h3>{t.title}</h3><p className="muted">{t.blurb}</p></div>
      <div className="rows">
        {projectsIn(t.id).map((p) => (
          <button key={p.id} className="prow" onClick={() => go(pathOf.project(p.id))}>
            <span>{p.title}</span><People ids={p.people} me={ME} size="sm" />
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="home">
      <section className="home-sect" aria-labelledby="yours">
        <h1 id="yours" className="h1">Your projects</h1>
        <div className="cards">
          {myProjects().map((p, k) => (
            <button key={p.id} className="pcard" onClick={() => go(pathOf.project(p.id))}>
              <span className="pcard-top"><span className="cb-label">{String(k + 1).padStart(2, "0")}</span><span className="t">{p.title}</span></span>
              <People ids={p.people} me={ME} />
            </button>
          ))}
        </div>
      </section>
      <section className="home-sect thrusts" aria-labelledby="thrusts">
        <h2 id="thrusts" className="h2">Research thrusts</h2>
        {live.map(thrust)}
        {closed.length > 0 && (
          <button className="cb-label more" onClick={() => setShowClosed((s) => !s)}>
            {showClosed ? "Hide closed" : `${closed.length} closed thrust${closed.length > 1 ? "s" : ""}`}
          </button>
        )}
        {showClosed && <div className="closed">{closed.map(thrust)}</div>}
      </section>
    </div>
  );
}
