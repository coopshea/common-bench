// Bench: a reusable protocol, and runs of it.
// - View: this run's name and settings at the top; every amount below is typeset math, worked with the run's numbers.
// - Print: the same page on paper, with blanks where the numbers go, so it can be solved by hand and read back by OCR.
// - Run: the split bench view (BenchRun.tsx).
// - Edit: the protocol itself, as a block document (BenchEditor.tsx). The only place the SOP changes.
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { BenchField, BenchProtocol } from "../shared/types.ts";
import { isPlain, toTex } from "../shared/calc.ts";
import { personById, trials } from "../data/notebook.ts";
import { ME, type BenchMode } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { clock, compute, fmt, forgetBench, offBy, trialsCsv, useBench, useLastActivity, type RunState } from "../lib/benchRun.ts";
import { duplicateProtocol, isCustom, addProtocol, protocolFromText, removeProtocol, useProtocols } from "../lib/sopLibrary.ts";
import { Avatar, Delta, Later } from "../ds/index.tsx";
import { MathTex, texText } from "../components/MathTex.tsx";
import { PlatePhoto } from "../figures/PlatePhoto.tsx";
import { InstrumentFigure } from "../figures/bench/InstrumentFigure.tsx";
import { runsOf, stationAt } from "../figures/bench/timeline.ts";
import { BenchRun } from "./BenchRun.tsx";
import "./bench.css";

// The block editor (BlockNote + Mantine) is the heaviest piece: load it only when Edit SOP is opened.
const BenchEditor = lazy(() => import("./BenchEditor.tsx").then((m) => ({ default: m.BenchEditor })));

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function BenchPage({ protocolId, mode }: { protocolId?: string; mode: BenchMode }) {
  const protocols = useProtocols();
  const proto = protocols.find((p) => p.id === protocolId);
  if (!proto) return <BenchList />;
  if (mode === "run") return <BenchRun key={proto.id} base={proto} />;
  if (mode === "edit") return <Suspense fallback={null}><BenchEditor key={proto.id} base={proto} /></Suspense>;
  return <BenchDoc key={proto.id} base={proto} paper={mode === "print"} />;
}

function BenchList() {
  const go = useGo();
  const protocols = useProtocols();
  const lastOf = useLastActivity();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BenchProtocol | null>(null);
  const sorted = [...protocols].sort((a, b) => lastOf(b).localeCompare(lastOf(a)));
  return (
    <div className="bench-pick">
      <header className="bench-pick-head">
        <h1 className="h1">SOPs</h1>
        <button className="cb-btn primary" onClick={() => setAdding(true)}>New SOP</button>
      </header>
      <div className="bench-list">
        {sorted.map((p) => (
          <div key={p.id} className="bench-item">
            <button className="bench-item-main" onClick={() => go(`/sops/${p.id}`)}>
              <span className="h2">{p.title}</span>
              <span className="mono muted">{day(lastOf(p))}</span>
            </button>
            <Avatar id={p.runner} size="sm" />
            <button className="cb-btn ghost sm" onClick={() => go(`/sops/${p.id}/print?now`)}>Print SOP</button>
            <button className="cb-btn ghost sm" onClick={() => go(`/sops/${duplicateProtocol(p, ME).id}/edit`)}>Duplicate</button>
            {isCustom(p.id) && <button className="cb-btn ghost sm" aria-label={`Delete ${p.title}`} onClick={() => setRemoving(p)}>Delete</button>}
          </div>
        ))}
        <div className="bench-item upload"><span className="h3">Upload a PDF</span><Later /></div>
      </div>
      {adding && <NewSop onClose={() => setAdding(false)} />}
      {removing && (
        <Sheet label="Delete SOP" onClose={() => setRemoving(null)}>
          <h2 className="h2">Delete {removing.title}?</h2>
          <p>Its versions and trials on this device go with it.</p>
          <div className="sheet-actions">
            <button className="cb-btn ghost" onClick={() => setRemoving(null)}>Cancel</button>
            <button className="cb-btn primary" autoFocus onClick={() => { removeProtocol(removing.id); forgetBench(removing.id); setRemoving(null); }}>Delete</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}

const PASTE_HINT = "1. Weigh 30 g of base monomer\n2. Add 19 g of diluent\n3. Mix at 2000 rpm for 2 min\n   - Scrape the walls halfway\n4. Degas for 10 min";

/** A new SOP: a name, and (if you have them) the steps pasted from wherever they live now. */
function NewSop({ onClose }: { onClose: () => void }) {
  const go = useGo();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const draft = useMemo(() => protocolFromText(title, text, ME), [title, text]);
  const amounts = draft.steps.reduce((n, s) => n + s.fields.length, 0), timers = draft.steps.filter((s) => s.timer_min).length;
  const create = () => { addProtocol(draft); onClose(); go(`/sops/${draft.id}/edit`); };
  return (
    <Sheet label="New SOP" onClose={onClose}>
      <h2 className="h2">New SOP</h2>
      <input className="field" autoFocus value={title} placeholder="Name" aria-label="Name" onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) create(); }} />
      <textarea rows={8} value={text} placeholder={PASTE_HINT} aria-label="Steps, one per line (optional)" onChange={(e) => setText(e.target.value)} />
      <div className="sheet-actions">
        {text.trim() && <span className="cb-label read">{draft.steps.length} step{draft.steps.length === 1 ? "" : "s"} · {amounts} amount{amounts === 1 ? "" : "s"} · {timers} timer{timers === 1 ? "" : "s"}</span>}
        <button className="cb-btn ghost" onClick={onClose}>Cancel</button>
        <button className="cb-btn primary" disabled={!title.trim()} onClick={create}>Create</button>
      </div>
    </Sheet>
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
  const { trialProto: proto, proto: latest, run, history, editRun, newRun } = useBench(base);
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

      {proto.params.length > 0 && <section className="doc-block params">
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
          </label>
        ))}
      </section>}

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
      {!paper && <TrialLog proto={latest} current={c.started ? run : null} history={history} />}
    </div>
  );
}

