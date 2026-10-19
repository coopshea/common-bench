// Every right panel ends with the same Ask box, scoped to what the panel shows. Asking swaps the panel to the answer;
// the selection is kept underneath, so closing the answer returns to it.
import type { ReactNode } from "react";
import { useStore } from "../state/store.tsx";
import { AskBox, Eyebrow } from "../ds/index.tsx";
import { AgentPanel, HERO_QUESTION } from "./AgentPanel.tsx";

// Suggestions are short labels; the hero sends the exact recorded question, so it replays offline.
const SUGGESTIONS = {
  hero: { label: "Under 1.5 without new materials?", question: HERO_QUESTION },
} as const;
export type Suggestion = keyof typeof SUGGESTIONS | { label: string; question: string };

export function ScopedAsk({ scope, wideScope, onWiden, suggestions = [], children }: {
  scope: string;
  wideScope?: string;
  onWiden?: () => void;
  suggestions?: Suggestion[];
  children: ReactNode;
}) {
  const { state, dispatch, askQuestion } = useStore();
  const a = state.ask;
  const here = state.askScope === scope;
  if (state.askOpen && here && a.status !== "idle") {
    return (
      <div className="answer-view">
        <div className="answer-head">
          <button className="cb-link" onClick={() => dispatch({ type: "askOpen", open: false })}>← Back</button>
          <span className="cb-scope">Asking about {wideScope ?? scope}</span>
        </div>
        <Eyebrow>Question</Eyebrow>
        <p className="question">{a.question}</p>
        <AgentPanel bare />
      </div>
    );
  }
  return (
    <>
      {children}
      {here && a.status !== "idle" && (
        <button className="cb-link answer-link" onClick={() => dispatch({ type: "askOpen", open: true })}>
          {a.status === "streaming" ? "Answer in progress →" : "Last answer →"}
        </button>
      )}
      <AskBox
        scope={scope}
        onWiden={onWiden}
        busy={a.status === "streaming"}
        suggestions={suggestions.map((s) => (typeof s === "string" ? SUGGESTIONS[s] : s))}
        onAsk={(q) => { dispatch({ type: "askScope", scope }); askQuestion(q); }}
      />
    </>
  );
}
