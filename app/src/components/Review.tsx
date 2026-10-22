// Flag for review: double-click a trial, a step or a chart point (or use the flag button) to send that exact view
// to a teammate with a note. The flag carries the path and selection, so opening it restores what you saw.
// The recording that would travel with it is roadmap (issue #6).
import { useEffect, useState } from "react";
import type { PersonId } from "../shared/types.ts";
import { people, personById, project } from "../data/notebook.ts";
import { ME } from "../lib/org.ts";
import { useFuture, useGo } from "../lib/nav.tsx";
import { useStore, type Flag, type FlagTarget, type Selection } from "../state/store.tsx";
import { Avatar, FlagIcon, Later } from "../ds/index.tsx";

/** Open the flag dialog for something on this screen. */
export function useFlag() {
  const { dispatch } = useStore();
  return (t: { kind: FlagTarget["kind"]; label: string; sel: Selection }) =>
    dispatch({ type: "flagging", target: { ...t, path: window.location.pathname } });
}

export function FlagDialog() {
  const { state, dispatch } = useStore();
  const future = useFuture();
  const others = people.filter((p) => p.id !== ME);
  const [to, setTo] = useState<PersonId>(others[0].id);
  const [note, setNote] = useState("");
  const target = state.flagging;
  useEffect(() => { setNote(""); }, [target]);
  if (!target) return null;
  const close = () => dispatch({ type: "flagging", target: null });
  const send = () => {
    const flag: Flag = { id: `F${state.flags.length + 1}`, target, from: ME, to, note: note.trim(), at: project.now };
    dispatch({ type: "flag", flag });
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <form className="sheet flag-sheet" role="dialog" aria-label={`Flag ${target.label} for review`} onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div className="pn-row"><h2 className="h2 with-icon"><FlagIcon size={18} />Review {target.label}</h2><button type="button" className="cb-round sm" aria-label="Close" onClick={close}>×</button></div>
        <div className="flag-to">
          <span className="cb-label">To</span>
          {others.map((p) => (
            <button key={p.id} type="button" className={`who ${to === p.id ? "on" : ""}`} aria-pressed={to === p.id} onClick={() => setTo(p.id)}>
              <Avatar id={p.id} size="sm" />{p.name.split(" ")[0]}
            </button>
          ))}
        </div>
        <textarea autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should they look at?" aria-label="Note" />
        <div className="pn-row">
          <button type="button" className="cb-btn ghost" onClick={() => future("record")}>Record a clip<Later /></button>
          <button type="submit" className="cb-btn primary">Send</button>
        </div>
      </form>
    </div>
  );
}

/** A short confirmation after sending, and the recipient's view in the account menu. */
export function FlagToast() {
  const { state } = useStore();
  const last = state.flags.at(-1);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!last) return;
    setShown(last.id);
    const t = setTimeout(() => setShown(null), 3200);
    return () => clearTimeout(t);
  }, [last]);
  if (!last || shown !== last.id) return null;
  return <div className="toast" role="status"><FlagIcon />Sent {last.target.label} to {personById(last.to).name.split(" ")[0]}</div>;
}

export function ReviewList({ onOpen }: { onOpen?: () => void }) {
  const { state, dispatch } = useStore();
  const go = useGo();
  if (!state.flags.length) return <p className="cb-label pad">Nothing flagged yet. Double-click a trial or step.</p>;
  return (
    <div className="review-list">
      {state.flags.map((f) => (
        <button key={f.id} className="review-item" onClick={() => { onOpen?.(); dispatch({ type: "flagging", target: null }); go(f.target.path, f.target.sel); }}>
          <Avatar id={f.to} size="sm" />
          <span><b className="mono">{f.target.label}</b>{f.note && <span className="muted"> · {f.note}</span>}</span>
        </button>
      ))}
    </div>
  );
}

/** Flags on one trial, shown in its panel. */
export function FlagsOn({ trial }: { trial: string }) {
  const { state } = useStore();
  const mine = state.flags.filter((f) => f.target.sel.trial === trial);
  if (!mine.length) return null;
  return (
    <div className="flags-on">
      {mine.map((f) => (
        <div key={f.id} className="flag-line"><FlagIcon /><span>{f.target.label} → {personById(f.to).name.split(" ")[0]}{f.note ? `: ${f.note}` : ""}</span></div>
      ))}
    </div>
  );
}
