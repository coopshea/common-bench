// Ask the notebook through Managed Agents: one session, a coordinator, three subagents.
// The client's jobs: run the custom tools, validate each submit_* report against its schema, and hold
// draft_trial / propose_ledger_update until a person approves. Everything else runs on Anthropic's side.
//
// CLI: npm run managed:ask -- [--approve] ["question"]

import Anthropic from "@anthropic-ai/sdk";
import type { BetaManagedAgentsStreamSessionEvents } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type { PersonId, Proposal } from "../src/shared/types.ts";
import { ToolInputError, applyProposal, buildDraftProposal, buildLedgerProposal } from "../server/tools.ts";
import { person } from "../server/notebook.ts";
import { AnalysisReport, DraftPlan, FinalAnswer, LedgerChanges, PlanReport, TriedReport, check, type AnalysisReportT, type FinalAnswerT, type PlanReportT, type TriedReportT } from "./schemas.ts";
import { SUBMIT_TOOLS, WRITE_TOOLS, runReadTool, type Block, type ToolName } from "./tools.ts";
import { loadState } from "./setup.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export const HERO_QUESTION =
  "My best is 1.55 Pa·s. I want to order DiluentX ($1,800, 6 weeks) to get under 1.5. Has anyone tried something like this?";

export type Reports = { historian?: TriedReportT; analyst?: AnalysisReportT; planner?: PlanReportT };

export type ManagedEvent =
  | { type: "session"; id: string; url: string }
  | { type: "delegate"; to: string; text: string }
  | { type: "reply"; from: string; text: string }
  | { type: "tool"; agent: string; name: string; input: unknown; ok: boolean; note?: string }
  | { type: "builtin"; agent: string; name: string; detail: string }
  | { type: "live"; kind: "steer" | "device" | "interrupt"; text: string; queued: boolean }
  | { type: "report"; from: keyof Reports; value: unknown }
  | { type: "proposal"; proposal: Proposal<unknown> }
  | { type: "decision"; id: string; decision: "approve" | "reject" }
  | { type: "answer"; value: FinalAnswerT }
  | { type: "done"; session_id: string; reports: Reports; usage?: unknown }
  | { type: "error"; message: string };

export interface AskOptions {
  asker?: PersonId;
  approve: (p: Proposal<unknown>) => Promise<"approve" | "reject">;
  client?: Anthropic;
  /** Called once the session exists, with handles for talking to it while it runs. */
  onControl?: (c: SessionControl) => void;
}

/** The bench keeps moving while the agents work. These reach into a running session. */
export interface SessionControl {
  sessionId: string;
  /** The asker redirects: a user message, queued behind whatever is running. */
  steer(text: string): Promise<void>;
  /** An instrument or a person at the bench reports something: a system message on the coordinator's thread. */
  device(text: string): Promise<void>;
  /** Stop one specialist by name, or everything. */
  interrupt(agentName?: string): Promise<void>;
}

const REPORT_OF: Partial<Record<ToolName, keyof Reports>> = {
  submit_tried_report: "historian",
  submit_analysis_report: "analyst",
  submit_plan_report: "planner",
};
const SCHEMA_OF: Record<string, z.ZodType<unknown>> = {
  submit_tried_report: TriedReport,
  submit_analysis_report: AnalysisReport,
  submit_plan_report: PlanReport,
  submit_answer: FinalAnswer,
};

