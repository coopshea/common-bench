// Trial: the lab twin on the left shows where to go and what to fetch or put back; the steps on the right fill in
// by voice or by typing into any box, and everything after an overshoot recalculates. Built for stepping away:
// the screen stays awake, unattended steps have timers that chime (and notify) when done, every value is timestamped,
// and the trial survives a reload. Speech is the browser's recognition plus a local parse (lib/benchSpeech.ts);
// without it, a script built from the current targets plays.
import { useEffect, useRef, useState } from "react";
import type { BenchField, BenchProtocol, BenchStep } from "../shared/types.ts";
import { personById } from "../data/notebook.ts";
import { lab } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { TOLERANCE, clock, compute, fmt, lastVersion, nowIso, offBy, useBench, type Entry } from "../lib/benchRun.ts";
import { FATAL, listenOnce, parseUtterance, speechAvailable, stepNamed } from "../lib/benchSpeech.ts";
import { LabTwin, type TwinItem } from "../figures/LabTwin.tsx";
import { PlatePhoto } from "../figures/PlatePhoto.tsx";

const consumable = (id: string) => lab.consumables.find((k) => k.id === id)!;
const r2 = (x: number) => Math.round(x * 100) / 100;
const mmss = (ms: number) => { const s = Math.max(0, Math.round(Math.abs(ms) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Three short tones: a timer finished. */
function chime() {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.26);
    }
  } catch { /* no audio: the screen still shows it */ }
}

