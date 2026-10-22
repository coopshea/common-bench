// A trial in the right panel: Ask first, then its numbers and specimens, the owner's note, and how it ran, drawn
// step by step with the bench instruments. A step that differs from the SOP carries the revision triangle.
import { useMemo } from "react";
import type { StepId, Trial } from "../shared/types.ts";
import { personById, project, trials } from "../data/notebook.ts";
import { METRICS, guardrailFails, rowOfTrial, statusOf } from "../lib/metrics.ts";
import { fmtDate, fmtTime, trim } from "../lib/format.ts";
import { instrumentOfDevice, pathOf } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { useStore } from "../state/store.tsx";
import { Avatar, Delta, FlagIcon, LogSquare, SOURCE_TEXT } from "../ds/index.tsx";
import { InstrumentFigure } from "../figures/bench/InstrumentFigure.tsx";
import { runsOf, stationAt } from "../figures/bench/timeline.ts";
import { DogboneFigure } from "../figures/DogboneFigure.tsx";
import { CouponCT } from "../figures/CouponFigure.tsx";
import { FloorPlan } from "./FloorPlan.tsx";
import { ScopedAsk } from "./ScopedAsk.tsx";
import { FlagsOn, useFlag } from "./Review.tsx";

const SOP_POSTCURE_MIN = 45;
const LONG_REST_H = 2; // the SOP prints right after mixing

export interface StepTile {
  id: StepId;
  label: string;
  value: string;
  source: "mhs" | "camera" | "manual" | "none" | "derived";
  dev: boolean; // differs from the SOP
  why?: string; // one sentence, only when it differs
}

/** The as-run SOP: one tile per station, valued from this trial. */
export function stepsOf(t: Trial): StepTile[] {
  const i = t.inputs, o = t.outputs;
  const others = trials.filter((x) => x.id !== t.id);
  const maxOtherRest = Math.max(...others.map((x) => x.inputs.rest_h));
  return project.sop.stations.map((st): StepTile => {
    const base = { id: st.id, label: st.label, source: st.source, dev: false };
    switch (st.id) {
      case "weigh": return { ...base, value: `${trim(i.diluent_wt, 1)}% diluent` };
      case "mix": return { ...base, value: `${i.mix_min} min` };
      case "degas": return i.degas_min > 0
        ? { ...base, value: `${i.degas_min} min`, source: "manual", dev: true, why: `Degassed ${i.degas_min} min; SOP ${project.sop.version} has no degassing step.` }
        : { ...base, value: "not run", source: "none" };
      case "viscosity": return { ...base, value: `${trim(o.viscosity_pa_s)} Pa·s` };
      case "print": return i.rest_h > LONG_REST_H
        ? { ...base, value: `${trim(i.rest_h, 0)} h rest`, source: "derived", dev: true,
            why: `Printed ${trim(i.rest_h, 0)} h after mixing; every other run waited under ${maxOtherRest < 1 ? "an hour" : `${Math.ceil(maxOtherRest)} h`}.` }
        : { ...base, value: `${trim(i.rest_h, 1)} h rest`, source: "derived" };
      case "postcure": return i.postcure_min !== SOP_POSTCURE_MIN
        ? { ...base, value: `${i.postcure_min} min`, dev: true, why: `Post-cured ${i.postcure_min} min; the SOP says ${SOP_POSTCURE_MIN}.` }
        : { ...base, value: `${i.postcure_min} min` };
      case "test": return { ...base, value: `${t.log.filter((e) => e.step === "test").length} results` };
    }
  });
}

const stamp = (iso: string) => `${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${fmtTime(iso)}`;

/** Differs from the SOP anywhere: drawn on the chart only for the selected trial. */
export const differs = (t: Trial) => stepsOf(t).some((s) => s.dev);

