// Scenes 4–6: ask box, streamed "How I found this" trace, inline diff, cited answer, approval cards.
// Sections render in the order the agent produces them: investigation → evidence → answer → proposals.
import { useEffect, useRef, useState } from "react";
import type { TraceStep } from "../shared/types.ts";
import { personById } from "../data/notebook.ts";
import { useStore } from "../state/store.tsx";
import { Avatar, CitedText, Cite } from "./bits.tsx";
import { ProtocolDiffView } from "./ProtocolDiffView.tsx";
import { DraftApproval, LedgerApproval } from "./ApprovalCards.tsx";
import { TOUR, tourClass } from "./tour.ts";

// Shreya's question, verbatim from the brief.
export const HERO_QUESTION =
  "My best is 1.55 Pa·s. I want to order DiluentX ($1,800, 6 weeks) to get under 1.5. Has anyone tried something like this?";

const WRITE_TOOLS = new Set(["propose_ledger_update", "draft_trial"]);
const VERB: Record<string, string> = {
  search_trials: "searched trials", get_trial: "read trials", get_ledger: "read the ledger", get_log: "read device logs",
  diff_protocols: "diffed protocols", compare_groups: "compared groups", correlate: "checked a correlation",
};
const traceSummary = (steps: TraceStep[]) => {
  const verbs = [...new Set(steps.map((s) => (s.tool && VERB[s.tool]) || null).filter(Boolean))] as string[];
  return `${steps.length} tool call${steps.length === 1 ? "" : "s"}${verbs.length ? ": " + verbs.join(", ") : ""}`;
};

function TraceItem({ s }: { s: TraceStep }) {
  const waiting = s.status === "running" && !!s.tool && WRITE_TOOLS.has(s.tool);
  return (
    <li className={waiting ? "waiting" : s.status}>
      <span className="ic">{s.status === "done" ? "✓" : s.status === "error" ? "!" : ""}</span>
      <div className="tl">
        <span className="lab">{s.label}</span>
        {s.tool && <span className="tool">{s.tool}{WRITE_TOOLS.has(s.tool) ? " · needs approval" : ""}</span>}
      </div>
      {s.summary && <div className="sum">{s.summary}</div>}
      {s.citations && s.citations.length > 0 && (
        <div className="cites">{s.citations.map((id) => <Cite key={id} id={id} />)}</div>
      )}
    </li>
  );
}

