// App state: one reducer, one context. Lives above the router so /evals doesn't lose the session.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type {
  AskEvent,
  Citation,
  DraftTrial,
  LedgerChange,
  LedgerItem,
  LensId,
  ProtocolDiff,
  Proposal,
  PersonId,
  StepId,
  TraceStep,
} from "../shared/types.ts";
import { notebook, project } from "../data/notebook.ts";
import { replayEvents, type ReplayEvent } from "../lib/derive.ts";
import { approve as postApprove, ask as streamAsk, checkHealth, type Source } from "../api/client.ts";
import { prefersReducedMotion } from "../lib/hooks.ts";

type MetricKey = "viscosity_pa_s" | "uts_mpa" | "flex_strength_mpa" | "porosity_pct" | "viability_pct";

export interface AskState {
  runId: number;
  status: "idle" | "streaming" | "done" | "error";
  source: Source | null;
  question: string;
  trace: TraceStep[];
  answer: string;
  citations: Citation[];
  diff: ProtocolDiff | null;
  ledgerProposal: Proposal<LedgerChange[]> | null;
  draftProposal: Proposal<DraftTrial> | null;
  done: Extract<AskEvent, { type: "done" }> | null;
  error: string | null;
}

export interface State {
  ledger: LedgerItem[];
  drafts: DraftTrial[];
  lens: LensId;
  replay: { events: ReplayEvent[]; cursor: number | null; playing: boolean };
  focus: { id: string; nonce: number } | null;
  hover: string | null; // trial or arm id under the pointer, highlighted in every plot and the table
  metric: MetricKey; // which check the chart is focused on
  xAxis: "diluent" | "photoinit";
  drawer: { trialId: string; logId?: string } | null;
  station: StepId | null;
  ask: AskState;
  health: { state: "checking" | "live" | "cached" | "offline"; model?: string };
  tour: number | null;
  flash: Record<string, number>; // id → nonce, for "just changed" animations
  // One selection model: the right panel follows it, Esc clears it.
  sel: Selection;
  askOpen: boolean; // the right panel shows the agent's answer instead of the selection
  askScope: string | null; // which panel asked, so only that panel offers the answer back
  back: { path: string; sel: Selection; label: string } | null; // after a deliberate jump between Projects and Lab
  search: boolean;
  // Review: double-click a trial, a step or the chart to flag it for someone, with a note.
  flagging: FlagTarget | null;
  flags: Flag[];
  // Instrument bookings approved from the lab's Ask.
  bookings: Booking[];
}

/** What a flag points at: enough to reopen the exact view (path plus selection). */
export interface FlagTarget {
  kind: "trial" | "step" | "chart" | "instrument";
  label: string; // "T09", "T09 · Print", "High-diluent chart"
  path: string;
  sel: Selection;
}
export interface Flag {
  id: string;
  target: FlagTarget;
  from: PersonId;
  to: PersonId;
  note: string;
  at: string;
}
export interface Booking {
  id: string;
  inst: string;
  by: PersonId;
  from: string; // "14:00"
  to: string;
  day: string; // "Today"
}

export interface Selection {
  trial: string | null;
  step: StepId | null;
  inst: string | null;
}
export const noSel: Selection = { trial: null, step: null, inst: null };

const emptyAsk: AskState = {
  runId: 0, status: "idle", source: null, question: "", trace: [], answer: "", citations: [], diff: null,
  ledgerProposal: null, draftProposal: null, done: null, error: null,
};

const initial: State = {
  ledger: structuredClone(notebook.ledger),
  drafts: [],
  lens: "team",
  replay: { events: replayEvents(notebook.ledger), cursor: null, playing: false },
  focus: null,
  hover: null,
  metric: "viscosity_pa_s",
  xAxis: "diluent",
  drawer: null,
  station: null,
  ask: emptyAsk,
  health: { state: "checking" },
  tour: null,
  flash: {},
  sel: noSel,
  askOpen: false,
  askScope: null,
  back: null,
  search: false,
  flagging: null,
  flags: [],
  bookings: [],
};

