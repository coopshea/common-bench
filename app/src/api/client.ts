// Talks to Core's server (/api via the Vite proxy). Falls back to the offline replay in src/mock
// when /api/health is unreachable or /api/ask fails before streaming anything.
import type { ApproveRequest, ApproveResponse, AskEvent, AskRequest, HealthResponse } from "../shared/types.ts";
import { resolveMockProposal, runMockAsk } from "../mock/mockAsk.ts";

export type Source = "live" | "server-cache" | "mock";

async function withTimeout<T>(ms: number, f: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await f(ctl.signal);
  } finally {
    clearTimeout(t);
  }
}

let healthOnce: Promise<HealthResponse | null> | null = null;

/** One health check per page load (React StrictMode runs effects twice in dev). */
export function checkHealth(): Promise<HealthResponse | null> {
  healthOnce ??= fetchHealth();
  return healthOnce;
}

async function fetchHealth(): Promise<HealthResponse | null> {
  // A page load is a fresh demo: put the server's ledger and drafts back to the seed state too.
  await fetch("/api/reset", { method: "POST" }).catch(() => undefined);
  try {
    return await withTimeout(1500, async (signal) => {
      const res = await fetch("/api/health", { signal });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) return null;
      return (await res.json()) as HealthResponse;
    });
  } catch {
    return null;
  }
}

/** Parse one NDJSON line, or an SSE `data:` line. Returns null for blanks and comments. */
function parseLine(line: string): AskEvent | null {
  let s = line.trim();
  if (!s || s.startsWith(":") || s.startsWith("event:") || s.startsWith("id:")) return null;
  if (s.startsWith("data:")) s = s.slice(5).trim();
  if (!s || s === "[DONE]") return null;
  try {
    return JSON.parse(s) as AskEvent;
  } catch {
    return null;
  }
}

/**
 * Streams an answer. Resolves with the source actually used.
 * `preferMock` skips the network (health check already failed).
 */
export async function ask(
  req: AskRequest,
  onEvent: (e: AskEvent) => void,
  opts: { signal: AbortSignal; preferMock: boolean; onSource: (s: Source) => void },
): Promise<void> {
  const fallback = async () => {
    opts.onSource("mock");
    await runMockAsk(req, onEvent, opts.signal);
  };
  if (opts.preferMock) return fallback();

  let res: Response;
  try {
    res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify(req),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return fallback();
  }
  if (!res.ok || !res.body) return fallback();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let got = 0;
  let sawDone = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const e = parseLine(line);
        if (!e) continue;
        if (got === 0) opts.onSource(req.cached ? "server-cache" : "live");
        got++;
        if (e.type === "done") {
          sawDone = true;
          if (e.cached) opts.onSource("server-cache");
        }
        onEvent(e);
      }
    }
    const tail = parseLine(buf);
    if (tail) {
      got++;
      if (tail.type === "done") sawDone = true;
      onEvent(tail);
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    if (got === 0) return fallback();
    onEvent({ type: "error", message: "The stream was interrupted." });
    return;
  }
  if (got === 0) return fallback();
  if (!sawDone) onEvent({ type: "done", cached: false });
}

/** POST /api/approve/:id. Never throws: the UI applies the payload client-side regardless. */
export async function approve(id: string, body: ApproveRequest, usingMock: boolean): Promise<ApproveResponse | null> {
  if (usingMock) {
    resolveMockProposal(id, body.decision);
    return null;
  }
  try {
    return await withTimeout(4000, async (signal) => {
      const res = await fetch(`/api/approve/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as ApproveResponse;
    });
  } catch {
    return null;
  } finally {
    // Harmless if no mock stream is waiting.
    resolveMockProposal(id, body.decision);
  }
}
