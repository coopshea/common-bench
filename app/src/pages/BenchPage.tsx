// Bench: a protocol as a programmable document (params + formula blocks) before and after, and a split run view
// during: the lab twin on the left shows where to go and what to fetch, the steps on the right fill in as you speak.
// Speech is the browser's recognition plus a local parse (lib/benchSpeech.ts); without it, the recorded script plays.
import { useEffect, useMemo, useRef, useState } from "react";
import type { BenchField, BenchProtocol } from "../shared/types.ts";
import { notebook, personById, trials } from "../data/notebook.ts";
import { lab } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { compute, fmt, resetRun, useBenchRun, type Entry } from "../lib/benchRun.ts";
import { FATAL, listenOnce, parseUtterance, speechAvailable, stepNamed } from "../lib/benchSpeech.ts";
import { Avatar, Later } from "../ds/index.tsx";
import { LabTwin, type TwinItem } from "../figures/LabTwin.tsx";
import { PlatePhoto } from "../figures/PlatePhoto.tsx";
import { InstrumentFigure } from "../figures/bench/InstrumentFigure.tsx";
import { runsOf, stationAt } from "../figures/bench/timeline.ts";
import "./bench.css";

const protocols = notebook.bench ?? [];

export function BenchPage({ protocolId, run }: { protocolId?: string; run?: boolean }) {
  const proto = protocols.find((p) => p.id === protocolId);
  if (!proto) return <BenchPicker />;
  return run ? <BenchRun key={proto.id} proto={proto} /> : <BenchDoc key={proto.id} proto={proto} />;
}

function BenchPicker() {
  const go = useGo();
  return (
    <div className="bench-pick">
      <h1 className="h1">Protocols</h1>
      <div className="bench-list">
        {protocols.map((p) => (
          <button key={p.id} className="bench-item" onClick={() => go(`/bench/${p.id}`)}>
            <span className="h2">{p.title}</span>
            <Avatar id={p.runner} size="sm" />
          </button>
        ))}
        <div className="bench-item upload"><span className="h3">Upload a PDF</span><Later /></div>
      </div>
    </div>
  );
}

// ---------- The document: params and formula blocks; after a run, what was recorded ----------

