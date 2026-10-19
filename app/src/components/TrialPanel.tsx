// A trial in the right panel: its numbers, how it ran step by step, and where each step happened.
import { useState } from "react";
import type { StepId, Trial } from "../shared/types.ts";
import { personById, project } from "../data/notebook.ts";
import { rowOfTrial, statusOf } from "../lib/metrics.ts";
import { fmtTime, trim } from "../lib/format.ts";
import { instrumentOfDevice, pathOf } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { useStore } from "../state/store.tsx";
import { Avatar, Eyebrow, SOURCE_TEXT, SourceSquare, StepTiles, type StepTile } from "../ds/index.tsx";
import { FloorPlan } from "./FloorPlan.tsx";
import { ScopedAsk } from "./ScopedAsk.tsx";

const station = (id: StepId) => project.sop.stations.find((s) => s.id === id)!;
const SOP_POSTCURE_MIN = 45;
const LONG_REST_H = 2; // the SOP prints right after mixing

/** The as-run SOP: one tile per station, valued from this trial. Dashed = differs from the SOP. */
export function stepsOf(t: Trial): StepTile[] {
  const i = t.inputs, o = t.outputs;
  return project.sop.stations.map((st) => {
    switch (st.id) {
      case "weigh": return { id: st.id, label: st.label, value: `${trim(i.diluent_wt, 1)}% diluent`, source: st.source };
      case "mix": return { id: st.id, label: st.label, value: `${i.mix_min} min`, source: st.source };
      case "degas": return { id: st.id, label: st.label, value: i.degas_min > 0 ? `${i.degas_min} min` : "None",
        source: i.degas_min > 0 ? "manual" : "none", dev: i.degas_min > 0 };
      case "viscosity": return { id: st.id, label: st.label, value: `${trim(o.viscosity_pa_s)} Pa·s`, source: st.source };
      case "print": return { id: st.id, label: st.label, value: `${trim(i.rest_h, 1)} h rest`, source: "derived", dev: i.rest_h > LONG_REST_H };
      case "postcure": return { id: st.id, label: st.label, value: `${i.postcure_min} min`, source: st.source, dev: i.postcure_min !== SOP_POSTCURE_MIN };
      case "test": return { id: st.id, label: st.label, value: `${trim(o.uts_mpa, 0)} MPa`, source: st.source };
    }
  });
}

export function TrialPanel({ t, scope }: { t: Trial; scope: string }) {
  const { state, dispatch } = useStore();
  const go = useGo();
  const [wide, setWide] = useState(false);
  const owner = personById(t.owners[0]);
  const status = statusOf(rowOfTrial(t));
  const steps = stepsOf(t);
  const step = state.sel.step;
  const tile = steps.find((s) => s.id === step);
  const st = step ? station(step) : null;
  const log = step ? t.log.filter((e) => e.step === step) : [];
  const inst = log[0] ? instrumentOfDevice(log[0].device) : st ? instrumentOfDevice(st.device) : undefined;
  return (
    <ScopedAsk scope={wide ? scope : t.id} wideScope={wide ? scope : t.id} onWiden={() => setWide((w) => !w)}>
      <div className="panel-head-row">
        <h2 className="t-card-title mono">{t.id}</h2>
        <Avatar id={owner.id} />
        <span className="muted small grow">{owner.name.split(" ")[0]} · {t.date}</span>
        <button className="cb-link" aria-label="Clear selection (Esc)" onClick={() => dispatch({ type: "select", sel: { trial: null } })}>✕</button>
      </div>
      <div className="cb-kv">
        <div><span>Viscosity</span><b>{trim(t.outputs.viscosity_pa_s)} Pa·s</b></div>
        <div><span>Tensile</span><b>{trim(t.outputs.uts_mpa, 0)} MPa</b></div>
        <div><span>Porosity</span><b>{trim(t.outputs.porosity_pct, 1)}%</b></div>
        <div><span>Result</span><b><span className={`cb-mk ${status}`} aria-label={status}>{status === "goal" ? "✓" : status === "fail" ? "✕" : ""}</span></b></div>
      </div>
      {t.excluded && t.excluded_reason && <p className="quote">{owner.name.split(" ")[0]}: “{t.excluded_reason}”</p>}
      <section>
        <Eyebrow>How it ran</Eyebrow>
        <StepTiles steps={steps} selected={step} onSelect={(id) => dispatch({ type: "select", sel: { step: id as StepId | null } })} />
        {tile && st && (
          <div className="step-detail">
            <div className="row"><b className="grow">{tile.label}</b><SourceSquare source={tile.source} /><span className="small muted">{SOURCE_TEXT[tile.source]}</span></div>
            <div className="small muted">{st.in_sop ? `In SOP ${project.sop.version}` : `Not in SOP ${project.sop.version}`}</div>
            {log.length > 0 ? log.map((e) => (
              <div key={e.id} className="steplog"><span className="mono">{fmtTime(e.t)}</span><span>{e.event}{e.value !== undefined ? ` · ${e.value}${e.unit ? " " + e.unit : ""}` : ""}</span></div>
            )) : <div className="small muted">Nothing recorded</div>}
            {inst && (
              <>
                <FloorPlan selected={inst.id} mini />
                <div className="row"><span className="small muted grow">{inst.name}</span>
                  <button className="cb-link" onClick={() => go(pathOf.lab(), { inst: inst.id }, t.id)}>Open in lab →</button></div>
              </>
            )}
          </div>
        )}
      </section>
      <section><button className="cb-btn" onClick={() => dispatch({ type: "drawer", trialId: t.id })}>Full record</button></section>
    </ScopedAsk>
  );
}
