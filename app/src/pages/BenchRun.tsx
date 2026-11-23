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
import { TOLERANCE, clock, compute, fmt, lastVersion, nowIso, offBy, summarize, useBench, type Entry, type Note } from "../lib/benchRun.ts";
import { FATAL, listenOnce, parseUtterance, speechAvailable, stepNamed, wordsToDigits } from "../lib/benchSpeech.ts";
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

/** One frame from the camera as a small JPEG, or nothing when there's no camera (or no permission) to take it with. */
async function snap(): Promise<string | undefined> {
  let stream: MediaStream | undefined;
  try {
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } }),
      new Promise<never>((_, no) => window.setTimeout(() => no(new Error("camera timeout")), 8000)),
    ]);
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    await new Promise((r) => window.setTimeout(r, 500)); // let exposure settle
    const w = 640, h = Math.round((w * video.videoHeight) / (video.videoWidth || w)) || 480;
    const cv = Object.assign(document.createElement("canvas"), { width: w, height: h });
    cv.getContext("2d")!.drawImage(video, 0, 0, w, h);
    return cv.toDataURL("image/jpeg", 0.7);
  } catch { return undefined; } finally { stream?.getTracks().forEach((t) => t.stop()); }
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
  const { trialProto: proto, sop, run, editRun, adoptLatest, newRun } = useBench(base);
  const c = compute(proto, run);
  const [heard, setHeard] = useState<string | null>(null);
  const [missed, setMissed] = useState(false); // the last thing heard had nothing in it to record
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const [rerecord, setRerecord] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<"live" | "script">(() =>
    speechAvailable() && !new URLSearchParams(window.location.search).has("script") ? "live" : "script");
  const stopRef = useRef<() => void>(() => {});
  // Hands-free: one tap on the microphone and it keeps listening, sentence after sentence, until tapped again.
  const [live, setLive] = useState(false);
  const handsFree = useRef(false);
  const lastRef = useRef<string[]>([]); // the field(s) most recently recorded: what "no, 31.2", "redo" and "confirm" refer to
  useEffect(() => () => { handsFree.current = false; stopRef.current(); }, []);
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
    lastRef.current = Object.keys(values);
  };
  // The picture itself when a camera is there to take it (no tap needed once it's allowed); otherwise just the time.
  const takePhoto = async () => {
    const at = nowIso();
    const src = mode === "script" ? undefined : await snap();
    editRun((x) => ({ ...x, photo: { at, src } }));
  };
  const addNote = (sid: string, text: string, by: Note["by"]) => {
    const t = text.trim().replace(/^./, (ch) => ch.toUpperCase());
    if (t) editRun((x) => ({ ...x, notes: { ...x.notes, [sid]: [...(x.notes?.[sid] ?? []), { text: t, at: nowIso(), by }] } }));
  };
  const skipTimer = (st: BenchStep) => editRun((x) => ({ ...x, skipped: { ...x.skipped, [st.id]: nowIso() } }));
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
    // A step with a timer: the first thing said is "start".
    if (!rerecord && st.timer_min && !run.timers[st.id] && !run.skipped?.[st.id]) { setHeard("Start."); return startTimer(st); }
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
    const said = text.trim();
    const named = stepNamed(text);
    const st = rerecord ? stepOfField(rerecord) : named && proto.steps[named - 1] ? proto.steps[named - 1] : proto.steps[c.done ? proto.steps.length - 1 : c.current];
    if (!st) return;
    setHeard(text);
    setMissed(false);
    // "Note: foamed more than usual" is words about the step, never values, whatever numbers are in it.
    // ("Step 1 note, the bottle was nearly empty" puts it on that step.)
    const note = said.replace(/^(?:for\s+|on\s+)?step\s+\w+[\s,:.-]*/i, "").match(/^(?:note|notes|comment|observation|remark)(?:\s+that)?[\s:,.-]+(.+)$/i);
    if (note) return addNote(st.id, note[1], "voice");
    const last = lastRef.current, all = proto.steps.flatMap((x) => x.fields);
    const CORRECT = /^(?:no|nope|sorry|scratch that|i mean|actually|correction|make that|wait)\b/i;
    // "No, 31.2": a correction to what was just recorded, even if that finished its step and the next one is open.
    if (!rerecord && last.length && CORRECT.test(said) && /\d/.test(wordsToDigits(said))) {
      const fixed = parseUtterance(said, all.filter((f) => last.includes(f.id))).values;
      if (Object.keys(fixed).length) return record(fixed, "voice");
    }
    // "Redo" / "wrong": take the last value back and wait for it again.
    if (!rerecord && last.length && /^(?:redo|undo|wrong|scratch that|delete that|no|nope)\W*$/i.test(said)) return redo(last[last.length - 1]);
    // "Confirm" / "yes" / "correct": every value still waiting for its ✓.
    const waiting = all.filter((f) => run.entries[f.id] && !run.entries[f.id].ok).map((f) => f.id);
    if (waiting.length && /^(?:confirm(?:ed)?|yes|yep|yeah|correct|that'?s right|right|looks good|good|ok|okay)\W*$/i.test(said))
      return editRun((x) => ({ ...x, entries: { ...x.entries, ...Object.fromEntries(waiting.map((id) => [id, { ...x.entries[id], ok: true }])) } }));
    if (st.timer_min && !run.timers[st.id] && /\b(?:skip|no)\b.*\btimer\b/i.test(said)) return skipTimer(st);
    if (c.done && !rerecord) return setMissed(true); // the trial is finished: nothing new is recorded by voice
    if (st.timer_min && /\bstart(ed)?\b/i.test(text) && !run.timers[st.id]) return startTimer(st);
    if (/\bstop(ped)?\b/i.test(text) && run.timers[st.id] && !run.timers[st.id].stop) return stopTimer(st);
    const { values, photo } = parseUtterance(text, rerecord ? st.fields.filter((f) => f.id === rerecord) : st.fields);
    const finished = !st.fields.length && !st.photo && /\b(done|next|finished|complete|completed|check|okay|ok)\b/i.test(text);
    if (Object.keys(values).length) { record(values, "voice"); setRerecord(null); }
    if (photo && st.photo) takePhoto();
    if (finished) markDone(st.id);
    // Heard, but nothing in it to record: say so, and say what would work for this step.
    if (!Object.keys(values).length && !(photo && st.photo) && !finished) setMissed(true);
  };

  // What's heard is handled by the latest render's apply, however long ago listening began.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const playRef = useRef(playScript);
  playRef.current = playScript;
  const hear = () => {
    let fatal = false;
    setListening(true);
    stopRef.current = listenOnce({
      interim: setHeard,
      final: (t) => applyRef.current(t),
      error: (code) => { if (FATAL.has(code) || code === "unsupported") { fatal = true; handsFree.current = false; setLive(false); setMode("script"); } },
      end: () => {
        setListening(false);
        if (fatal) return playRef.current();
        // Still hands-free: listen for the next sentence (a pause or silence ends each one).
        if (handsFree.current) window.setTimeout(() => { if (handsFree.current && !document.hidden) hear(); }, 150);
      },
    });
  };
  const stopListening = () => { handsFree.current = false; setLive(false); stopRef.current(); setListening(false); };
  /** The microphone button (or the space bar): play the script, or turn hands-free listening on and off. */
  const listen = () => {
    if (mode === "script") { if (!listening && !(c.done && !rerecord)) playScript(); return; }
    if (live) return stopListening();
    handsFree.current = true;
    setLive(true);
    setHeard(null);
    setMissed(false);
    hear();
  };
  // Coming back to the tab picks hands-free listening up again.
  useEffect(() => {
    const back = () => { if (!document.hidden && handsFree.current && !listening) hear(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  });
  // The trial's end is stamped once, when its last step completes.
  useEffect(() => { if (c.done && !run.finished) editRun((x) => ({ ...x, finished: nowIso() })); }, [c.done]); // eslint-disable-line react-hooks/exhaustive-deps
  // A running timer shows in the tab's title, so it can be read from another tab or across the room.
  useEffect(() => {
    const [sid, t] = running[0] ?? [];
    const st = sid ? proto.steps.find((x) => x.id === sid) : undefined;
    if (!st?.timer_min || !t) return;
    const left = st.timer_min * 60_000 - (Date.now() - new Date(t.start).getTime());
    document.title = `${left <= 0 ? "Done" : mmss(left)} · ${st.title}`;
    return () => { document.title = "Common Bench"; };
  });

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
    if (!t) return run.skipped?.[st.id]
      ? <p className="cb-label timer-skipped">Timer skipped {clock(run.skipped[st.id])}</p>
      : <div className="timer-row"><button className="cb-btn timer-start" onClick={() => startTimer(st)}>Start {mmss(st.timer_min * 60_000)}</button><button className="cb-link" onClick={() => skipTimer(st)}>Skip timer</button></div>;
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
                {(now || run.timers[st.id] || run.skipped?.[st.id]) && timerRow(st)}
                {(now || did) && st.fields.map(fieldRow)}
                {now && !st.fields.length && !st.photo && <button className="cb-btn primary step-done" onClick={() => markDone(st.id)}>Done</button>}
                {(run.notes?.[st.id] ?? []).map((n, k) => <p key={k} className="rnote"><span className="mono muted">{clock(n.at)}</span>{n.text}</p>)}
                {now && <NoteBox onAdd={(t) => addNote(st.id, t, "typed")} />}
                {st.photo && run.photo && (
                  <figure className="bphoto">
                    {run.photo.src ? <img src={run.photo.src} alt={`Photo, ${st.title}`} width={260} /> : <PlatePhoto dogbones={6} bars={3} width={260} />}
                    <figcaption className="cb-label">{proto.title} · Trial {run.name} · {run.operator || personById(proto.runner).name} · {clock(run.photo.at)}</figcaption>
                  </figure>
                )}
              </li>
            );
          })}
        </ol>

        <footer className="run-mic">
          {heard && (
            <p className={`heard ${missed ? "missed" : ""}`} aria-live="polite">“{heard}”
              {missed && !listening && <span className="cb-label">Not recorded · say {sayHint(step)}</span>}
            </p>
          )}
          {c.done ? (
            <Finish proto={proto} run={run} onNew={() => { stopListening(); newRun(); go(`/sops/${base.id}`); }} onDone={() => { stopListening(); go(`/sops/${base.id}`); }} />
          ) : (
            <div className="mic-row">
              <span className="mic-side" />
              <button className={`mic ${listening || live ? "on" : ""}`} aria-label={live ? "Stop listening" : "Speak"} aria-pressed={live} onClick={listen}>
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

/** One line about the step, typed. (Spoken: "note, foamed more than usual".) */
function NoteBox({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <input className="rnote-in" value={text} placeholder="Note" aria-label="Note on this step" onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { onAdd(text); setText(""); } }} onBlur={() => { if (text.trim()) { onAdd(text); setText(""); } }} />
  );
}

