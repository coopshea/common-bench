// Bench: a reusable protocol, and runs of it.
// - View: this run's name and settings at the top; every amount below is typeset math, worked with the run's numbers.
// - Print: the same page on paper, with blanks where the numbers go, so it can be solved by hand and read back by OCR.
// - Run: the split bench view (BenchRun.tsx).
// - Edit: the protocol itself, as a block document (BenchEditor.tsx). The only place the SOP changes.
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { BenchField, BenchProtocol } from "../shared/types.ts";
import { isPlain, toTex } from "../shared/calc.ts";
import { personById, trials } from "../data/notebook.ts";
import { ME, lab, myProjects, type BenchMode } from "../lib/org.ts";
import { clashesOf, holdsFor } from "../lib/booking.ts";
import { useStore } from "../state/store.tsx";
import { useGo } from "../lib/nav.tsx";
import { clock, compute, fmt, forgetBench, getOperator, setOperator, summarize, trialsCsv, useBench, useLastActivity, type RunState } from "../lib/benchRun.ts";
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
  const [projectId, setProjectId] = useState("");
  const draft = useMemo(() => protocolFromText(title, text, ME, projectId || undefined), [title, text, projectId]);
  const amounts = draft.steps.reduce((n, s) => n + s.fields.length, 0), timers = draft.steps.filter((s) => s.timer_min).length;
  const create = () => { addProtocol(draft); onClose(); go(`/sops/${draft.id}/edit`); };
  return (
    <Sheet label="New SOP" onClose={onClose}>
      <h2 className="h2">New SOP</h2>
      <input className="field" autoFocus value={title} placeholder="Name" aria-label="Name" onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) create(); }} />
      <textarea rows={8} value={text} placeholder={PASTE_HINT} aria-label="Steps, one per line (optional)" onChange={(e) => setText(e.target.value)} />
      <select className="field" value={projectId} aria-label="Project" onChange={(e) => setProjectId(e.target.value)}>
        <option value="">No project</option>
        {myProjects().map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
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
  const [ready, setReady] = useState(false);
  const kit = kitOf(proto, c.target);
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
            {!c.done && <button className="cb-btn primary" onClick={() => (c.started ? go(`/sops/${proto.id}/run`) : setReady(true))}>{c.started ? "Resume trial" : "Start trial"}</button>}
          </span>
        )}
      </header>
      {paper && <div className="paper-meta"><span className="blank wide"><i>name</i></span><span className="blank wide"><i>date</i></span></div>}
      {ready && <ReadyCheck proto={proto} kit={kit} onClose={() => setReady(false)} onStart={(who) => { editRun((x) => ({ ...x, operator: who })); go(`/sops/${proto.id}/run`); }} />}

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

      {paper && kit.length > 0 && (
        <section className="doc-block kit-paper">
          <h2 className="h3">Gather</h2>
          <ul className="bullets checks">{kit.map((k) => <li key={k.name}>{k.amount && <b className="mono">{k.amount} </b>}{k.name}{k.where && <span className="muted"> · {k.where}</span>}</li>)}</ul>
        </section>
      )}
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
                  {run.photo.src ? <img src={run.photo.src} alt={`Photo, ${st.title}`} width={260} /> : <PlatePhoto dogbones={6} bars={3} width={260} />}
                  <figcaption className="cb-label">{proto.title} · Trial {run.name} · {run.operator || personById(proto.runner).name} · {clock(run.photo.at)}</figcaption>
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

// ---------- Before a trial: who is running it, what to gather, and whether the instruments are free ----------

interface KitItem { name: string; amount?: string; where?: string }
const MATERIAL = /^(mg|g|kg|µL|uL|ul|mL|ml|L)$/;

