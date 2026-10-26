// Bench: a reusable protocol, and runs of it.
// - View: this run's name and settings at the top; every amount below is typeset math, worked with the run's numbers.
// - Print: the same page on paper, with blanks where the numbers go, so it can be solved by hand and read back by OCR.
// - Run: the split bench view (BenchRun.tsx).
// - Edit: the protocol itself, as a block document (BenchEditor.tsx). The only place the SOP changes.
import { useEffect, useMemo, useState } from "react";
import type { BenchField, BenchProtocol } from "../shared/types.ts";
import { isPlain, toTex } from "../shared/calc.ts";
import { notebook, personById, trials } from "../data/notebook.ts";
import type { BenchMode } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { compute, fmt, useBench, useLastActivity } from "../lib/benchRun.ts";
import { Avatar, Delta, Later } from "../ds/index.tsx";
import { MathTex, texText } from "../components/MathTex.tsx";
import { PlatePhoto } from "../figures/PlatePhoto.tsx";
import { InstrumentFigure } from "../figures/bench/InstrumentFigure.tsx";
import { runsOf, stationAt } from "../figures/bench/timeline.ts";
import { BenchRun } from "./BenchRun.tsx";
import { BenchEditor } from "./BenchEditor.tsx";
import "./bench.css";

const protocols = notebook.bench ?? [];
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function BenchPage({ protocolId, mode }: { protocolId?: string; mode: BenchMode }) {
  const proto = protocols.find((p) => p.id === protocolId);
  if (!proto) return <BenchList />;
  if (mode === "run") return <BenchRun key={proto.id} base={proto} />;
  if (mode === "edit") return <BenchEditor key={proto.id} base={proto} />;
  return <BenchDoc key={proto.id} base={proto} paper={mode === "print"} />;
}

function BenchList() {
  const go = useGo();
  const lastOf = useLastActivity();
  const sorted = [...protocols].sort((a, b) => lastOf(b).localeCompare(lastOf(a)));
  return (
    <div className="bench-pick">
      <h1 className="h1">SOPs</h1>
      <div className="bench-list">
        {sorted.map((p) => (
          <div key={p.id} className="bench-item">
            <button className="bench-item-main" onClick={() => go(`/sops/${p.id}`)}>
              <span className="h2">{p.title}</span>
              <span className="mono muted">{day(lastOf(p))}</span>
            </button>
            <Avatar id={p.runner} size="sm" />
            <button className="cb-btn ghost sm" onClick={() => go(`/sops/${p.id}`)}>Open</button>
            <button className="cb-btn ghost sm" onClick={() => go(`/sops/${p.id}/print?now`)}>Print SOP</button>
          </div>
        ))}
        <div className="bench-item upload"><span className="h3">Upload a PDF</span><Later /></div>
      </div>
    </div>
  );
}

// ---------- Amounts as math: the formula in words, then the same shape with numbers (or blanks to fill in) ----------

const blankTex = (label: string, w = 3) => `\\underset{\\text{${texText(label)}}}{\\underline{\\hspace{${w}em}}}`;
const unitTex = (u: string) => (u ? `\\ \\text{${texText(u)}}` : "");

function amountTex(f: BenchField, labels: Record<string, string>, scope: Record<string, number>, result: number | undefined, paper: boolean) {
  const lhs = `\\text{${texText(f.label)}}`;
  // On paper the computed target is printed faintly inside its blank: write over it only if something changed.
  const res = paper
    ? `\\underset{\\text{target}}{\\underline{\\hspace{0.5em}\\textcolor{#8a857b}{${fmt(result, f.unit)}}\\hspace{0.5em}}}`
    : `\\mathbf{${fmt(result, f.unit)}}`;
  try {
    if (isPlain(f.formula)) return `${lhs} = ${res}${unitTex(f.unit)}`;
    const words = toTex(f.formula, (id) => `\\text{${texText(labels[id] ?? id)}}`);
    const nums = toTex(f.formula, (id) => (paper ? blankTex(id) : fmt(scope[id], "")));
    return `\\begin{aligned} ${lhs} &= ${words} \\\\[4pt] &= ${nums} = ${res}${unitTex(f.unit)} \\end{aligned}`;
  } catch {
    return `${lhs} = \\text{?}`;
  }
}

