// The notebook agent, built on the Claude Agent SDK.
//
// - Tools: only the notebook MCP tools (in-process SDK MCP server). Built-in Claude Code
//   tools are disabled (tools: []), filesystem settings are off (settingSources: []), and
//   only our MCP server is loaded (strictMcpConfig).
// - Every tool call passes the SDK permission callback (canUseTool). Read tools are allowed
//   at once. The two write tools are gated: the proposal is built by code (estimates included),
//   emitted as a pending card, and the call waits for a person's decision (timeout → reject).
// - Two phases in one streaming-input session: (1) investigate and answer, (2) file the
//   proposals. On Sonnet 5.5 the readable answer must be the final text of a turn, and the
//   write tools block on approval, so this order lets people read the reasoning before the
//   approval cards appear.
//
// Stable export for the eval harness: runAgent({ question, approvals: "record" }).

import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, type CanUseTool, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import type { AskEvent, Citation, PersonId, Proposal, ProtocolDiff, TraceStep } from "../src/shared/types.ts";
import { createNotebookSdkServer, shortToolName } from "./mcp-sdk.ts";
import { citationFor, extractCitationIds, getDrafts, person } from "./notebook.ts";
import { buildSystemPrompt, FILE_PROPOSALS_PROMPT } from "./prompt.ts";
import {
  buildDraftProposal,
  buildLedgerProposal,
  DraftPlanShape,
  LedgerChangeInput,
  READ_TOOL_NAMES,
  traceLabel,
  WRITE_TOOL_NAMES,
} from "./tools.ts";
import { z } from "zod";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const CHEAP_MODEL = "claude-haiku-5-5";
export const APPROVAL_TIMEOUT_MS = Number(process.env.APPROVAL_TIMEOUT_MS ?? 10 * 60_000);
const EFFORT = (process.env.AGENT_EFFORT ?? "medium") as "low" | "medium" | "high";
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

export type Decision = "approve" | "reject";

export interface RunAgentOptions {
  question: string;
  asker?: PersonId;
  model?: string;
  /** "record": capture proposals without applying them and let the run finish (evals).
   *  A function: called once per proposal; resolve with the person's decision. The caller applies approved changes. */
  approvals: "record" | ((p: Proposal<unknown>) => Promise<Decision>);
  onEvent?: (e: AskEvent) => void;
  signal?: AbortSignal;
}

export interface RunAgentResult {
  events: AskEvent[];
  answer: string;
  citations: string[];
  proposals: Proposal<unknown>[];
  tool_calls: { name: string; input: unknown }[];
  cost_usd: number;
  ms: number;
  model: string;
}

/** Thrown when the agent can't reach the API before producing anything (no key, offline). */
export class AgentUnavailableError extends Error {}

/** Environment for the Claude Code subprocess: the caller's env minus anything from a host
 *  Claude session (base-URL proxies, nested-session flags, tool-naming switches). */
function cleanEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|MCP_)/.test(k)) continue;
    if (k === "ANTHROPIC_BASE_URL" && !process.env.NOTEBOOK_KEEP_BASE_URL) continue;
    if (k === "ANTHROPIC_AUTH_TOKEN") continue;
    env[k] = v;
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "common-bench/0.1.0";
  return env;
}