/** Keep the screen on while a trial is open, and take it back after the tab returns from the background. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const take = () => { if (document.visibilityState === "visible") (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {}); };
    take();
    document.addEventListener("visibilitychange", take);
    return () => { document.removeEventListener("visibilitychange", take); lock?.release().catch(() => {}); };
  }, []);
}

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const id = window.setInterval(() => set((x) => x + 1), 1000); return () => window.clearInterval(id); }, [on]);
}

export function BenchRun({ base }: { base: BenchProtocol }) {
  const go = useGo();
  const { trialProto: proto, sop, run, editRun, adoptLatest } = useBench(base);
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
  useWakeLock();

  const step = proto.steps[c.done ? proto.steps.length - 1 : c.current];
  const items: TwinItem[] = c.done ? [] : [
    ...step.get.map((id) => ({ name: consumable(id).name, at: consumable(id).home, mode: "get" as const })),
    ...step.put.map((id) => ({ name: consumable(id).name, at: consumable(id).back ?? consumable(id).home, mode: "put" as const })),
  ];
  const latestN = lastVersion(sop).n;
  const behind = run.pinned && run.pinned.n < latestN;

  // Timers: tick while one runs; chime and notify once when it reaches zero.
  const running = Object.entries(run.timers).filter(([, t]) => !t.stop);
  useTick(running.length > 0);
  const alerted = useRef(new Set<string>());
  for (const [sid, t] of running) {
    const st = proto.steps.find((x) => x.id === sid);
    if (!st?.timer_min || alerted.current.has(sid)) continue;
    if (Date.now() - new Date(t.start).getTime() >= st.timer_min * 60_000) {
      alerted.current.add(sid);
      chime();
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(`${st.title} done`, { body: `${proto.title} · Trial ${run.name}` });
    }
  }

  const nowRef = useRef<HTMLLIElement>(null);
  // Keep the current step in view: jump there on open (after layout settles), glide there as steps advance.
  const opened = useRef(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      nowRef.current?.scrollIntoView({ behavior: opened.current ? "smooth" : "auto", block: "start" });
      opened.current = true;
    }, opened.current ? 0 : 250);
    return () => window.clearTimeout(id);
  }, [c.current]);

  // A step that completes stops its own timer (e.g. the photo finishes Print while its countdown runs).
  useEffect(() => {
    const finished = Object.entries(run.timers).filter(([sid, t]) => !t.stop && proto.steps.some((st, i) => st.id === sid && c.stepDone(i)));
    if (finished.length) editRun((x) => ({ ...x, timers: { ...x.timers, ...Object.fromEntries(finished.map(([sid, t]) => [sid, { ...t, stop: nowIso() }])) } }));
  }, [c.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const record = (values: Record<string, number>, by: Entry["by"]) => {
    const at = nowIso();
    editRun((x) => ({
      ...x,
      entries: {
        ...x.entries,
        ...Object.fromEntries(Object.entries(values).map(([id, value]) => {
          const off = offBy(value, c.target[id]);
          return [id, { value, by, at, ok: by === "typed" && !(off !== null && Math.abs(off) > TOLERANCE) }];
        })),
      },
    }));
    setFresh(new Set(Object.keys(values)));
  };
  const takePhoto = () => editRun((x) => ({ ...x, photo: { at: nowIso() } }));
  const markDone = (sid: string) => editRun((x) => ({ ...x, done: { ...x.done, [sid]: nowIso() } }));
  const confirm = (id: string) => editRun((x) => ({ ...x, entries: { ...x.entries, [id]: { ...x.entries[id], ok: true } } }));
  const redo = (id: string) => { editRun((x) => { const { [id]: _, ...rest } = x.entries; return { ...x, entries: rest }; }); setRerecord(id); };
  const stepOfField = (id: string) => proto.steps.find((x) => x.fields.some((f) => f.id === id));

  const startTimer = (st: BenchStep) => {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    alerted.current.delete(st.id);
    editRun((x) => ({ ...x, timers: { ...x.timers, [st.id]: { start: nowIso() } } }));
  };
  // Stopping fills in the step's time (rounded to half a minute), for the person to confirm.
  const stopTimer = (st: BenchStep) => {
    const t = run.timers[st.id];
    if (!t || t.stop) return;
    const stop = nowIso();
    const minutes = Math.round(((new Date(stop).getTime() - new Date(t.start).getTime()) / 60_000) * 2) / 2;
    const timeField = st.fields.find((f) => f.unit === "min" && !run.entries[f.id]);
    editRun((x) => ({
      ...x,
      timers: { ...x.timers, [st.id]: { ...t, stop } },
      entries: timeField ? { ...x.entries, [timeField.id]: { value: minutes, by: "timer", at: stop, ok: false } } : x.entries,
    }));
  };

  // Offline stand-in for speech: say what the targets are (the first weighed mass 2% over, as a real pour drifts).
  const playScript = () => {
    const st = rerecord ? stepOfField(rerecord) : proto.steps[c.current];
    if (!st) return;
    const fields = rerecord ? st.fields.filter((f) => f.id === rerecord) : st.fields;
    const firstMass = !proto.steps.flatMap((x) => x.fields).some((f) => f.scales && run.entries[f.id]);
    const values = Object.fromEntries(fields.map((f) => [f.id, f.scales && firstMass ? Math.round(c.target[f.id] * 1.02 * 10) / 10 : r2(c.target[f.id])]));
    const say = fields.length ? fields.map((f) => `${f.label}, ${values[f.id]} ${f.unit}`).join("; ") : st.photo ? "Photo." : "Done.";
    setListening(true);
    setHeard(null);
    window.setTimeout(() => {
      setListening(false);
      setHeard(say);
      if (fields.length) record(values, "voice");
      else if (st.photo) takePhoto();
      else markDone(st.id);
      setRerecord(null);
    }, 900);
  };

  // One heard sentence → fields. "Step 3" targets that step; "start"/"stop" run its timer; "done" finishes a step with nothing to enter.
  const apply = (text: string) => {
    const named = stepNamed(text);
    const st = rerecord ? stepOfField(rerecord) : named && proto.steps[named - 1] ? proto.steps[named - 1] : proto.steps[c.current];
    if (!st) return;
    setHeard(text);
    if (st.timer_min && /\bstart(ed)?\b/i.test(text) && !run.timers[st.id]) return startTimer(st);
    if (/\bstop(ped)?\b/i.test(text) && run.timers[st.id] && !run.timers[st.id].stop) return stopTimer(st);
    const { values, photo } = parseUtterance(text, rerecord ? st.fields.filter((f) => f.id === rerecord) : st.fields);
    if (Object.keys(values).length) { record(values, "voice"); setRerecord(null); }
    if (photo && st.photo) takePhoto();
    if (!st.fields.length && !st.photo && /\b(done|next|finished|complete)\b/i.test(text)) markDone(st.id);
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
    const off = e ? offBy(e.value, t) : null;
    const isOff = off !== null && Math.abs(off) > TOLERANCE;
    return (
      <div key={f.id} className={`bfield ${fresh.has(f.id) ? "fresh" : ""} ${rerecord === f.id ? "armed" : ""} ${isOff ? "off" : ""}`}>
        <span className="blabel">{f.label}{e && <span className="mono muted at">{clock(e.at)}</span>}</span>
        <span className="btarget mono">{moved && <s>{fmt(c.planned[f.id], f.unit)}</s>} {fmt(t, f.unit)} {f.unit}</span>
        <ValueBox value={e?.value} unit={f.unit} label={f.label} off={isOff ? off : null} onCommit={(v) => { record({ [f.id]: v }, "typed"); setRerecord(null); }} />
        <span className="bmarks">
          {e && <>
            <button className={`bok ${e.ok ? "on" : ""}`} aria-label={`Confirm ${f.label}`} onClick={() => confirm(f.id)}>✓</button>
            <button className="bno" aria-label={`Redo ${f.label}`} onClick={() => redo(f.id)}>✕</button>
          </>}
        </span>
      </div>
    );
  };

  const timerRow = (st: BenchStep) => {
    const t = run.timers[st.id];
    if (!st.timer_min) return null;
    if (!t) return <button className="cb-btn timer-start" onClick={() => startTimer(st)}>Start {mmss(st.timer_min * 60_000)}</button>;
    const end = t.stop ? new Date(t.stop).getTime() : Date.now();
    const left = st.timer_min * 60_000 - (end - new Date(t.start).getTime());
    return (
      <div className={`timer ${left <= 0 ? "over" : ""} ${t.stop ? "stopped" : ""}`}>
        <span className="mono timer-clock">{t.stop ? mmss(end - new Date(t.start).getTime()) : left <= 0 ? `+${mmss(left)}` : mmss(left)}</span>
        <span className="mono muted">{clock(t.start)}{t.stop ? `–${clock(t.stop)}` : ""}</span>
        {!t.stop && <button className="cb-btn" onClick={() => stopTimer(st)}>Stop</button>}
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
          <button className="cb-round sm" aria-label="Protocol" onClick={() => go(`/sops/${base.id}`)}>←</button>
          <h1 className="h2">{proto.title}{run.name && <span className="muted"> · Trial {run.name}</span>}</h1>
          {run.pinned && <span className="mono muted ver-pin">v{run.pinned.n}</span>}
        </header>
        {behind && (
          <div className="sop-behind">
            <span>SOP updated to v{latestN}</span>
            <button className="cb-link" onClick={adoptLatest}>Use v{latestN}</button>
          </div>
        )}

        <ol className="run-steps">
          {proto.steps.map((st, i) => {
            const now = i === c.current, did = c.stepDone(i);
            const showBullets = now ? open !== `hide:${st.id}` : open === st.id;
            const doneAt = run.done[st.id];
            return (
              <li key={st.id} ref={now ? nowRef : undefined} className={`rstep ${now ? "now" : did ? "done" : ""}`}>
                <button className="rstep-title" aria-expanded={showBullets}
                  onClick={() => setOpen(now ? (showBullets ? `hide:${st.id}` : null) : open === st.id ? null : st.id)}>
                  <span className="mono bnum">{did ? "✓" : i + 1}</span><span className="h3">{st.title}</span>
                  {doneAt && <span className="mono muted at">{clock(doneAt)}</span>}
                </button>
                {showBullets && <ul className="bullets rstep-detail">{st.detail.map((d) => <li key={d}>{d}</li>)}</ul>}
                {(now || run.timers[st.id]) && timerRow(st)}
                {(now || did) && st.fields.map(fieldRow)}
                {now && !st.fields.length && !st.photo && <button className="cb-btn primary step-done" onClick={() => markDone(st.id)}>Done</button>}
                {st.photo && run.photo && (
                  <figure className="bphoto">
                    <PlatePhoto dogbones={6} bars={3} width={260} />
                    <figcaption className="cb-label">{proto.title} · Trial {run.name} · {personById(proto.runner).name} · {clock(run.photo.at)}</figcaption>
                  </figure>
                )}
              </li>
            );
          })}
        </ol>

        <footer className="run-mic">
          {heard && <p className="heard" aria-live="polite">“{heard}”</p>}
          {c.done ? (
            <button className="cb-btn primary" onClick={() => go(`/sops/${base.id}`)}>Done</button>
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

/** The recorded value: voice fills it, or tap and type. Enter or leaving the box records it. Off-target values show how far. */
function ValueBox({ value, unit, label, off, onCommit }: { value: number | undefined; unit: string; label: string; off: number | null; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value === undefined ? "" : fmt(value, unit));
  useEffect(() => { setText(value === undefined ? "" : fmt(value, unit)); }, [value, unit]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <span className="bvalue">
      {off !== null && <span className="mono off-by">{off > 0 ? "+" : "−"}{Math.round(Math.abs(off) * 100)}%</span>}
      <input className="mono" inputMode="decimal" aria-label={label} value={text} onChange={(e) => setText(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <span className="mono unit">{unit}</span>
    </span>
  );
}