type Action =
  | { type: "lens"; lens: LensId }
  | { type: "replay/start" }
  | { type: "replay/tick" }
  | { type: "replay/stop" }
  | { type: "focus"; id: string | null }
  | { type: "hover"; id: string | null }
  | { type: "metric"; key: MetricKey }
  | { type: "xaxis"; axis: "diluent" | "photoinit" }
  | { type: "drawer"; trialId: string | null; logId?: string }
  | { type: "station"; id: StepId | null }
  | { type: "ask/start"; question: string; runId: number }
  | { type: "ask/source"; runId: number; source: Source }
  | { type: "ask/event"; runId: number; event: AskEvent }
  | { type: "decide"; id: string; decision: "approve" | "reject"; serverLedger?: LedgerItem[] }
  | { type: "health"; state: State["health"] }
  | { type: "tour"; step: number | null }
  | { type: "select"; sel: Partial<Selection> }
  | { type: "askOpen"; open: boolean }
  | { type: "askScope"; scope: string }
  | { type: "back"; back: State["back"] }
  | { type: "search"; open: boolean }
  | { type: "flagging"; target: FlagTarget | null }
  | { type: "flag"; flag: Flag }
  | { type: "book"; booking: Booking };

let nonce = 1;

function applyLedger(ledger: LedgerItem[], changes: LedgerChange[]): LedgerItem[] {
  let next = ledger.map((l) => ({ ...l }));
  for (const c of changes) {
    if (c.op === "update") {
      next = next.map((l) =>
        l.id === c.id
          ? {
              ...l,
              ...c.patch,
              history: [...(l.history ?? []), { at: project.now, by: "greeshma", change: `status → ${c.patch.status ?? l.status}` }],
            }
          : l,
      );
    } else if (!next.some((l) => l.id === c.item.id)) {
      next.push({ ...c.item, history: [...(c.item.history ?? []), { at: project.now, by: "greeshma", change: "approved" }] });
    }
  }
  return next;
}

function upsertTrace(list: TraceStep[], step: TraceStep): TraceStep[] {
  const i = list.findIndex((s) => s.id === step.id);
  if (i < 0) return [...list, step];
  const copy = list.slice();
  copy[i] = { ...copy[i], ...step };
  return copy;
}

function reduceAsk(a: AskState, e: AskEvent): AskState {
  switch (e.type) {
    case "trace":
      return { ...a, trace: upsertTrace(a.trace, e.step) };
    case "answer":
      return { ...a, answer: e.delta ? a.answer + e.text : e.text };
    case "citations": {
      const seen = new Map(a.citations.map((c) => [c.id, c]));
      for (const c of e.items) seen.set(c.id, c);
      return { ...a, citations: [...seen.values()] };
    }
    case "diff":
      return { ...a, diff: e.diff };
    case "ledger_proposal":
      return { ...a, ledgerProposal: e.proposal };
    case "draft":
      return { ...a, draftProposal: e.proposal };
    case "done":
      return { ...a, status: "done", done: e };
    case "error":
      return { ...a, status: "error", error: e.message };
  }
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "lens":
      return { ...s, lens: a.lens };
    case "replay/start":
      return { ...s, replay: { ...s.replay, cursor: 0, playing: true }, focus: null };
    case "replay/tick": {
      if (s.replay.cursor === null) return s;
      const next = s.replay.cursor + 1;
      if (next >= s.replay.events.length) return { ...s, replay: { ...s.replay, cursor: null, playing: false } };
      return { ...s, replay: { ...s.replay, cursor: next } };
    }
    case "replay/stop":
      return { ...s, replay: { ...s.replay, cursor: null, playing: false } };
    case "focus":
      return { ...s, focus: a.id ? { id: a.id, nonce: nonce++ } : null };
    case "hover":
      return s.hover === a.id ? s : { ...s, hover: a.id };
    case "metric":
      return { ...s, metric: a.key };
    case "xaxis":
      return { ...s, xAxis: a.axis };
    case "drawer":
      return { ...s, drawer: a.trialId ? { trialId: a.trialId, logId: a.logId } : null };
    case "station":
      return { ...s, station: a.id };
    case "ask/start":
      return { ...s, ask: { ...emptyAsk, runId: a.runId, status: "streaming", question: a.question } };
    case "ask/source":
      return a.runId === s.ask.runId ? { ...s, ask: { ...s.ask, source: a.source } } : s;
    case "ask/event":
      return a.runId === s.ask.runId ? { ...s, ask: reduceAsk(s.ask, a.event) } : s;
    case "decide": {
      const { ask } = s;
      const flash = { ...s.flash };
      if (ask.ledgerProposal?.id === a.id && ask.ledgerProposal.status === "pending") {
        const p = { ...ask.ledgerProposal, status: a.decision === "approve" ? "approved" : "rejected" } as const;
        let ledger = s.ledger;
        if (a.decision === "approve") {
          ledger = a.serverLedger ?? applyLedger(s.ledger, p.payload);
          for (const c of p.payload) flash[c.op === "update" ? c.id : c.item.id] = nonce++;
        }
        return { ...s, ledger, flash, ask: { ...ask, ledgerProposal: p } };
      }
      if (ask.draftProposal?.id === a.id && ask.draftProposal.status === "pending") {
        const p = { ...ask.draftProposal, status: a.decision === "approve" ? "approved" : "rejected" } as const;
        let drafts = s.drafts;
        if (a.decision === "approve" && !drafts.some((d) => d.id === p.payload.id)) {
          drafts = [...drafts, p.payload];
          flash[p.payload.id] = nonce++;
        }
        return { ...s, drafts, flash, ask: { ...ask, draftProposal: p } };
      }
      return s;
    }
    case "health":
      return { ...s, health: a.state };
    case "tour":
      return { ...s, tour: a.step };
    case "select": {
      const sel = { ...s.sel, ...a.sel };
      if (a.sel.trial !== undefined && a.sel.step === undefined) sel.step = null; // a new trial starts with no step open
      return { ...s, sel, askOpen: a.sel.trial !== undefined || a.sel.inst !== undefined ? false : s.askOpen,
        focus: a.sel.trial !== undefined ? (a.sel.trial ? { id: a.sel.trial, nonce: nonce++ } : null) : s.focus };
    }
    case "askOpen":
      return { ...s, askOpen: a.open };
    case "askScope":
      return { ...s, askScope: a.scope };
    case "back":
      return { ...s, back: a.back };
    case "search":
      return { ...s, search: a.open };
    case "flagging":
      return { ...s, flagging: a.target };
    case "flag":
      return { ...s, flags: [...s.flags, a.flag], flagging: null, flash: { ...s.flash, [a.flag.id]: nonce++ } };
    case "book":
      return { ...s, bookings: [...s.bookings, a.booking], flash: { ...s.flash, [a.booking.id]: nonce++ } };
  }
}