/** Everything to have on the bench before step 1: each material with its amount for this trial, and each thing to fetch with where it lives. */
function kitOf(p: BenchProtocol, target: Record<string, number>): KitItem[] {
  const items: KitItem[] = p.steps.flatMap((s) => s.fields).filter((f) => MATERIAL.test(f.unit)).map((f) => ({ name: f.label, amount: `${fmt(target[f.id], f.unit)} ${f.unit}` }));
  for (const id of new Set(p.steps.flatMap((s) => s.get))) {
    const k = lab.consumables.find((x) => x.id === id);
    if (!k) continue;
    const same = items.find((x) => x.name.toLowerCase() === k.name.toLowerCase());
    if (same) same.where = k.home; else items.push({ name: k.name, where: k.home });
  }
  return items;
}

function ReadyCheck({ proto, kit, onClose, onStart }: { proto: BenchProtocol; kit: KitItem[]; onClose: () => void; onStart: (who: string) => void }) {
  const { state, dispatch } = useStore();
  const [who, setWho] = useState(() => getOperator() || personById(ME).name);
  // Someone else on the instrument is a clash; your own use or booking is not.
  const holds = holdsFor(proto).map((d) => ({ d, all: clashesOf(d, state.bookings) })).map((h) => ({ ...h, clashes: h.all.filter((x) => x.by !== ME) }));
  const blocked = holds.some((h) => h.clashes.length > 0);
  const start = () => {
    const name = who.trim();
    if (!name) return;
    setOperator(name);
    // Hold each free instrument for about as long as the trial takes, so the Lab shows it as taken.
    holds.filter((h) => h.all.length === 0).forEach((h, k) =>
      dispatch({ type: "book", booking: { id: `B${state.bookings.length + k + 1}`, inst: h.d.inst.id, by: ME, day: h.d.day, from: h.d.from, to: h.d.to } }));
    onStart(name);
  };
  return (
    <Sheet label="Before you start" onClose={onClose}>
      <h2 className="h2">Before you start</h2>
      <label className="ready-who"><span className="cb-label">Operator</span>
        <input className="field" value={who} autoFocus aria-label="Operator" onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") start(); }} />
      </label>
      {kit.length > 0 && (
        <section className="ready-sect">
          <span className="cb-label">Gather</span>
          {kit.map((k) => <div key={k.name} className="ready-row"><span>{k.name}</span><span className="mono">{k.amount}</span><span className="muted">{k.where}</span></div>)}
        </section>
      )}
      {holds.length > 0 && (
        <section className="ready-sect">
          <span className="cb-label">Instruments · {holds[0].d.from}–{holds[0].d.to}</span>
          {holds.map(({ d, clashes }) => (
            <div key={d.inst.id} className={`ready-row ${clashes.length ? "taken" : ""}`}>
              <span>{d.inst.name}</span>
              {clashes.length
                ? <span className="ready-clash"><Avatar id={clashes[0].by} size="sm" />until {clashes[0].to}</span>
                : <span className="mono muted">free</span>}
            </div>
          ))}
        </section>
      )}
      <div className="sheet-actions">
        <button className="cb-btn ghost" onClick={onClose}>Cancel</button>
        <button className="cb-btn primary" disabled={!who.trim()} onClick={start}>{blocked ? "Start anyway" : "Start"}</button>
      </div>
    </Sheet>
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
    const x = summarize(proto, r);
    return (
      <div key={`${r.name}-${x.started ?? "new"}`} className="trial-row">
        <b className="mono">{r.name || "—"}</b>
        <span className="mono muted">{x.started ? `${new Date(x.started).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${clock(x.started)}` : ""}</span>
        <span className="mono muted">{r.pinned ? `v${r.pinned.n}` : ""}</span>
        <span className="trial-who">{r.operator ?? ""}</span>
        <span className="mono">{x.recorded}/{x.total} values{x.off.length > 0 && <span className="muted"> · {x.off.length} off target</span>}{x.notes > 0 && <span className="muted"> · {x.notes} note{x.notes === 1 ? "" : "s"}</span>}</span>
        <span className="mono muted end">{x.done ? `done${x.minutes ? ` · ${x.minutes} min` : ""}` : now ? "in progress" : "stopped"}</span>
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