export function TrialPanel({ t, scope }: { t: Trial; scope: string }) {
  const { state, dispatch } = useStore();
  const go = useGo();
  const flag = useFlag();
  const owner = personById(t.owners[0]);
  const row = rowOfTrial(t);
  const status = statusOf(row);
  const fails = guardrailFails(row);
  const steps = useMemo(() => stepsOf(t), [t]);
  const runs = useMemo(() => runsOf(t), [t]);
  const step = state.sel.step;
  const tile = steps.find((s) => s.id === step);
  const st = step ? project.sop.stations.find((s) => s.id === step) : undefined;
  const log = step ? t.log.filter((e) => e.step === step) : [];
  // A long rest is only visible next to the mix that started it.
  const mixEnd = step === "print" && tile?.dev ? t.log.filter((e) => e.step === "mix").at(-1) : undefined;
  const lines = mixEnd ? [mixEnd, ...log] : log;
  const inst = log[0] ? instrumentOfDevice(log[0].device) : st ? instrumentOfDevice(st.device) : undefined;
  const rep = t.notes.map((n) => /Replicate of (T\d+)/i.exec(n.text)?.[1]).find(Boolean);
  const parent = rep ? `replicate of ${rep}` : null;
  const note = t.excluded ? t.notes.find((n) => /exclud/i.test(n.text)) : undefined;
  const quote = note && t.excluded_reason ? note.text.slice(note.text.indexOf(t.excluded_reason)) : t.excluded_reason;
  const V = METRICS.find((m) => m.key === "viscosity_pa_s")!, S = METRICS.find((m) => m.key === "uts_mpa")!, P = METRICS.find((m) => m.key === "porosity_pct")!;
  const flagStep = (id: StepId, label: string) => flag({ kind: "step", label: `${t.id} · ${label}`, sel: { trial: t.id, step: id, inst: null } });

  return (
    <ScopedAsk scope={t.id} wideScope={scope} placeholder={rep ? `What else differed from ${rep}?` : "Has anyone tried…?"}>
      <header className="pn-head">
        <div className="pn-title">
          <h2 className="mono pn-id">{t.id}</h2>
          <span className="cb-label">{fmtDate(t.date)}{parent ? ` · ${parent}` : ""}</span>
        </div>
        <div className="pn-tools">
          <Avatar id={owner.id} />
          <button className="cb-round sm" aria-label={`Flag ${t.id} for review`} title="Flag for review"
            onClick={() => flag({ kind: "trial", label: t.id, sel: { trial: t.id, step: null, inst: null } })}><FlagIcon /></button>
          <button className="cb-round sm" aria-label="Close trial" onClick={() => dispatch({ type: "select", sel: { trial: null } })}>×</button>
        </div>
      </header>
      <FlagsOn trial={t.id} />

      <section className="pn-stack">
        <div className="nums">
          <div className="num"><b>{trim(t.outputs.viscosity_pa_s)}</b><span>{V.unit}</span></div>
          <div className="num"><b>{trim(t.outputs.uts_mpa, 1)}</b><span>{S.unit} tensile</span></div>
          <div className="num"><b>{trim(t.outputs.porosity_pct)}</b><span>% porosity</span></div>
        </div>
        <p className="verdict">
          <span className={`res ${status}`} aria-hidden="true">{status === "goal" ? "✓" : status === "fail" ? "✕" : "○"}</span>
          {status === "goal" ? "Goal met, every guardrail passing" : status === "fail" ? `Fails ${fails.map((m) => m.label.toLowerCase()).join(", ")}` : `Guardrails pass; viscosity above ${V.threshold}`}
        </p>
        <div className="specs">
          <figure><DogboneFigure trial={t} strain={t.outputs.elongation_pct} width={230} height={84} /><figcaption className="cb-label">Tensile break</figcaption></figure>
          <figure><CouponCT trial={t} slice={5.5} width={190} height={127} /><figcaption className="cb-label">Cross-section</figcaption></figure>
        </div>
      </section>

      {quote && (
        <section className="pn-sect quote">
          <Avatar id={owner.id} />
          <div><p>“{quote}”</p><span className="cb-label">{owner.name.split(" ")[0]} · {fmtDate((note?.t ?? t.date).slice(0, 10))}</span></div>
        </section>
      )}

      <section className="pn-sect">
        <div className="pn-row"><h3 className="h3">How it ran</h3><span className="cb-label">SOP {project.sop.version} · {steps.length} steps</span></div>
        <div className="steps">
          {steps.map((s) => {
            const open = s.id === step;
            return (
              <button key={s.id} className={`step ${open ? "open" : ""}`} aria-expanded={open}
                onClick={() => dispatch({ type: "select", sel: { step: open ? null : s.id } })}
                onDoubleClick={(e) => { e.preventDefault(); flagStep(s.id, s.label); }}>
                {s.dev && <span className="step-flag"><Delta size={13} /></span>}
                <InstrumentFigure step={s.id} state={stationAt(t, runs, s.id, Infinity)} t={0.6} width={112} height={104} optional={s.id === "degas" && !s.dev && s.value === "not run"} label={s.label} />
                <b>{s.label}</b><i>{s.value}</i>
              </button>
            );
          })}
        </div>
        {tile && st && (
          <div className="step-open">
            <div className="step-open-top">
              <InstrumentFigure step={tile.id} state={stationAt(t, runs, tile.id, Infinity)} t={0.6} width={170} height={150} label={tile.label} />
              <div className="step-open-text">
                <div className="pn-row start">{tile.dev && <Delta size={15} />}<h3 className="h3">{tile.label} · {inst?.name ?? st.device}</h3></div>
                <p>{tile.why ?? (st.in_sop ? `As written in SOP ${project.sop.version}.` : `Not part of SOP ${project.sop.version}.`)}</p>
                <span className="cb-label with-sq"><LogSquare source={tile.source} />{SOURCE_TEXT[tile.source]}</span>
              </div>
            </div>
            {log.length > 0 ? (
              <div className="log" aria-label="Log lines">
                {lines.map((e) => (
                  <div key={e.id} className={tile.dev && e === log[0] ? "hl" : ""}>
                    <span>{stamp(e.t)}</span><span>{e.event}{e.value !== undefined ? ` · ${e.value}${e.unit ? " " + e.unit : ""}` : ""}</span>
                  </div>
                ))}
              </div>
            ) : <p className="cb-label">Nothing recorded</p>}
            {inst && (
              <div className="pn-row end">
                <FloorPlan selected={inst.id} mini />
                <button className="cb-btn ghost" onClick={() => go(pathOf.lab(), { inst: inst.id }, t.id)}>Open in lab</button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="pn-sect row-end">
        <button className="cb-link" onClick={() => dispatch({ type: "drawer", trialId: t.id })}>Full record →</button>
      </section>
    </ScopedAsk>
  );
}