export function apiKeyPresent(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function userMessage(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// Phase 2 ("file your proposals") runs only for decision questions whose answer proposed something.
const DECISION_QUESTION =
  /has anyone|anyone (tried|done)|tried (this|that|something)|should (i|we)|what (should|next|would you)|next step|worth|recommend|propos|order|buy|dead end|disput|revisit|abandon|plan|design an? (experiment|trial)|how (do|can|could) (i|we) (get|reach|beat)/i;
const ANSWER_PROPOSES = /\bT\d{2}[a-d]\b|\b(mark|propos|suggest|recommend|add|file)\w*\b[^.]{0,80}\b(disputed|ledger|candidate|finding|trial|arms?|control)\b/i;

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const t0 = Date.now();
  const model = opts.model ?? DEFAULT_MODEL;
  const asker: PersonId = opts.asker ?? "greeshma";
  const events: AskEvent[] = [];
  const emit = (e: AskEvent) => {
    events.push(e);
    try {
      opts.onEvent?.(e);
    } catch {
      /* a listener error must not break the run */
    }
  };

  const abort = new AbortController();
  const onAbort = () => abort.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  // ---- run state ----
  let phase: 1 | 2 = 1;
  let answer = "";
  let held = ""; // phase-1 text not yet shown (short remarks before a tool call are dropped)
  let shownAnswer = false;
  let phase2Text = "";
  let costUsd = 0;
  let resultError: string | null = null;
  const toolCalls: { name: string; input: unknown }[] = [];
  const trace = new Map<string, { step: TraceStep; started: number }>();
  const proposals: Proposal<unknown>[] = [];
  const proposalByToolUse = new Map<string, Proposal<unknown> | Error>();
  const decisions = new Map<string, Promise<Decision | "record">>();
  const granted = new Map<string, Proposal<unknown>[]>(); // tool name → approved proposals awaiting execution (FIFO)
  const phase1Done = deferred<void>();
  const phase2Done = deferred<void>();
  let meaningful = false; // emitted anything the user can see

  const emitProposal = (p: Proposal<unknown>) =>
    emit(p.kind === "ledger" ? { type: "ledger_proposal", proposal: structuredClone(p) as never } : { type: "draft", proposal: structuredClone(p) as never });

  function decide(p: Proposal<unknown>): Promise<Decision | "record"> {
    if (opts.approvals === "record") return Promise.resolve("record");
    const ask = opts.approvals;
    return new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => resolve("reject"), APPROVAL_TIMEOUT_MS);
      const stop = () => {
        clearTimeout(timer);
        resolve("reject");
      };
      abort.signal.addEventListener("abort", stop, { once: true });
      ask(p).then(
        (d) => {
          clearTimeout(timer);
          abort.signal.removeEventListener("abort", stop);
          resolve(d);
        },
        () => stop(),
      );
    });
  }

  /** Build (once) the proposal for a write-tool call, emit its pending card and start waiting for a decision. */
  function ensureProposal(toolUseId: string, name: string, input: unknown): Proposal<unknown> | Error {
    const have = proposalByToolUse.get(toolUseId);
    if (have) return have;
    let p: Proposal<unknown>;
    try {
      const reservedTrials = [...getDrafts().map((d) => d.id), ...proposals.filter((x) => x.kind === "draft").map((x) => (x.payload as { id: string }).id)];
      const reservedLedger = proposals
        .filter((x) => x.kind === "ledger")
        .flatMap((x) => (x.payload as { op: string; item?: { id: string } }[]).flatMap((c) => (c.item ? [c.item.id] : [])));
      p =
        name === "propose_ledger_update"
          ? buildLedgerProposal(z.object({ changes: z.array(LedgerChangeInput) }).parse(input).changes, reservedLedger)
          : buildDraftProposal(z.object(DraftPlanShape).parse(input), reservedTrials);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      proposalByToolUse.set(toolUseId, err);
      return err;
    }
    proposals.push(p);
    proposalByToolUse.set(toolUseId, p);
    meaningful = true;
    emitProposal(p);
    const d = decide(p).then((dec) => {
      if (dec !== "record") {
        p.status = dec === "approve" ? "approved" : "rejected";
        emitProposal(p);
      }
      return dec;
    });
    decisions.set(toolUseId, d);
    return p;
  }

  // ---- the permission gate: every tool call passes here; reads are allowed, writes wait for a person ----
  const canUseTool: CanUseTool = async (toolName, input, { toolUseID }) => {
    const name = shortToolName(toolName);
    if (READ_TOOL_NAMES.includes(name)) return { behavior: "allow", updatedInput: input };
    if (!WRITE_TOOL_NAMES.includes(name)) return { behavior: "deny", message: "Only the notebook tools are available here." };
    if (phase === 1)
      return {
        behavior: "deny",
        message:
          "Not yet: nothing is filed during the investigation. Finish your answer first. If the question asks for a decision or next step, describe the proposal in the answer; you'll be asked to file it afterwards.",
      };
    const p = ensureProposal(toolUseID, name, input);
    if (p instanceof Error) return { behavior: "deny", message: `Invalid proposal, nothing was filed: ${p.message}` };
    const d = await decisions.get(toolUseID)!;
    if (d === "reject")
      return { behavior: "deny", message: `${person(asker).name} rejected this proposal (${p.title}). Nothing was changed.` };
    granted.set(name, [...(granted.get(name) ?? []), p]);
    return { behavior: "allow", updatedInput: input };
  };

  // ---- write tools run only after canUseTool allowed them ----
  const onWrite = async (name: string): Promise<CallToolResult> => {
    const p = granted.get(name)?.shift();
    if (!p) return { content: [{ type: "text", text: "Error: no approved proposal for this call." }], isError: true };
    const text =
      p.status === "approved"
        ? `Approved by ${person(asker).name}: ${p.title}. ${p.summary}`
        : `Recorded proposal ${p.id} (${p.title}) as pending a person's approval. Nothing has been applied.`;
    return { content: [{ type: "text", text: JSON.stringify({ summary: text, proposal_id: p.id, status: p.status }) }] };
  };

  // ---- streaming input: phase 1 question, then (if needed) phase 2 "file the proposals" ----
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield userMessage(opts.question);
    await phase1Done.promise;
    const kinds = new Set(proposals.map((p) => p.kind));
    const needPhase2 =
      !abort.signal.aborted && !resultError && kinds.size < 2 && DECISION_QUESTION.test(opts.question) && ANSWER_PROPOSES.test(answer);
    if (needPhase2) {
      phase = 2;
      yield userMessage(FILE_PROPOSALS_PROMPT);
      await phase2Done.promise;
    }
  }

  const sys = buildSystemPrompt(asker);
  const q = query({
    prompt: input(),
    options: {
      model,
      systemPrompt: [sys.static, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, sys.dynamic],
      tools: [],
      mcpServers: { notebook: createNotebookSdkServer((name) => onWrite(name)) },
      canUseTool,
      permissionMode: "default",
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      includePartialMessages: true,
      thinking: { type: "adaptive" },
      effort: EFFORT,
      maxTurns: 24,
      // Eval-only cost guard (evals/stress): unset in the demo, so behavior is unchanged.
      ...(process.env.AGENT_MAX_BUDGET_USD ? { maxBudgetUsd: Number(process.env.AGENT_MAX_BUDGET_USD) } : {}),
      cwd: APP_DIR,
      env: cleanEnv(),
      abortController: abort,
      stderr: (d) => {
        if (process.env.AGENT_DEBUG) process.stderr.write(`[cli] ${d}`);
      },
    },
  });

  const flushHeld = () => {
    if (!held) return;
    answer += held;
    emit({ type: "answer", text: held, delta: true });
    held = "";
    shownAnswer = true;
    meaningful = true;
  };

  try {
    for await (const m of q) {
      if (m.type === "stream_event") {
        if (m.parent_tool_use_id) continue;
        const ev = m.event;
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use" && phase === 1) {
          // Text before a tool call is narration, not the answer.
          held = "";
          if (shownAnswer) {
            answer = "";
            shownAnswer = false;
            emit({ type: "answer", text: "", delta: false });
          }
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          if (phase === 1) {
            held += ev.delta.text;
            if (shownAnswer || held.length > 160) flushHeld();
          } else phase2Text += ev.delta.text;
        }
      } else if (m.type === "assistant") {
        if (m.parent_tool_use_id) continue;
        if (m.error && !meaningful && ["authentication_failed", "billing_error", "server_error", "unknown"].includes(m.error)) {
          throw new AgentUnavailableError(`API error: ${m.error}`);
        }
        for (const b of m.message.content) {
          if (b.type !== "tool_use") continue;
          const name = shortToolName(b.name);
          if (phase === 1 && WRITE_TOOL_NAMES.includes(name)) continue; // refused at the gate: no card, no trace step
          toolCalls.push({ name, input: b.input });
          const step: TraceStep = { id: b.id, label: traceLabel(name, b.input), tool: name, input: b.input, status: "running" };
          trace.set(b.id, { step, started: Date.now() });
          meaningful = true;
          emit({ type: "trace", step: { ...step } });
          if (WRITE_TOOL_NAMES.includes(name)) ensureProposal(b.id, name, b.input);
        }
      } else if (m.type === "user") {
        if (m.parent_tool_use_id || typeof m.message.content === "string") continue;
        for (const block of m.message.content) {
          if (block.type !== "tool_result") continue;
          const tr = trace.get(block.tool_use_id);
          if (!tr) continue;
          const raw =
            typeof block.content === "string"
              ? block.content
              : (block.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            /* errors and denials are plain text */
          }
          const name = tr.step.tool!;
          let summary = typeof parsed?.summary === "string" ? parsed.summary : raw.replace(/^Error: /, "").slice(0, 240);
          let status: TraceStep["status"] = block.is_error ? "error" : "done";
          if (WRITE_TOOL_NAMES.includes(name)) {
            const p = proposalByToolUse.get(block.tool_use_id);
            if (p && !(p instanceof Error)) {
              summary =
                p.status === "approved"
                  ? `Approved by ${person(asker).name}`
                  : p.status === "rejected"
                    ? "Rejected — nothing changed"
                    : "Waiting for approval (recorded, not applied)";
              status = "done";
            }
          }
          const step: TraceStep = {
            ...tr.step,
            status,
            summary,
            citations: Array.isArray(parsed?.cited_ids) ? (parsed!.cited_ids as string[]) : undefined,
            ms: Date.now() - tr.started,
          };
          tr.step = step;
          emit({ type: "trace", step: { ...step } });
          if (name === "diff_protocols" && !block.is_error && parsed) {
            const { summary: _s, cited_ids: _c, ...diff } = parsed;
            emit({ type: "diff", diff: diff as unknown as ProtocolDiff });
          }
        }
      } else if (m.type === "system" && m.subtype === "api_retry") {
        if (!meaningful) throw new AgentUnavailableError(`API unreachable (${m.error}, status ${m.error_status ?? "none"})`);
      } else if (m.type === "result") {
        costUsd = m.total_cost_usd ?? costUsd;
        if (m.subtype !== "success" || m.is_error) {
          resultError = m.subtype === "success" ? m.result : m.subtype;
          if (!meaningful) throw new AgentUnavailableError(`Agent run failed before any output: ${resultError}`);
        }
        if (phase === 1) {
          if (held) flushHeld();
          if (!answer && m.subtype === "success" && m.result) {
            answer = m.result;
            emit({ type: "answer", text: answer, delta: false });
          }
          const ids = extractCitationIds(answer);
          const items = ids.map(citationFor).filter((c): c is Citation => c !== null);
          emit({ type: "citations", items });
          phase1Done.resolve();
        } else {
          phase2Done.resolve();
        }
      }
    }
  } catch (e) {
    phase1Done.resolve();
    phase2Done.resolve();
    if (abort.signal.aborted && !(e instanceof AgentUnavailableError)) {
      throw new Error("aborted");
    }
    if (e instanceof AgentUnavailableError) {
      abort.abort();
      throw e;
    }
    if (!meaningful) throw new AgentUnavailableError(e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }

  const ms = Date.now() - t0;
  if (resultError) emit({ type: "error", message: `Agent stopped early: ${resultError}` });
  emit({ type: "done", cached: false, model, cost_usd: Math.round(costUsd * 10000) / 10000, ms });
  void phase2Text;
  return {
    events,
    answer,
    citations: extractCitationIds(answer).filter((id) => citationFor(id) !== null),
    proposals,
    tool_calls: toolCalls,
    cost_usd: costUsd,
    ms,
    model,
  };
}
