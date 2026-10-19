// Common Bench design-system components. Styles: ds.css (cb-*), values: tokens.css. Text budgets live in the
// design system's README: titles ≤ 8 words, labels ≤ 3, one sentence per panel.
import { useState, type ReactNode } from "react";
import type { LabSource, PersonId } from "../shared/types.ts";
import { personById } from "../data/notebook.ts";

export function Avatar({ id, you, dim, title }: { id: PersonId; you?: boolean; dim?: boolean; title?: string }) {
  const p = personById(id);
  return (
    <span className={`cb-av ${id} ${you ? "you" : ""} ${dim ? "dim" : ""}`} title={title ?? `${p.name}${you ? " (you)" : ""}`}>
      {p.initials}
    </span>
  );
}

/** A people stack: the signed-in person first with a ring, everyone else dimmed. */
export function People({ ids, me }: { ids: PersonId[]; me: PersonId }) {
  const sorted = [...ids].sort((a, b) => Number(b === me) - Number(a === me));
  return <span className="cb-people">{sorted.map((id) => <Avatar key={id} id={id} you={id === me} dim={id !== me} />)}</span>;
}

export const Future = () => <span className="cb-future">future</span>;
export const Unusual = ({ children = "outlier" }: { children?: ReactNode }) => <span className="cb-unusual">{children}</span>;

export function Lens({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: ReactNode }) {
  return <button className={`cb-lens ${on ? "on" : ""}`} aria-pressed={on} onClick={onToggle}>{children}</button>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="cb-eyebrow">{children}</p>;
}

export function ProjectCard({ title, meta, people, me, onOpen }: { title: string; meta?: string; people: PersonId[]; me: PersonId; onOpen: () => void }) {
  return (
    <button className="cb-card" onClick={onOpen}>
      {meta && <span className="meta">{meta}</span>}
      <span className="title">{title}</span>
      <People ids={people} me={me} />
    </button>
  );
}

export function NewCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="cb-card new" onClick={onClick}>
      <span className="plus" aria-hidden="true">+</span>
      {label}
    </button>
  );
}

export function ProjectRow({ title, people, me, onOpen }: { title: string; people: PersonId[]; me: PersonId; onOpen: () => void }) {
  return (
    <button className="cb-prow" onClick={onOpen}>
      <span className="title">{title}</span>
      <People ids={people} me={me} />
    </button>
  );
}

/** The scoped question box that ends every right panel. A suggestion's label can be shorter than the question it sends. */
export function AskBox({ scope, onWiden, suggestions, onAsk, busy }: {
  scope: string;
  onWiden?: () => void;
  suggestions: { label: string; question: string }[];
  onAsk: (question: string) => void;
  busy?: boolean;
}) {
  const [q, setQ] = useState("");
  const send = (text: string) => text.trim() && !busy && onAsk(text.trim());
  return (
    <div className="cb-ask">
      <span className="cb-scope">
        Asking about {scope}
        {onWiden && <button onClick={onWiden} aria-label="Widen the question">✕</button>}
      </span>
      <form className="field" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Has anyone tried…" aria-label="Question" />
        <button className="cb-btn" type="submit" disabled={busy}>Ask</button>
      </form>
      {suggestions.map((s) => (
        <button key={s.label} className="cb-suggest" onClick={() => send(s.question)} title={s.question}>{s.label}</button>
      ))}
    </div>
  );
}

export interface StepTile {
  id: string;
  label: string;
  value: string;
  source: LabSource | "derived";
  dev?: boolean; // differs from the SOP: dashed outline
}

const SRC_CLASS: Record<StepTile["source"], string> = { mhs: "auto", camera: "auto", manual: "hand", none: "none", derived: "derived" };
export const SOURCE_TEXT: Record<StepTile["source"], string> = {
  mhs: "Logs itself", camera: "Camera", manual: "By hand", none: "Not logged", derived: "From timestamps",
};

export function StepTiles({ steps, selected, onSelect }: { steps: StepTile[]; selected: string | null; onSelect: (id: string | null) => void }) {
  return (
    <div className="cb-steps">
      {steps.map((s) => (
        <button key={s.id} className={`cb-step ${s.dev ? "dev" : ""}`} aria-pressed={selected === s.id}
          onClick={() => onSelect(selected === s.id ? null : s.id)} title={`${s.label}: ${SOURCE_TEXT[s.source]}`}>
          <b><i className={`cb-src ${SRC_CLASS[s.source]}`} />{s.label}</b>
          <span>{s.value}</span>
        </button>
      ))}
    </div>
  );
}

export function SourceSquare({ source }: { source: StepTile["source"] }) {
  return <i className={`cb-src ${SRC_CLASS[source]}`} aria-hidden="true" />;
}

export function BackChip({ label, onBack }: { label: string; onBack: () => void }) {
  return <button className="cb-back back-chip" onClick={onBack}>← Back to {label}</button>;
}

export const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" />
  </svg>
);