interface Ctx {
  state: State;
  dispatch: React.Dispatch<Action>;
  askQuestion: (question: string, opts?: { cached?: boolean }) => void;
  decide: (id: string, decision: "approve" | "reject") => Promise<void>;
  /** Visible "now" during replay (ISO date), or null when showing everything. */
  replayDate: string | null;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Health check once on load.
  useEffect(() => {
    let live = true;
    checkHealth().then((h) => {
      if (!live) return;
      dispatch({ type: "health", state: h ? { state: h.live ? "live" : "cached", model: h.model } : { state: "offline" } });
    });
    return () => {
      live = false;
    };
  }, []);

  // Replay ticker.
  const { cursor, playing, events } = state.replay;
  useEffect(() => {
    if (!playing || cursor === null) return;
    const ms = events[cursor]?.ms ?? 300;
    const t = setTimeout(() => dispatch({ type: "replay/tick" }), prefersReducedMotion() ? Math.min(ms, 250) : ms);
    return () => clearTimeout(t);
  }, [playing, cursor, events]);

  const askQuestion = useCallback((question: string, opts?: { cached?: boolean }) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    const runId = ++runRef.current;
    dispatch({ type: "ask/start", question, runId });
    dispatch({ type: "askOpen", open: true });
    const preferMock = stateRef.current.health.state === "offline";
    streamAsk(
      { question, asker: "greeshma", cached: opts?.cached },
      (event) => dispatch({ type: "ask/event", runId, event }),
      { signal: ctl.signal, preferMock, onSource: (source) => dispatch({ type: "ask/source", runId, source }) },
    ).catch((err) => {
      if ((err as Error).name !== "AbortError") dispatch({ type: "ask/event", runId, event: { type: "error", message: String(err) } });
    });
  }, []);

  const decide = useCallback(async (id: string, decision: "approve" | "reject") => {
    const usingMock = stateRef.current.ask.source === "mock";
    // Apply client-side first: the demo never waits on the network.
    dispatch({ type: "decide", id, decision });
    await postApprove(id, { decision, by: "greeshma" }, usingMock);
  }, []);

  const replayDate = state.replay.cursor === null ? null : state.replay.events[state.replay.cursor].date;

  const value = useMemo(() => ({ state, dispatch, askQuestion, decide, replayDate }), [state, askQuestion, decide, replayDate]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useStore outside StoreProvider");
  return c;
}

/** Visible at the current replay date? */
export const visibleAt = (date: string, replayDate: string | null) => replayDate === null || date.slice(0, 10) <= replayDate;
