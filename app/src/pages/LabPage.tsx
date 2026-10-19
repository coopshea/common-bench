// The room: every instrument, how it's logged, and who's using it. The right panel follows the selected instrument.
import { useState } from "react";
import type { Instrument, LabSource } from "../shared/types.ts";
import { personById } from "../data/notebook.ts";
import { experimentOfTrial, instrumentById, lab, pathOf, recentTrialsAt } from "../lib/org.ts";
import { FutureButton, useGo } from "../lib/nav.tsx";
import { rowOfTrial, statusOf } from "../lib/metrics.ts";
import { useStore } from "../state/store.tsx";
import { Avatar, Eyebrow, SOURCE_TEXT, SourceSquare } from "../ds/index.tsx";
import { FloorPlan, FloorPlan3D } from "../components/FloorPlan.tsx";
import { ScopedAsk } from "../components/ScopedAsk.tsx";

export function LabPage() {
  const { state, dispatch } = useStore();
  const [threeD, setThreeD] = useState(false);
  const sel = state.sel.inst ? instrumentById(state.sel.inst) : undefined;
  const select = (id: string) => dispatch({ type: "select", sel: { inst: id } });
  return (
    <>
      <div className="head">
        <h1 className="t-page-title">{lab.room}</h1>
        <div className="cb-toggle small" role="tablist" aria-label="Plan or 3D">
          <button role="tab" aria-selected={!threeD} onClick={() => setThreeD(false)}>Plan</button>
          <button role="tab" aria-selected={threeD} onClick={() => setThreeD(true)}>3D</button>
        </div>
      </div>
      <div className="split">
        <div className="main-col">
          <div className="block plan-box">
            {threeD ? <FloorPlan3D selected={sel?.id ?? null} onSelect={select} /> : <FloorPlan selected={sel?.id ?? null} onSelect={select} />}
          </div>
        </div>
        <aside className="rail" aria-label={sel ? sel.name : "Lab"}>
          {sel ? <InstrumentPanel i={sel} /> : <LabSummary onSelect={select} />}
        </aside>
      </div>
    </>
  );
}

function LabSummary({ onSelect }: { onSelect: (id: string) => void }) {
  const count = (k: (s: LabSource) => boolean) => lab.instruments.filter((i) => k(i.source)).length;
  const busy = lab.instruments.filter((i) => i.in_use);
  return (
    <ScopedAsk scope="the lab">
      <section>
        <Eyebrow>Instruments</Eyebrow>
        <div className="cb-legend">
          <div><i className="auto" /><b>{count((s) => s === "mhs" || s === "camera")}</b> log themselves</div>
          <div><i className="hand" /><b>{count((s) => s === "manual")}</b> by hand</div>
          <div><i className="none" /><b>{count((s) => s === "none")}</b> not logged</div>
        </div>
      </section>
      <section>
        <Eyebrow>In use now</Eyebrow>
        {busy.map((i) => (
          <button key={i.id} className="hitrow" onClick={() => onSelect(i.id)}>
            <Avatar id={i.in_use!.by} />{i.name}<span className="k">until {i.in_use!.until}</span>
          </button>
        ))}
      </section>
    </ScopedAsk>
  );
}

function InstrumentPanel({ i }: { i: Instrument }) {
  const { dispatch } = useStore();
  const go = useGo();
  const recent = recentTrialsAt(i);
  return (
    <ScopedAsk scope={i.name}>
      <div className="panel-head-row">
        <h2 className="t-card-title grow">{i.name}</h2>
        <button className="cb-link" aria-label="Clear selection (Esc)" onClick={() => dispatch({ type: "select", sel: { inst: null } })}>✕</button>
      </div>
      <div className="row"><SourceSquare source={i.source} /><span className="muted">{SOURCE_TEXT[i.source]}</span></div>
      <section>
        <Eyebrow>Now</Eyebrow>
        {i.in_use ? <div className="person"><Avatar id={i.in_use.by} /><span>{personById(i.in_use.by).name.split(" ")[0]} · until {i.in_use.until}</span></div> : <span className="muted">Free</span>}
      </section>
      <section><Eyebrow>Calibrated</Eyebrow>{i.calibrated ?? <span className="muted">No record</span>}</section>
      <section>
        <Eyebrow>Recent trials</Eyebrow>
        {recent.length ? recent.map((t) => {
          const x = experimentOfTrial(t)!;
          const s = statusOf(rowOfTrial(t));
          return (
            <button key={t.id} className="hitrow" onClick={() => go(pathOf.experiment(x.project, x.id), { trial: t.id }, i.name)}>
              <b className="mono">{t.id}</b><span className={`cb-mk ${s}`}>{s === "goal" ? "✓" : s === "fail" ? "✕" : ""}</span>
              <span className="k">{personById(t.owners[0]).name.split(" ")[0]} · {t.date}</span>
            </button>
          );
        }) : <span className="muted">None recorded</span>}
      </section>
      <section><FutureButton k="book" /></section>
    </ScopedAsk>
  );
}