// ---------- Trials: every trial of this SOP on this device, and all of it as a spreadsheet ----------

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TrialLog({ proto, current, history }: { proto: BenchProtocol; current: RunState | null; history: RunState[] }) {
  const runs = [...history, ...(current ? [current] : [])];
  if (!runs.length) return null;
  const row = (r: RunState, now: boolean) => {
    const p = r.pinned?.proto ?? proto;
    const c = compute(p, r);
    const fields = p.steps.flatMap((s) => s.fields);
    const times = [...Object.values(r.entries).map((e) => e.at), ...Object.values(r.done), ...Object.values(r.timers).map((t) => t.start)].sort();
    const off = fields.filter((f) => { const e = r.entries[f.id], o = e ? offBy(e.value, c.target[f.id]) : null; return o !== null && Math.abs(o) > 0.05; }).length;
    return (
      <div key={`${r.name}-${times[0] ?? "new"}`} className="trial-row">
        <b className="mono">{r.name || "—"}</b>
        <span className="mono muted">{times[0] ? `${new Date(times[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${clock(times[0])}` : ""}</span>
        <span className="mono muted">{r.pinned ? `v${r.pinned.n}` : ""}</span>
        <span className="mono">{fields.filter((f) => r.entries[f.id]).length}/{fields.length} values{off > 0 && <span className="muted"> · {off} off target</span>}</span>
        <span className="mono muted end">{now ? (c.done ? "done" : "in progress") : c.done ? "done" : "stopped"}</span>
      </div>
    );
  };
  return (
    <section className="doc-block trial-log" aria-label="Trials">
      <div className="trial-log-head">
        <h2 className="h3">Trials</h2>
        <button className="cb-btn ghost sm" onClick={() => download(`${proto.title} trials.csv`, trialsCsv(proto, runs))}>Export CSV</button>
      </div>
      {[...runs].reverse().map((r) => row(r, r === current))}
    </section>
  );
}

/** A number box that keeps what you're typing ("0.", "") while the value it reports stays a number. */
export function NumberInput({ value, onChange, label, className = "" }: { value: number | undefined; onChange: (v: string) => void; label: string; className?: string }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => { if (value !== undefined && Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className={`mono ${className}`} inputMode="decimal" aria-label={label} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value); }} />;
}