function BenchDoc({ base, paper }: { base: BenchProtocol; paper: boolean }) {
  const go = useGo();
  const { trialProto: proto, proto: latest, run, editRun, newRun } = useBench(base);
  const sopValue = (id: string) => latest.params.find((x) => x.id === id)?.value;
  const c = compute(proto, run);
  const ref = useMemo(() => [...trials].reverse().find((t) => t.owners.includes(proto.runner)) ?? trials[trials.length - 1], [proto.runner]);
  const runs = useMemo(() => runsOf(ref), [ref]);
  const labels = useMemo(() => Object.fromEntries([...proto.params.map((x) => [x.id, x.label]), ...proto.steps.flatMap((s) => s.fields.map((f) => [f.id, f.label]))]), [proto]);
  // Print SOP opens the print dialog straight away (once fonts and math have laid out), then returns to where it came from.
  useEffect(() => {
    if (!paper || !new URLSearchParams(window.location.search).has("now")) return;
    let done = false, cancelled = false;
    const back = () => { if (!done) { done = true; window.history.back(); } };
    window.addEventListener("afterprint", back, { once: true });
    document.fonts.ready.then(() => requestAnimationFrame(() => { if (!cancelled) window.print(); }));
    return () => { cancelled = true; window.removeEventListener("afterprint", back); };
  }, [paper]);
  const setParam = (id: string, v: string) => {
    if (v.trim() === "" || !Number.isFinite(Number(v))) return;
    editRun((x) => ({ ...x, params: { ...x.params, [id]: Number(v) } }));
  };

  return (
    <div className={`bench-doc ${paper ? "print" : "view"}`}>
      <header className="doc-head">
        <div className="doc-title">
          <h1 className="h1">{proto.title}</h1>
          <label className="trial-name">
            <span>Trial</span>
            {paper
              ? <span className="blank wide"><i>trial</i></span>
              : <input className="run-name mono" value={run.name} aria-label="Trial" onChange={(e) => editRun((x) => ({ ...x, name: e.target.value }))} />}
          </label>
        </div>
        {paper ? (
          <span className="doc-actions no-print">
            <button className="cb-btn ghost" onClick={() => go(`/sops/${proto.id}`)}>Back</button>
            <button className="cb-btn primary" onClick={() => window.print()}>Print</button>
          </span>
        ) : (
          <span className="doc-actions">
            <button className="cb-btn ghost" onClick={() => go(`/sops/${proto.id}/edit`)}>Edit SOP</button>
            <button className="cb-btn ghost" onClick={() => go(`/sops/${proto.id}/print?now`)}>Print SOP</button>
            {c.started && <button className="cb-btn ghost" onClick={newRun}>New trial</button>}
            {!c.done && <button className="cb-btn primary" onClick={() => go(`/sops/${proto.id}/run`)}>{c.started ? "Resume trial" : "Start trial"}</button>}
          </span>
        )}
      </header>
      {paper && <div className="paper-meta"><span className="blank wide"><i>name</i></span><span className="blank wide"><i>date</i></span></div>}

      <section className="doc-block params">
        {proto.params.map((p) => (
          <label key={p.id} className="param">
            <span className="param-label">{p.label}
              {!paper && run.params[p.id] !== undefined && run.params[p.id] !== sopValue(p.id) && (
                <button className="delta-btn" title={`SOP: ${sopValue(p.id)} ${p.unit}. Reset`} aria-label={`Reset ${p.label} to the SOP value`}
                  onClick={(e) => { e.preventDefault(); editRun((x) => ({ ...x, params: { ...x.params, [p.id]: sopValue(p.id)! } })); }}><Delta size={13} /></button>
              )}
            </span>
            <span className="param-val">
              {paper
                ? <><span className="mono planned">{fmt(run.params[p.id] ?? p.value, p.unit)}</span><span className="blank"><i>{p.id}</i></span></>
                : <NumberInput label={p.label} value={run.params[p.id] ?? p.value} onChange={(v) => setParam(p.id, v)} />}
              <span className="mono unit">{p.unit}</span>
            </span>
            {!paper && <code className="param-id">{p.id}</code>}
          </label>
        ))}
      </section>

      {proto.steps.map((st, i) => (
        <section key={st.id} className="doc-block doc-step">
          <div className="doc-step-text">
            <h2 className="h3"><span className="mono bnum">{i + 1}</span>{st.title}{paper && <span className="box" />}</h2>
            <ul className={`bullets ${paper ? "checks" : ""}`}>{st.detail.map((d) => <li key={d}>{d}</li>)}</ul>
            {st.fields.map((f) => {
              const e = run.entries[f.id];
              return (
                <div key={f.id} className="doc-field">
                  <MathTex tex={amountTex(f, labels, c.scope, c.target[f.id], paper)} />
                  {paper
                    ? <span className="actual-blank"><span className="blank wide"><i>actual</i></span><span className="unit">{f.unit}</span></span>
                    : e ? <span className="mono doc-actual">{fmt(e.value, f.unit)} {f.unit}{e.ok && <i className="ok">✓</i>}</span> : <span />}
                </div>
              );
            })}
            {st.photo && (paper
              ? <div className="doc-field"><span>Photo</span><span className="box" /></div>
              : run.photo && (
                <figure className="bphoto">
                  <PlatePhoto dogbones={6} bars={3} width={260} />
                  <figcaption className="cb-label">{proto.title} · Trial {run.name} · {personById(proto.runner).name} · {run.photo.at}</figcaption>
                </figure>
              ))}
          </div>
          <InstrumentFigure step={st.station} state={stationAt(ref, runs, st.station, Infinity)} t={0.6} width={150} height={130} label={st.title} />
        </section>
      ))}
    </div>
  );
}

/** A number box that keeps what you're typing ("0.", "") while the value it reports stays a number. */
export function NumberInput({ value, onChange, label, className = "" }: { value: number | undefined; onChange: (v: string) => void; label: string; className?: string }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => { if (value !== undefined && Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className={`mono ${className}`} inputMode="decimal" aria-label={label} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value); }} />;
}
