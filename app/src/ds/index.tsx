// Common Bench design-system components, "technical atlas": hairline rules, ink type, drawn marks instead of color.
// Styles: ds.css (cb-*), values: tokens.css. Text budgets: titles ≤ 8 words, labels ≤ 3, one sentence per panel.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LabSource, PersonId } from "../shared/types.ts";
import { personById } from "../data/notebook.ts";

export function Avatar({ id, you, size, title }: { id: PersonId; you?: boolean; size?: "sm" | "lg"; title?: string }) {
  const p = personById(id);
  return (
    <span className={`cb-av ${id} ${you ? "you" : ""} ${size ?? ""}`} title={title ?? `${p.name}${you ? " (you)" : ""}`}>
      {p.initials}
    </span>
  );
}

/** A people stack: the signed-in person first, ringed. */
export function People({ ids, me, size }: { ids: PersonId[]; me: PersonId; size?: "sm" }) {
  const sorted = [...ids].sort((a, b) => Number(b === me) - Number(a === me));
  return <span className="cb-people">{sorted.map((id) => <Avatar key={id} id={id} you={id === me} size={size} />)}</span>;
}

/** Not built yet: a quiet dotted-underline tag. The control stays clickable and explains itself. */
export const Later = () => <span className="cb-later">later</span>;

/** "Differs from the SOP": a revision triangle, as on an engineering drawing. Drawn, never colored. */
export function Delta({ size = 14, title = "Differs from SOP" }: { size?: number; title?: string }) {
  return (
    <svg className="cb-delta" width={size} height={Math.round(size * 0.9)} viewBox="0 0 16 14" role="img" aria-label={title}>
      <title>{title}</title>
      <path d="M8 1 15 13H1Z" />
    </svg>
  );
}

/** How an instrument is logged: filled = logs itself, half = by hand, empty = not logged. Ink only. */
export function LogSquare({ source }: { source: LabSource | "derived" }) {
  const k = source === "mhs" || source === "camera" || source === "derived" ? "self" : source === "manual" ? "hand" : "none";
  return <i className={`cb-log ${k}`} aria-hidden="true" />;
}
export const SOURCE_TEXT: Record<LabSource | "derived", string> = {
  mhs: "Logs itself", camera: "Camera", manual: "By hand", none: "Not logged", derived: "From timestamps",
};

export function Label({ children, as: As = "span" }: { children: ReactNode; as?: "span" | "h2" | "h3" | "p" }) {
  return <As className="cb-label">{children}</As>;
}

/** The scoped Ask box. It sits at the top of every right panel. */
export function AskBox({ scope, onClearScope, placeholder = "Has anyone tried…?", suggestions = [], onAsk, busy, draft }: {
  scope: string;
  onClearScope?: () => void;
  placeholder?: string;
  suggestions?: { label: string; question: string }[];
  onAsk: (question: string) => void;
  busy?: boolean;
  draft?: { text: string; nonce: number } | null; // set from outside, e.g. the Book button
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!draft) return;
    setQ(draft.text);
    ref.current?.focus();
  }, [draft]);
  const send = (text: string) => { if (text.trim() && !busy) { onAsk(text.trim()); setQ(""); } };
  return (
    <form className="cb-ask" onSubmit={(e) => { e.preventDefault(); send(q); }}>
      <div className="cb-ask-head">
        <label className="h3" htmlFor={`ask-${scope}`}>Ask</label>
        <span className="cb-scope">{scope}{onClearScope && <button type="button" onClick={onClearScope} aria-label="Ask about everything">×</button>}</span>
      </div>
      <div className="cb-ask-row">
        <textarea id={`ask-${scope}`} ref={ref} value={q} rows={2} placeholder={placeholder} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(q); } }} />
        <button className="cb-send" type="submit" disabled={busy} aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 15V3M4 8l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="cb-suggests">
          {suggestions.map((s) => <button key={s.label} type="button" className="cb-suggest" onClick={() => send(s.question)} title={s.question}>{s.label}</button>)}
        </div>
      )}
    </form>
  );
}

export function BackChip({ label, onBack }: { label: string; onBack: () => void }) {
  return <button className="cb-back" onClick={onBack}>← Back to {label}</button>;
}

export const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M13 13l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** The brand mark: one isometric resin block with a UV face. */
export const BrandMark = () => (
  <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
    <path d="M15 3 27 9.5 15 16 3 9.5Z" fill="#fff" stroke="var(--ink)" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M3 9.5V20.5L15 27V16M27 9.5V20.5L15 27" fill="var(--resin)" stroke="var(--ink)" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M15 16 27 9.5V20.5L15 27Z" fill="var(--uv)" fillOpacity=".55" />
  </svg>
);

export const DocIcon = () => (
  <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true"><path d="M1 1h9l5 5v13H1Z M10 1v5h5" fill="none" stroke="var(--ink-3)" /></svg>
);

export const FlagIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"><path d="M3 13V1.5M3 2h8l-2 3 2 3H3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
);