/** A tiny async queue so tool handlers can run concurrently while the generator yields in order. */
function channel<T>() {
  const buf: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(v: T) {
      buf.push(v);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *drain() {
      while (true) {
        while (buf.length) yield buf.shift()!;
        if (closed) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    },
  };
}

export async function* askManaged(question: string, opts: AskOptions): AsyncGenerator<ManagedEvent> {
  const client = opts.client ?? new Anthropic();
  const asker = opts.asker ?? "shreya";
  const state = loadState();
  const out = channel<ManagedEvent>();
  const reports: Reports = {};
  let answer: FinalAnswerT | null = null;
  const threadName = new Map<string, string>();
  const seen = new Set<string>();
  const nameOf = (tid?: string | null) => (tid ? threadName.get(tid) ?? "subagent" : "Bench lead");

  const session = await client.beta.sessions.create({
    agent: { type: "agent", id: state.agents.coordinator.id, version: state.agents.coordinator.version },
    environment_id: state.environment_id,
    title: question.slice(0, 80),
    resources: state.files.map((f) => ({ type: "file" as const, file_id: f.file_id, mount_path: `/notebook/${f.name}` })),
  });
  out.push({ type: "session", id: session.id, url: `https://platform.claude.com/workspaces/default/sessions/${session.id}` });

  // While a tool call is waiting on us, the session accepts a system.message only right behind a tool result,
  // so live bench events wait in a queue and ride along with the next result.
  const pending = new Set<string>();
  const systemQueue: string[] = [];
  const systemEvent = (text: string) => ({ type: "system.message" as const, content: [{ type: "text" as const, text }] });
  const send = async (custom_tool_use_id: string, content: Block[], is_error = false) => {
    const trailing = systemQueue.splice(0).map(systemEvent);
    pending.delete(custom_tool_use_id);
    await client.beta.sessions.events.send(session.id, {
      events: [{ type: "user.custom_tool_result", custom_tool_use_id, content, is_error }, ...trailing],
    });
  };

  const control: SessionControl = {
    sessionId: session.id,
    async steer(text) {
      out.push({ type: "live", kind: "steer", text, queued: false });
      await client.beta.sessions.events.send(session.id, { events: [{ type: "user.message", content: [{ type: "text", text }] }] });
    },
    async device(text) {
      const line = `[device] ${text}`;
      const queued = pending.size > 0;
      out.push({ type: "live", kind: "device", text, queued });
      // A system.message can't travel alone: it must follow a user message or a tool result in the same request.
      if (queued) systemQueue.push(line);
      else
        await client.beta.sessions.events.send(session.id, {
          events: [{ type: "user.message", content: [{ type: "text", text: "[bench] A live event arrived; see the system note." }] }, systemEvent(line)],
        });
    },
    async interrupt(agentName) {
      const tid = agentName ? [...threadName].find(([, n]) => n.toLowerCase() === agentName.toLowerCase())?.[0] : undefined;
      out.push({ type: "live", kind: "interrupt", text: agentName ?? "all", queued: false });
      await client.beta.sessions.events.send(session.id, { events: [{ type: "user.interrupt", ...(tid ? { session_thread_id: tid } : {}) }] });
    },
  };
  // Controls report failures on the event stream instead of throwing into the caller.
  for (const k of ["steer", "device", "interrupt"] as const) {
    const fn = control[k] as (x?: string) => Promise<void>;
    control[k] = (async (x?: string) => fn(x).catch((e) => out.push({ type: "error", message: `${k}: ${e instanceof Error ? e.message : e}` }))) as never;
  }
  opts.onControl?.(control);

  // Built-in tool calls on a subagent's thread (bash, read) only show on that thread's own stream.
  const watchThread = async (tid: string) => {
    try {
      const st = await client.beta.sessions.threads.events.stream(tid, { session_id: session.id });
      for await (const ev of st) {
        if (ev.type === "agent.tool_use") {
          const i = ev.input as Record<string, unknown>;
          const detail = String(i.command ?? i.file_path ?? i.path ?? i.pattern ?? "").split("\n")[0];
          out.push({ type: "builtin", agent: nameOf(tid), name: ev.name, detail });
        }
        if (ev.type === "session.thread_status_terminated") return;
      }
    } catch {
      /* best effort: the thread's work still reaches us through its report */
    }
  };

  // One custom tool call. Runs concurrently with the stream; the session waits on its result.
  async function handle(ev: { id: string; name: string; input: Record<string, unknown>; session_thread_id?: string | null }) {
    const name = ev.name as ToolName;
    const agent = nameOf(ev.session_thread_id);
    pending.add(ev.id);
    try {
      if (SUBMIT_TOOLS.includes(name)) {
        const r = check(SCHEMA_OF[name], ev.input);
        out.push({ type: "tool", agent, name, input: ev.input, ok: r.ok, note: r.ok ? undefined : r.error });
        if (!r.ok) return void (await send(ev.id, [{ type: "text", text: r.error }], true));
        const key = REPORT_OF[name];
        if (key) {
          (reports as Record<string, unknown>)[key] = r.value;
          out.push({ type: "report", from: key, value: r.value });
        } else {
          answer = r.value as FinalAnswerT;
          out.push({ type: "answer", value: answer });
        }
        return void (await send(ev.id, [{ type: "text", text: "Received. Now report back in one or two sentences and stop." }]));
      }

      if (WRITE_TOOLS.includes(name)) {
        const proposal =
          name === "draft_trial"
            ? buildDraftProposal(DraftPlan.parse(ev.input))
            : buildLedgerProposal(LedgerChanges.parse(ev.input).changes);
        out.push({ type: "tool", agent, name, input: ev.input, ok: true });
        out.push({ type: "proposal", proposal });
        const decision = await opts.approve(proposal);
        proposal.status = decision === "approve" ? "approved" : "rejected";
        out.push({ type: "decision", id: proposal.id, decision });
        if (decision === "approve") applyProposal(proposal, asker);
        const who = person(asker).name;
        return void (await send(ev.id, [
          {
            type: "text",
            text:
              decision === "approve"
                ? `Approved by ${who}. Proposal ${proposal.id}: ${proposal.title}. ${proposal.summary}`
                : `Rejected by ${who}. Proposal ${proposal.id} was not recorded. Don't propose it again.`,
          },
        ]));
      }

      const blocks = runReadTool(name, ev.input);
      out.push({ type: "tool", agent, name, input: ev.input, ok: true });
      await send(ev.id, blocks);
    } catch (e) {
      const msg = e instanceof ToolInputError || e instanceof Error ? e.message : String(e);
      out.push({ type: "tool", agent, name, input: ev.input, ok: false, note: msg });
      await send(ev.id, [{ type: "text", text: `Error: ${msg}` }], true);
    }
  }

  function onEvent(ev: BetaManagedAgentsStreamSessionEvents): "continue" | "stop" {
    if ("id" in ev && ev.id) {
      if (seen.has(ev.id)) return "continue";
      seen.add(ev.id);
    }
    switch (ev.type) {
      case "session.thread_created":
        threadName.set(ev.session_thread_id, ev.agent_name ?? "subagent");
        void watchThread(ev.session_thread_id);
        break;
      case "agent.thread_message_sent":
        out.push({ type: "delegate", to: ev.to_agent_name ?? "subagent", text: ev.content.map((b) => ("text" in b ? b.text : "")).join("") });
        break;
      case "agent.thread_message_received":
        out.push({ type: "reply", from: ev.from_agent_name ?? "subagent", text: ev.content.map((b) => ("text" in b ? b.text : "")).join("") });
        break;
      case "agent.custom_tool_use":
        void handle(ev);
        break;
      case "session.error":
        out.push({ type: "error", message: JSON.stringify(ev.error ?? ev) });
        break;
      case "session.status_idle":
        if (ev.stop_reason.type !== "requires_action") return "stop";
        break;
      case "session.status_terminated":
        return "stop";
    }
    return "continue";
  }

  // Stream-first, then send. If the stream drops, reconnect and catch up from the event list (deduped by id).
  const pump = (async () => {
    let first = true;
    for (let attempt = 0; attempt < 5; attempt++) {
      const stream = await client.beta.sessions.events.stream(session.id);
      if (first) {
        first = false;
        await client.beta.sessions.events.send(session.id, {
          events: [{ type: "user.message", content: [{ type: "text", text: `Asked by ${person(asker).name} (${asker}):\n\n${question}` }] }],
        });
      } else {
        for await (const ev of client.beta.sessions.events.list(session.id)) if (onEvent(ev as never) === "stop") return;
      }
      for await (const ev of stream) if (onEvent(ev) === "stop") return;
    }
    out.push({ type: "error", message: "Event stream kept dropping; gave up after 5 reconnects." });
  })()
    .catch((e) => out.push({ type: "error", message: e instanceof Error ? e.message : String(e) }))
    .finally(async () => {
      const s = await client.beta.sessions.retrieve(session.id).catch(() => null);
      out.push({ type: "done", session_id: session.id, reports, usage: s?.usage });
      out.close();
    });

  yield* out.drain();
  await pump;
}

// ---------- CLI ----------
// While it runs, type into it: "y"/"n" answers an approval, "/device <text>" reports a bench event,
// "/stop [agent]" interrupts, anything else steers. --approve auto-approves; --live injects one bench event
// when the Analyst starts, to exercise the async path.

const LIVE_EVENT =
  "Degasser worksheet (Shreya): every batch she has run, T11–T14, was degassed 10 min before printing. " +
  "Cooper's 2024–25 runs have no degas entries because the lab had no degasser then.";

async function main() {
  const args = process.argv.slice(2);
  const auto = args.includes("--approve");
  const live = args.includes("--live");
  const question = args.filter((a) => !a.startsWith("--")).join(" ") || HERO_QUESTION;
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  let control: SessionControl | null = null;
  let answerApproval: ((v: "approve" | "reject") => void) | null = null;
  let liveSent = false;

  rl?.on("line", (line) => {
    const t = line.trim();
    if (!t) return;
    if (answerApproval && /^[yn]/i.test(t)) {
      answerApproval(/^y/i.test(t) ? "approve" : "reject");
      answerApproval = null;
    } else if (t.startsWith("/device ")) void control?.device(t.slice(8)).catch((e) => console.error(String(e)));
    else if (t.startsWith("/stop")) void control?.interrupt(t.slice(5).trim() || undefined).catch((e) => console.error(String(e)));
    else void control?.steer(t).catch((e) => console.error(String(e)));
  });

  const log: ManagedEvent[] = [];
  const t0 = Date.now();
  const short = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + "…" : s).replace(/\n/g, " ");

  for await (const ev of askManaged(question, {
    onControl: (c) => (control = c),
    approve: async (p) => {
      if (auto || !rl) return "approve";
      console.log(`\n  Approve ${p.title}?\n    ${p.summary}\n  [y/n]`);
      return new Promise((r) => (answerApproval = r));
    },
  })) {
    log.push(ev);
    const s = ((Date.now() - t0) / 1000).toFixed(0).padStart(4) + "s";
    switch (ev.type) {
      case "session": console.log(`${s}  session ${ev.id}\n       ${ev.url}`); break;
      case "delegate":
        console.log(`${s}  → ${ev.to}: ${short(ev.text)}`);
        if (live && !liveSent && ev.to === "Analyst") {
          liveSent = true;
          void control!.device(LIVE_EVENT);
        }
        break;
      case "reply": console.log(`${s}  ← ${ev.from}: ${short(ev.text)}`); break;
      case "tool": console.log(`${s}    ${ev.agent} · ${ev.name}${ev.ok ? "" : `  ✗ ${short(ev.note ?? "", 300)}`}`); break;
      case "builtin": console.log(`${s}    ${ev.agent} · ${ev.name} ${short(ev.detail, 100)}`); break;
      case "live": console.log(`${s}  ⚡ ${ev.kind}${ev.queued ? " (queued behind a tool call)" : ""}: ${short(ev.text)}`); break;
      case "report": console.log(`${s}  ✓ ${ev.from} report (schema-valid)`); break;
      case "proposal": console.log(`${s}  ? ${ev.proposal.title}`); break;
      case "decision": console.log(`${s}  ${ev.decision === "approve" ? "✓ approved" : "✗ rejected"} ${ev.id}`); break;
      case "answer": console.log(`\n${ev.value.answer}\n\ncited: ${ev.value.cited_ids.join(", ")}\n`); break;
      case "error": console.error(`${s}  ERROR ${ev.message}`); break;
      case "done": console.log(`${s}  done ${ev.session_id}`, ev.usage ? JSON.stringify(ev.usage) : ""); break;
    }
  }
  rl?.close();
  const dir = join(HERE, "runs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ question, events: log }, null, 2));
  console.log(`transcript: ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
