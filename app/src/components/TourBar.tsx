// The guide: one question per step. Each step reveals more of the screen and triggers its action.
import { useEffect, useRef } from "react";
import { navigate, usePath } from "../lib/hooks.ts";
import { useStore } from "../state/store.tsx";
import { HERO_QUESTION } from "./AgentPanel.tsx";
import { TOUR, markGuideSeen } from "./tour.ts";

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });

export function TourBar() {
  const { state, dispatch, askQuestion, decide } = useStore();
  const path = usePath();
  const step = state.tour;
  const ran = useRef<Set<string>>(new Set());
  const a = state.ask;

  // One-shot action when a step is entered.
  useEffect(() => {
    if (step === null) {
      ran.current.clear();
      markGuideSeen();
      return;
    }
    const s = TOUR[step];
    if (s.action !== "evals" && window.location.pathname !== "/") navigate("/");
    switch (s.action) {
      case "intro":
        dispatch({ type: "focus", id: null });
        break;
      case "replay":
        dispatch({ type: "replay/start" });
        break;
      case "ask":
        if (a.status === "idle" || a.question !== HERO_QUESTION) askQuestion(HERO_QUESTION, { cached: true });
        break;
      case "evidence":
        if (a.status === "idle") askQuestion(HERO_QUESTION, { cached: true });
        dispatch({ type: "focus", id: "T09" });
        break;
      case "approve":
        if (a.status === "idle") askQuestion(HERO_QUESTION, { cached: true });
        dispatch({ type: "focus", id: null });
        break;
      case "evals":
        navigate("/evals");
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Actions that wait for streamed content to arrive.
  useEffect(() => {
    if (step === null) return;
    const s = TOUR[step];
    if (s.action === "evidence" && a.diff && !ran.current.has(`diff-${step}`)) {
      ran.current.add(`diff-${step}`);
      setTimeout(() => scrollTo("diff-section"), 150);
    }
    if (s.action === "approve") {
      const pending = [a.ledgerProposal, a.draftProposal].filter((p) => p && p.status === "pending");
      if (a.ledgerProposal && a.draftProposal && !ran.current.has(`approve-${step}`)) {
        ran.current.add(`approve-${step}`);
        setTimeout(() => scrollTo("approvals-section"), 100);
        // Give the viewer a beat to read the cards, then Shreya approves both.
        pending.forEach((p, i) => setTimeout(() => decide(p!.id, "approve"), 1600 + i * 700));
      }
    }
  }, [step, a.diff, a.ledgerProposal, a.draftProposal, decide]);

  if (step === null) return null;
  const s = TOUR[step];
  const last = step === TOUR.length - 1;
  const go = (n: number | null) => {
    if (n !== null && TOUR[n].action !== "evals" && path !== "/") navigate("/");
    dispatch({ type: "tour", step: n });
  };
  return (
    <div className="tourbar" role="dialog" aria-label="Tour">
      <span className="step">{step + 1}/{TOUR.length}</span>
      <span className="cap" key={step} style={{ animation: "fade-in 0.3s ease-out both" }}>
        <b>{s.title}</b> {s.caption}
      </span>
      <button className="btn small" onClick={() => go(step - 1)} disabled={step === 0}>Back</button>
      {last ? (
        <button className="btn small primary" onClick={() => go(null)}>Finish</button>
      ) : (
        <button className="btn small primary" onClick={() => go(step + 1)}>Next</button>
      )}
      <button className="btn small ghost" onClick={() => go(null)}>Show all</button>
    </div>
  );
}