/** `bare`: the answer only (no panel chrome, no ask box), for the right panel's answer view. */
export function AgentPanel({ bare = false }: { bare?: boolean } = {}) {
  const { state, askQuestion } = useStore();
  const a = state.ask;
  const [q, setQ] = useState(HERO_QUESTION);
  const [traceOpen, setTraceOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const asker = personById("shreya");
  const streaming = a.status === "streaming";
  const proposals = [a.ledgerProposal, a.draftProposal].filter(Boolean);
  const pending = proposals.filter((p) => p!.status === "pending").length;
  const readSteps = a.trace.filter((s) => !s.tool || !WRITE_TOOLS.has(s.tool));
  const traceCollapsed = a.answer.length > 0 && !traceOpen;

  // A new question starts with the investigation visible.
  useEffect(() => {
    if (a.status === "streaming" && a.trace.length === 0) setTraceOpen(false);
  }, [a.status, a.trace.length]);

  // Follow the investigation while it streams. When the answer starts, bring it to the top once and stop following.
  const answerStarted = a.answer.length > 0;
  useEffect(() => {
    const el = scrollRef.current;
    const tourAction = state.tour !== null ? TOUR[state.tour]?.action : null;
    if (!el || tourAction === "evidence" || tourAction === "approve") return;
    if (answerStarted) {
      document.getElementById("answer-section")?.scrollIntoView({ block: "start", behavior: "smooth" });
      stick.current = false;
      return;
    }
    if (stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior });
  }, [a.trace, answerStarted, state.tour]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  const submit = () => {
    if (!q.trim()) return;
    stick.current = true;
    askQuestion(q.trim());
  };


  const body = (
    <>
        {a.trace.length > 0 && (
          <div className="section">
            <div className="section-h">
              <span className="eyebrow">How I found this</span>
              {a.answer.length > 0 && (
                <button className="linkbtn" onClick={() => setTraceOpen((o) => !o)} aria-expanded={!traceCollapsed}>
                  {traceCollapsed ? `Show ${readSteps.length} steps` : "Hide steps"}
                </button>
              )}
            </div>
            {traceCollapsed ? (
              <button className="trace-summary" onClick={() => setTraceOpen(true)}>
                <span className="ic">✓</span>
                {traceSummary(readSteps)}
              </button>
            ) : (
              <ul className="trace">{a.trace.map((s) => <TraceItem key={s.id} s={s} />)}</ul>
            )}
          </div>
        )}

        {a.answer && (
          <div className="section" id="answer-section">
            <div className="answer">
              <CitedText text={a.answer} caret={streaming && proposals.length === 0} />
            </div>
          </div>
        )}

        {a.diff && a.answer && (
          <div className={`section ${tourClass(state.tour, "diff")}`} id="diff-section">
            <div className="section-h">
              <span className="eyebrow">Protocol diff</span>
            </div>
            <ProtocolDiffView diff={a.diff} />
          </div>
        )}

        {proposals.length > 0 && (
          <div className={`section ${tourClass(state.tour, "approvals")}`} id="approvals-section">
            <div className="section-h">
              <span className="eyebrow">Needs approval</span>
            </div>
            {a.ledgerProposal && <LedgerApproval proposal={a.ledgerProposal} />}
            {a.draftProposal && <DraftApproval proposal={a.draftProposal} />}
          </div>
        )}

        {a.error && <div className="empty-agent">Something went wrong: {a.error}</div>}

        {a.done && (
          <div className="done-foot">
            {a.done.model && a.source !== "mock" && <span>{a.done.model}</span>}
            {a.done.ms !== undefined && <span>{(a.done.ms / 1000).toFixed(1)} s</span>}
            {a.done.cost_usd !== undefined && <span>${a.done.cost_usd.toFixed(3)}</span>}
            {a.source === "server-cache" && <span>recorded run</span>}
            {a.source === "mock" && <span>offline replay</span>}
          </div>
        )}
    </>
  );

  if (bare) return <div className="agent-bare">{body}</div>;

  return (
    <section className="panel agent reveal" aria-label="Ask the project">
      <div className="panel-head">
        <span className="panel-title">Ask</span>
        <span style={{ flex: 1 }} />
        {a.status !== "idle" && (
          <span className={`run-status ${pending ? "pending" : ""}`} role={pending ? "button" : undefined}
            onClick={() => pending && document.getElementById("approvals-section")?.scrollIntoView({ block: "start", behavior: "smooth" })}>
            {streaming
              ? pending
                ? `${pending} to approve ↓`
                : "Investigating…"
              : a.status === "done"
                ? ""
                : "Stopped"}
          </span>
        )}
      </div>
      <div className="agent-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className={`askbox ${a.status !== "idle" ? "asked" : ""} ${tourClass(state.tour, "ask")}`}>
          <textarea
            rows={a.status === "idle" ? 3 : 2}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            aria-label="Question"
          />
          <div className="row">
            <span className="asker" title={`Asking as ${asker.name}`}><Avatar id="shreya" size="sm" /> {asker.name.split(" ")[0]}</span>
            <span style={{ flex: 1 }} />
            <button className={`btn ${a.status === "idle" ? "primary" : ""}`} onClick={submit} disabled={streaming}>
              {a.status === "idle" ? "Ask" : "Ask again"}
            </button>
          </div>
        </div>


        {body}
      </div>
    </section>
  );
}
