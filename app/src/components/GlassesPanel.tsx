// Glasses in a trial: what the glasses see, a record button, and the log that builds itself while you work.
// Camera lines are the model's reading of the video, so each one waits for a ✓ (or ✕ to throw it out).
// What you say goes to the trial's own fields through the same parse as the microphone button.
import { useEffect, useRef, useState } from "react";
import type { BenchProtocol } from "../shared/types.ts";
import type { GlassesContext, GlassesEvent, GlassesMark } from "../shared/glasses.ts";
import { glasses, useGlasses } from "../lib/glasses.ts";
import { answer, confirmation, spoken } from "../lib/glassesAsk.ts";
import { TOLERANCE, compute, offBy, outsideAccept, type RunState } from "../lib/benchRun.ts";
import "./glasses.css";

const hms = (iso: string) => new Date(iso).toTimeString().slice(0, 8);
const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

const Icon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="6.5" cy="13" r="3.5" /><circle cx="17.5" cy="13" r="3.5" /><path d="M10 13h4M3 13l1.5-5M21 13l-1.5-5" />
  </svg>
);

export function GlassesPanel({ proto, run, trial, current, onHeard, onInterim }: {
  proto: BenchProtocol;
  run: RunState;
  trial: string;
  current: number | null; // the step the trial is on, or null when it's finished
  onHeard: (text: string) => void;
  onInterim: (text: string) => void;
}) {
  // A question ("what's next?", "how much paprika?") is answered out loud and goes no further; anything else is
  // the trial's to record, exactly as if it had come from the microphone button.
  const trialNow = useRef({ proto, run });
  trialNow.current = { proto, run };
  const lastReply = useRef<string | null>(null);
  const reply = (text: string) => { lastReply.current = text; void glasses.say(text); };
  const state = useGlasses({
    heard: (text) => {
      const a = answer(text, trialNow.current.proto, trialNow.current.run, lastReply.current);
      if (a) { onInterim(text); reply(a); } else onHeard(text);
    },
    interim: onInterim,
  });
  const [open, setOpen] = useState(false);
  const [finished, setFinished] = useState<string | null>(null); // the recording that just ended, for Delete
  const [, tick] = useState(0);
  const rec = state?.recording ?? null;
  const connected = state?.device.connected ?? false;

  const context: GlassesContext = { sop: proto.title, trial, steps: proto.steps.map((s) => ({ title: s.title, detail: s.detail })), current, protocol: proto, params: run.params, operator: run.operator,
    plan: Object.fromEntries(Object.entries(compute(proto, run).target).map(([k, v]) => [k, Number.isFinite(v) ? v : null])) };
  const latest = useRef(context);
  latest.current = context;

  // Open by itself the first time the glasses show up or a recording is running; after that it stays as you left it.
  const shown = useRef(false);
  useEffect(() => { if ((connected || rec) && !shown.current) { shown.current = true; setOpen(true); } }, [connected, rec]);
  // The camera log follows the trial: tell it the SOP when a recording starts and each time the step changes.
  useEffect(() => { if (rec) void glasses.context(latest.current); }, [rec?.id, current, proto, trial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!rec) return; const id = window.setInterval(() => tick((x) => x + 1), 1000); return () => window.clearInterval(id); }, [rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rec) setFinished(rec.id); }, [rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A value recorded by voice during a recording is said back, with what comes next: no need to look at the screen.
  const said = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const sig = (id: string) => `${run.entries[id].value}@${run.entries[id].at}`;
    if (!said.current) { said.current = new Map(Object.keys(run.entries).map((id) => [id, sig(id)])); return; } // what was there on opening stays quiet
    const fresh = Object.keys(run.entries).filter((id) => said.current!.get(id) !== sig(id));
    said.current = new Map(Object.keys(run.entries).map((id) => [id, sig(id)]));
    const byVoice = fresh.filter((id) => run.entries[id].by === "voice" && Date.now() - new Date(run.entries[id].at).getTime() < 5000);
    if (!rec || !fresh.length) return;
    const fields = proto.steps.flatMap((x) => x.fields);
    // Every amount recorded during a recording goes in its log (however it was entered), for the replay.
    const c = compute(proto, run);
    for (const id of fresh) {
      const f = fields.find((x) => x.id === id), e = run.entries[id];
      if (!f) continue;
      const target = Number.isFinite(c.target[id]) ? c.target[id] : null, off = offBy(e.value, c.target[id]);
      void glasses.value({ step: proto.steps.findIndex((st) => st.fields.some((x) => x.id === id)), label: f.label, value: e.value, unit: f.unit, target, off: off !== null && Math.abs(off) > TOLERANCE ? Math.round(off * 100) : null, by: e.by });
    }
    if (!byVoice.length) return;
    const earlier = byVoice.slice(0, -1).map((id) => { const f = fields.find((x) => x.id === id); return f ? `${f.label}, ${spoken(run.entries[id].value, f.unit)}.` : ""; });
    const last = confirmation(byVoice[byVoice.length - 1], proto, run);
    if (last) reply([...earlier, last].filter(Boolean).join(" "));
  }, [run.entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // A value that was held for being outside the SOP's acceptance, then accepted: say so, and what comes next.
  const oks = useRef<Map<string, boolean> | null>(null);
  useEffect(() => {
    const before = oks.current;
    oks.current = new Map(Object.entries(run.entries).map(([id, e]) => [id, e.ok]));
    if (!before || !rec) return;
    const c = compute(proto, run);
    const accepted = Object.entries(run.entries).filter(([id, e]) => e.ok && before.get(id) === false && outsideAccept(proto, e.value, c.target[id])).map(([id]) => id);
    const last = accepted.length ? confirmation(accepted[accepted.length - 1], proto, run) : null;
    if (last) reply(`Accepted. ${last}`);
  }, [run.entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timers, notes, the photo, steps marked done and skipped timers go in the recording's log too, each once.
  const marked = useRef<Set<string> | null>(null);
  useEffect(() => {
    const idx = (sid: string) => proto.steps.findIndex((st) => st.id === sid);
    const title = (sid: string) => proto.steps[idx(sid)]?.title ?? sid;
    const all: [string, GlassesMark][] = [
      ...Object.entries(run.timers).flatMap(([sid, t]): [string, GlassesMark][] => [
        [`ts:${sid}@${t.start}`, { kind: "timer_start", step: idx(sid), text: `Timer started: ${title(sid)}`, at: t.start }],
        ...(t.stop ? [[`tp:${sid}@${t.stop}`, { kind: "timer_stop", step: idx(sid), text: `Timer stopped: ${title(sid)}`, at: t.stop }] as [string, GlassesMark]] : []),
      ]),
      ...Object.entries(run.notes ?? {}).flatMap(([sid, ns]) => ns.map((n): [string, GlassesMark] => [`n:${sid}@${n.at}`, { kind: "note", step: idx(sid), text: n.text, at: n.at }])),
      ...Object.entries(run.done).map(([sid, at]): [string, GlassesMark] => [`d:${sid}@${at}`, { kind: "done", step: idx(sid), text: `Done: ${title(sid)}`, at }]),
      ...Object.entries(run.skipped ?? {}).map(([sid, at]): [string, GlassesMark] => [`s:${sid}@${at}`, { kind: "skip", step: idx(sid), text: `Timer skipped: ${title(sid)}`, at }]),
      ...(run.photo ? [[`p@${run.photo.at}`, { kind: "photo", step: proto.steps.findIndex((st) => st.photo), text: "Photo taken", at: run.photo.at }] as [string, GlassesMark]] : []),
    ];
    const first = !marked.current;
    marked.current ??= new Set();
    for (const [key, m] of all) {
      if (marked.current.has(key)) continue;
      marked.current.add(key);
      if (!first && rec) void glasses.mark(m); // what was there on opening stays quiet
    }
  }, [run.timers, run.notes, run.done, run.skipped, run.photo]); // eslint-disable-line react-hooks/exhaustive-deps
  // The trial as it stands is kept beside the recording (without the photo itself), so the two can be read together later.
  useEffect(() => { if (rec) void glasses.trial({ ...run, photo: run.photo ? { at: run.photo.at } : null, pinned: run.pinned ? { n: run.pinned.n } : null }); }, [rec?.id, run]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;

  const status = rec ? `Recording ${mmss(Date.now() - new Date(rec.started).getTime())}` : connected ? "Ready" : "Not connected";
  const lines = state.log.filter((e) => e.source === "camera" || e.source === "voice" || e.source === "reply").slice(-5);
  const note = !state.media ? "Video needs mediamtx and ffmpeg on this computer."
    : !connected && !rec ? "Open Common Bench in the Mentra app on your phone."
    : rec && state.video !== "live" ? "Waiting for the glasses’ camera."
    : rec && state.observer !== "on" ? "Recording video and voice; the camera log is off."
    : null;

  return (
    <aside className={`gls ${open ? "open" : ""}`} aria-label="Glasses">
      <button className={`cb-round sm gls-toggle ${rec ? "rec" : connected ? "on" : ""}`} aria-label="Glasses" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon />
      </button>
      {open && (
        <div className="gls-card">
          <header className="gls-head">
            <span className="cb-label">Glasses</span>
            <span className={`mono gls-status ${rec ? "rec" : ""}`}>{status}</span>
            {connected && state.device.battery != null && <span className="mono muted">{Math.round(state.device.battery)}%</span>}
          </header>

          {rec && state.video === "live" && <img className="gls-video" src={`/api/glasses/live.mjpg?r=${rec.id}`} alt="What the glasses see" />}
          {note && <p className="gls-note">{note}</p>}

          {lines.length > 0 && (
            <ol className="gls-log">
              {lines.map((e) => <LogLine key={e.id} e={e} live={Boolean(rec)} />)}
            </ol>
          )}

          <footer className="gls-foot">
            {rec
              ? <button className="cb-btn" onClick={() => void glasses.stop()}>Stop</button>
              : <button className="cb-btn primary" disabled={!connected || !state.media} onClick={() => { setFinished(null); void glasses.start(latest.current); }}>Record</button>}
            {!rec && finished && <a className="cb-link" href={`/api/glasses/replay/${finished}`} target="_blank" rel="noreferrer">Replay</a>}
            {!rec && finished && (
              <button className="cb-link" onClick={() => { if (window.confirm("Delete this recording? Its video, frames and log are removed for good.")) { void glasses.deleteRecording(finished); setFinished(null); } }}>
                Delete recording
              </button>
            )}
          </footer>
        </div>
      )}
    </aside>
  );
}

function LogLine({ e, live }: { e: GlassesEvent; live: boolean }) {
  const guess = e.source === "camera" && !e.ok;
  return (
    <li className={`gls-line ${e.source} ${guess ? "guess" : ""}`}>
      <span className="mono muted">{hms(e.at)}</span>
      <span className="gls-text">
        {e.source === "voice" ? `“${e.text}”` : e.source === "reply" ? `→ ${e.text}` : e.text}
        {e.source === "camera" && e.step != null && <span className="mono muted"> · step {e.step}</span>}
      </span>
      {guess && live && (
        <span className="gls-marks">
          <button aria-label={`Confirm: ${e.text}`} onClick={() => void glasses.confirm(e.id)}>✓</button>
          <button aria-label={`Remove: ${e.text}`} onClick={() => void glasses.remove(e.id)}>✕</button>
        </span>
      )}
    </li>
  );
}
