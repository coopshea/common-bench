// Run: the lab twin on the left shows where to go and what to fetch or put back; the steps on the right fill in
// by voice or by typing into any box, and everything after an overshoot recalculates. Speech is the browser's
// recognition plus a local parse (lib/benchSpeech.ts); without it, the recorded script plays.
import { useEffect, useRef, useState } from "react";
import type { BenchField, BenchProtocol } from "../shared/types.ts";
import { personById } from "../data/notebook.ts";
import { lab } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { compute, fmt, useBench, type Entry } from "../lib/benchRun.ts";
import { FATAL, listenOnce, parseUtterance, speechAvailable, stepNamed } from "../lib/benchSpeech.ts";
import { LabTwin, type TwinItem } from "../figures/LabTwin.tsx";
import { PlatePhoto } from "../figures/PlatePhoto.tsx";

const consumable = (id: string) => lab.consumables.find((k) => k.id === id)!;

export function BenchRun({ base }: { base: BenchProtocol }) {
  const go = useGo();
  const { proto, run, editRun } = useBench(base);
  const c = compute(proto, run);
  const [heard, setHeard] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
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
    editRun((x) => ({ ...x, entries: { ...x.entries, ...Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, by, ok: by === "typed" }])) } }));
    setFresh(new Set(Object.keys(values)));
  };
  const takePhoto = () => editRun((x) => ({ ...x, photo: { at: new Date().toTimeString().slice(0, 5) } }));
  const confirm = (id: string) => editRun((x) => ({ ...x, entries: { ...x.entries, [id]: { ...x.entries[id], ok: true } } }));
  const redo = (id: string) => { editRun((x) => { const { [id]: _, ...rest } = x.entries; return { ...x, entries: rest }; }); setRerecord(id); };
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
      if (e.code !== "Space" || (e.target as HTMLElement).closest("input, textarea, button")) return;
      e.preventDefault();
      listen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fieldRow = (f: BenchField) => {
    const e = run.entries[f.id];
    const t = c.target[f.id];
    const moved = !e && Math.abs(t - c.planned[f.id]) > 1e-9;
    return (
      <div key={f.id} className={`bfield ${fresh.has(f.id) ? "fresh" : ""} ${rerecord === f.id ? "armed" : ""}`}>
        <span className="blabel">{f.label}</span>
        <span className="btarget mono">{moved && <s>{fmt(c.planned[f.id], f.unit)}</s>} {fmt(t, f.unit)} {f.unit}</span>
        <ValueBox value={e?.value} unit={f.unit} label={f.label} onCommit={(v) => { record({ [f.id]: v }, "typed"); setRerecord(null); }} />
        <span className="bmarks">
          {e && <>
            <button className={`bok ${e.ok ? "on" : ""}`} aria-label={`Confirm ${f.label}`} onClick={() => confirm(f.id)}>✓</button>
            <button className="bno" aria-label={`Redo ${f.label}`} onClick={() => redo(f.id)}>✕</button>
          </>}
        </span>
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
          <h1 className="h2">{proto.title}{run.name && <span className="muted"> · Trial {run.name}</span>}</h1>
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
                {st.photo && run.photo && (
                  <figure className="bphoto">
                    <PlatePhoto dogbones={6} bars={3} width={260} />
                    <figcaption className="cb-label">{proto.title} · Trial {run.name} · {personById(proto.runner).name} · {run.photo.at}</figcaption>
                  </figure>
                )}
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

/** The recorded value: voice fills it, or tap and type. Enter or leaving the box records it. */
function ValueBox({ value, unit, label, onCommit }: { value: number | undefined; unit: string; label: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value === undefined ? "" : fmt(value, unit));
  useEffect(() => { setText(value === undefined ? "" : fmt(value, unit)); }, [value, unit]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <span className="bvalue">
      <input className="mono" inputMode="decimal" aria-label={label} value={text} onChange={(e) => setText(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <span className="mono unit">{unit}</span>
    </span>
  );
}
