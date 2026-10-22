// Every right panel starts with the same Ask box, scoped to what the panel shows. Asking swaps the panel to the
// answer; the selection is kept underneath, so closing the answer returns to it. A panel can `intercept` a question
// it handles itself (the lab handles bookings) and render the result under the box.
import { useState, type ReactNode } from "react";
import { useStore } from "../state/store.tsx";
import { AskBox } from "../ds/index.tsx";
import { AgentPanel, HERO_QUESTION } from "./AgentPanel.tsx";

// Suggestions are short labels; the hero sends the exact recorded question, so it replays offline.
const SUGGESTIONS = {
  hero: { label: "Under 1.5 without new materials?", question: HERO_QUESTION },
} as const;
export type Suggestion = keyof typeof SUGGESTIONS | { label: string; question: string };

export function ScopedAsk({ scope, wideScope, placeholder, suggestions = [], intercept, draft, children }: {
  scope: string;
  wideScope?: string; // clearing the scope chip widens to this
  placeholder?: string;
  suggestions?: Suggestion[];
  intercept?: (question: string) => boolean;
  draft?: { text: string; nonce: number } | null;
  children: ReactNode;
}) {
  const { state, dispatch, askQuestion } = useStore();
  const [wide, setWide] = useState(false);
  const label = wide && wideScope ? wideScope : scope;
  const a = state.ask;
  const here = state.askScope === scope;
  if (state.askOpen && here && a.status !== "idle") {
    return (
      <div className="answer-view">
        <div className="pn-row">
          <button className="cb-link" onClick={() => dispatch({ type: "askOpen", open: false })}>← Back</button>
          <span className="cb-scope">{label}</span>
        </div>
        <p className="question">{a.question}</p>
        <AgentPanel bare />
      </div>
    );
  }
  return (
    <>
      <AskBox
        scope={label}
        onClearScope={wideScope && !wide ? () => setWide(true) : undefined}
        placeholder={placeholder}
        busy={a.status === "streaming"}
        draft={draft}
        suggestions={suggestions.map((s) => (typeof s === "string" ? SUGGESTIONS[s] : s))}
        onAsk={(q) => {
          if (intercept?.(q)) return;
          dispatch({ type: "askScope", scope });
          askQuestion(q);
        }}
      />
      {here && a.status !== "idle" && (
        <button className="cb-link answer-link" onClick={() => dispatch({ type: "askOpen", open: true })}>
          {a.status === "streaming" ? "Answer in progress →" : "Last answer →"}
        </button>
      )}
      {children}
    </>
  );
}