/** The end of a trial: what was recorded, what still needs a look, and what to put away before leaving the bench. */
function Finish({ proto, run, onNew, onDone }: { proto: BenchProtocol; run: ReturnType<typeof useBench>["run"]; onNew: () => void; onDone: () => void }) {
  const s = summarize(proto, run);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const away = uniq(proto.steps.flatMap((x) => x.put)).map((id) => lab.consumables.find((k) => k.id === id)?.name).filter(Boolean);
  const used = uniq(proto.steps.map((x) => x.instrument)).map((id) => lab.instruments.find((i) => i.id === id)?.name).filter(Boolean);
  return (
    <div className="finish" role="status">
      <p className="finish-line mono">
        <b>Trial {run.name || "—"}</b>{run.operator && <span>{run.operator}</span>}{s.minutes > 0 && <span>{s.minutes} min</span>}
        <span>{s.recorded}/{s.total} values</span>{s.notes > 0 && <span>{s.notes} note{s.notes === 1 ? "" : "s"}</span>}{s.skipped > 0 && <span>{s.skipped} timer{s.skipped === 1 ? "" : "s"} skipped</span>}
      </p>
      {s.off.length > 0 && <p className="finish-flag">Off target: {s.off.map((f) => f.label).join(", ")}</p>}
      {s.unconfirmed.length > 0 && <p className="finish-flag">Not confirmed: {s.unconfirmed.map((f) => f.label).join(", ")}</p>}
      {away.length > 0 && <p className="finish-away"><span className="cb-label">Put back</span>{away.join(" · ")}</p>}
      {used.length > 0 && <p className="finish-away"><span className="cb-label">Clean and free</span>{used.join(" · ")}</p>}
      <div className="finish-actions">
        <button className="cb-btn ghost" onClick={onNew}>New trial</button>
        <button className="cb-btn primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

/** What to say for a step, in its own terms: “Speed 3000, Time 2”, “photo”, “start” or “done”. */
function sayHint(st: BenchStep): string {
  if (st.fields.length) return `“${st.fields.slice(0, 2).map((f) => `${f.label.toLowerCase()} ${f.formula.match(/^\d*\.?\d+$/) ? f.formula : "…"}`).join(", ")}”`;
  return st.photo ? "“photo”" : st.timer_min ? "“start” or “done”" : "“done”";
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
        onBlur={commit} onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Enter records this value and moves to the next empty box (which may be in the step that just opened).
          const here = e.target as HTMLInputElement;
          here.blur();
          window.setTimeout(() => { [...document.querySelectorAll<HTMLInputElement>(".bvalue input")].find((x) => x !== here && x.value === "")?.focus(); }, 60);
        }} />
      <span className="mono unit">{unit}</span>
    </span>
  );
}