function BenchDoc({ proto }: { proto: BenchProtocol }) {
  const go = useGo();
  const [s, update] = useBenchRun(proto);
  const c = compute(proto, s);
  const ref = useMemo(() => [...trials].reverse().find((t) => t.owners.includes(proto.runner)) ?? trials[trials.length - 1], [proto.runner]);
  const runs = useMemo(() => runsOf(ref), [ref]);
  const setParam = (id: string, v: string) => { const n = Number(v); if (v.trim() && Number.isFinite(n)) update((x) => ({ ...x, params: { ...x.params, [id]: n } })); };
  const setFormula = (id: string, f: string) => update((x) => ({ ...x, formulas: { ...x.formulas, [id]: f } }));

  return (
    <div className="bench-doc">
      <header className="doc-head">
        <h1 className="h1">{proto.title}</h1>
        <span className="doc-actions">
          {c.started && <button className="cb-btn ghost" onClick={() => resetRun(proto)}>New run</button>}
          {!c.done && <button className="cb-btn primary" onClick={() => go(`/bench/${proto.id}/run`)}>{c.started ? "Resume" : "Run"}</button>}
        </span>
      </header>

      <section className="doc-block params">
        {proto.params.map((p) => (
          <label key={p.id} className="param">
            <span className="param-label">{p.label}</span>
            <span className="param-val">
              <input className="mono" inputMode="decimal" defaultValue={s.params[p.id]} key={`${p.id}-${s.params[p.id]}`}
                onBlur={(e) => setParam(p.id, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              <span className="mono unit">{p.unit}</span>
            </span>
            <code className="param-id">{p.id}</code>
          </label>
        ))}
      </section>

      {proto.steps.map((st, i) => (
        <section key={st.id} className="doc-block doc-step">
          <div className="doc-step-text">
            <h2 className="h3"><span className="mono bnum">{i + 1}</span>{st.title}</h2>
            <ul className="bullets">{st.detail.map((d) => <li key={d}>{d}</li>)}</ul>
            {st.fields.map((f) => {
              const e = s.entries[f.id];
              return (
                <div key={f.id} className="doc-field">
                  <span>{f.label}</span>
                  <input className={`mono formula ${c.errors[f.id] ? "bad" : ""}`} defaultValue={s.formulas[f.id] ?? f.formula} spellCheck={false}
                    title={c.errors[f.id]} aria-label={`${f.label} formula`} onChange={(ev) => setFormula(f.id, ev.target.value)} />
                  <span className="mono planned">{fmt(c.planned[f.id], f.unit)} {f.unit}</span>
                  <span className={`mono actual ${e ? "has" : ""}`}>{e ? `${fmt(e.value, f.unit)} ${f.unit}` : ""}{e?.ok && <i className="ok">✓</i>}</span>
                </div>
              );
            })}
            {st.photo && s.photo && <Photo proto={proto} at={s.photo.at} title={st.title} />}
          </div>
          <InstrumentFigure step={st.station} state={stationAt(ref, runs, st.station, Infinity)} t={0.6} width={150} height={130} label={st.title} />
        </section>
      ))}
    </div>
  );
}

const Photo = ({ proto, at, title }: { proto: BenchProtocol; at: string; title: string }) => (
  <figure className="bphoto">
    <PlatePhoto dogbones={6} bars={3} width={260} />
    <figcaption className="cb-label">{title} · {proto.id} · {personById(proto.runner).name} · {at}</figcaption>
  </figure>
);

// ---------- The run: lab twin | steps ----------

const consumable = (id: string) => lab.consumables.find((k) => k.id === id)!;

function BenchRun({ proto }: { proto: BenchProtocol }) {
  const go = useGo();
  const [s, update] = useBenchRun(proto);
  const c = compute(proto, s);
  const [heard, setHeard] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [rerecord, setRerecord] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<"live" | "script">(() =>
    speechAvailable() && !new URLSearchParams(window.location.search).has("script") ? "live" : "script");
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => () => stopRef.current(), []);

  const step = proto.steps[c.done ? proto.steps.length - 1 : c.current];
  const items: TwinItem[] = c.done ? [] : [
    ...step.get.map((id) => ({ name: consumable(id).name, at: consumable(id).home, mode: "get" as const })),
    ...step.put.map((id) => ({ name: consumable(id).name, at: consumable(id).back ?? consumable(id).home, mode: "put" as const })),
  ];

  const nowRef = useRef<HTMLLIElement>(null);
  useEffect(() => { nowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [c.current]);

  const record = (values: Record<string, number>, by: Entry["by"]) => {
    update((x) => ({ ...x, entries: { ...x.entries, ...Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, by, ok: by === "typed" }])) } }));
    setFresh(new Set(Object.keys(values)));
  };
  const takePhoto = () => update((x) => ({ ...x, photo: { at: new Date().toTimeString().slice(0, 5) } }));
  const confirm = (id: string) => update((x) => ({ ...x, entries: { ...x.entries, [id]: { ...x.entries[id], ok: true } } }));
  const stepOfField = (id: string) => proto.steps.find((x) => x.fields.some((f) => f.id === id));

  const playScript = () => {
    const stepId = rerecord ? stepOfField(rerecord)?.id : proto.steps[c.current]?.id;
    const u = proto.script.find((x) => x.step === stepId);
    if (!u) return;
    setListening(true);
    setHeard(null);
    window.setTimeout(() => {
      setListening(false);
      setHeard(u.say);
      if (u.values) record(rerecord ? { [rerecord]: u.values[rerecord] } : u.values, "voice");
      if (u.photo && !rerecord) takePhoto();
      setRerecord(null);
    }, 900);
  };

  // One heard sentence → fields. "Step 3" in the sentence targets that step; otherwise the current one.
  const apply = (text: string) => {
    const named = stepNamed(text);
    const st = rerecord ? stepOfField(rerecord) : named && proto.steps[named - 1] ? proto.steps[named - 1] : proto.steps[c.current];
    if (!st) return;
    const { values, photo } = parseUtterance(text, rerecord ? st.fields.filter((f) => f.id === rerecord) : st.fields);
    setHeard(text);
    if (Object.keys(values).length) { record(values, "voice"); setRerecord(null); }
    if (photo && st.photo) takePhoto();
  };

  const listen = () => {
    if (listening || (c.done && !rerecord)) return;
    if (mode === "script") return playScript();
    let fallback = false;
    setListening(true);
    setHeard(null);
    stopRef.current = listenOnce({
      interim: setHeard,
      final: apply,
      error: (code) => { if (FATAL.has(code) || code === "unsupported") { fallback = true; setMode("script"); } },
      end: () => { setListening(false); if (fallback) playScript(); },
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || editing || (e.target as HTMLElement).closest("input, textarea, button")) return;
      e.preventDefault();
      listen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fieldRow = (f: BenchField) => {
    const e = s.entries[f.id];
    const t = c.target[f.id];
    const moved = !e && Math.abs(t - c.planned[f.id]) > 1e-9;
    return (
      <div key={f.id} className={`bfield ${fresh.has(f.id) ? "fresh" : ""} ${rerecord === f.id ? "armed" : ""}`}>
        <span className="blabel">{f.label}</span>
        {editing === f.id ? (
          <TypeValue unit={f.unit} initial={e?.value ?? t}
            onSave={(v) => { record({ [f.id]: v }, "typed"); setEditing(null); setRerecord(null); }}
            onRerecord={() => { setEditing(null); setRerecord(f.id); }} onCancel={() => setEditing(null)} />
        ) : (
          <>
            <span className="btarget mono">{moved && <s>{fmt(c.planned[f.id], f.unit)}</s>} {fmt(t, f.unit)} {f.unit}</span>
            {e ? (
              <>
                <span className="bactual mono">{fmt(e.value, f.unit)} {f.unit}</span>
                <span className="bmarks">
                  <button className={`bok ${e.ok ? "on" : ""}`} aria-label={`Confirm ${f.label}`} onClick={() => confirm(f.id)}>✓</button>
                  <button className="bno" aria-label={`Fix ${f.label}`} onClick={() => { setRerecord(null); setEditing(f.id); }}>✕</button>
                </span>
              </>
            ) : <span className="bactual blank" />}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="bench-split">
      <section className="split-twin" aria-label="Lab">
        <LabTwin selected={c.done ? null : step.instrument} onSelect={() => {}} active={c.done ? "" : step.instrument} items={items} />
      </section>

      <section className="split-steps">
        <header className="run-head">
          <button className="cb-round sm" aria-label="Protocol" onClick={() => go(`/bench/${proto.id}`)}>←</button>
          <h1 className="h2">{proto.title}</h1>
        </header>

        <ol className="run-steps">
          {proto.steps.map((st, i) => {
            const now = i === c.current, did = c.stepDone(i);
            return (
              <li key={st.id} ref={now ? nowRef : undefined} className={`rstep ${now ? "now" : did ? "done" : ""}`}>
                <button className="rstep-title" aria-expanded={open === st.id} onClick={() => setOpen(open === st.id ? null : st.id)}>
                  <span className="mono bnum">{did ? "✓" : i + 1}</span><span className="h3">{st.title}</span>
                </button>
                {open === st.id && <ul className="bullets rstep-detail">{st.detail.map((d) => <li key={d}>{d}</li>)}</ul>}
                {(now || did) && st.fields.map(fieldRow)}
                {st.photo && s.photo && <Photo proto={proto} at={s.photo.at} title={st.title} />}
              </li>
            );
          })}
        </ol>

        <footer className="run-mic">
          {heard && <p className="heard" aria-live="polite">“{heard}”</p>}
          {c.done ? (
            <button className="cb-btn primary" onClick={() => go(`/bench/${proto.id}`)}>Done</button>
          ) : (
            <div className="mic-row">
              <span className="mic-side" />
              <button className={`mic ${listening ? "on" : ""}`} aria-label="Speak" onClick={listen}>
                <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <button className="cb-round mic-side" aria-label="Take photo" disabled={!step.photo} onClick={() => { setHeard(null); takePhoto(); }}>
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 8h4l2-3h6l2 3h4v11H3Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}

function TypeValue({ unit, initial, onSave, onRerecord, onCancel }: {
  unit: string; initial: number; onSave: (v: number) => void; onRerecord: () => void; onCancel: () => void;
}) {
  const [v, setV] = useState(String(initial));
  const n = Number(v);
  return (
    <form className="btype" onSubmit={(e) => { e.preventDefault(); if (v.trim() && Number.isFinite(n)) onSave(n); }}>
      <input autoFocus onFocus={(e) => e.target.select()} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label="Value"
        onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <span className="mono">{unit}</span>
      <button type="submit" className="cb-btn primary sm">Save</button>
      <button type="button" className="cb-btn ghost sm" onClick={onRerecord}>Re-record</button>
    </form>
  );
}
