// Notebook API (Hono on :8787). Run: npm run dev:api
//
//   POST /api/ask           AskRequest → NDJSON stream of AskEvent (one JSON object per line).
//                           Live agent when a key is set and the API is reachable; otherwise, or with
//                           { cached: true }, replays a recorded run with its original pacing.
//                           The stream stays open while proposals are pending.
//   POST /api/approve/:id   ApproveRequest → ApproveResponse. Applies the change, releases the agent.
//   GET  /api/health        HealthResponse
//   GET  /api/ledger        { ledger, drafts }  current in-memory state (extra, for the UI)
//   POST /api/reset         restore the seed ledger and clear drafts (extra, for rehearsals)
//
// Env: ANTHROPIC_API_KEY (from .env.local), NOTEBOOK_OFFLINE=1 (force cache), RECORD_CACHE=1
// (save each clean live run to server/cache/), REPLAY_SPEED (default 1), PORT (default 8787).

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve, type HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import type { ApproveRequest, ApproveResponse, AskEvent, AskRequest, HealthResponse, PersonId } from "../src/shared/types.ts";
import { AgentUnavailableError, apiKeyPresent, DEFAULT_MODEL, runAgent } from "./agent.ts";
import { cancel, decide, waitForDecision } from "./approvals.ts";
import { createRecorder, findRecording, loadRecordings, replay, saveRecording } from "./cache.ts";
import { getDrafts, getLedger, notebook, person, resetState } from "./notebook.ts";

const PORT = Number(process.env.PORT ?? 8787);
const FORCE_OFFLINE = process.env.NOTEBOOK_OFFLINE === "1";
const RECORD = process.env.RECORD_CACHE === "1";
const REPLAY_SPEED = Number(process.env.REPLAY_SPEED ?? 1);
const PEOPLE = notebook.people.map((p) => p.id);

// Is the API reachable? Cached briefly so a flaky network doesn't add a second to every ask.
let onlineCache: { at: number; ok: boolean } | null = null;
async function apiReachable(): Promise<boolean> {
  if (onlineCache && Date.now() - onlineCache.at < 20_000) return onlineCache.ok;
  let ok = false;
  try {
    await fetch("https://api.anthropic.com/v1/models", { method: "HEAD", signal: AbortSignal.timeout(2500) });
    ok = true; // any HTTP response means the network path works
  } catch {
    ok = false;
  }
  onlineCache = { at: Date.now(), ok };
  return ok;
}

const app = new Hono<{ Bindings: HttpBindings }>();
app.use("/api/*", cors());

app.get("/api/health", async (c) => {
  const live = apiKeyPresent() && !FORCE_OFFLINE && (await apiReachable());
  const body: HealthResponse = { live, model: DEFAULT_MODEL, cached_questions: loadRecordings().map((r) => r.question) };
  return c.json(body);
});

app.get("/api/ledger", (c) => c.json({ ledger: getLedger(), drafts: getDrafts() }));

app.post("/api/reset", (c) => {
  resetState();
  return c.json({ ok: true, ledger: getLedger(), drafts: getDrafts() });
});

app.post("/api/approve/:id", async (c) => {
  const id = c.req.param("id");
  let body: Partial<ApproveRequest> = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body → approve as the default asker */
  }
  const decision = body.decision === "reject" ? "reject" : "approve";
  const by: PersonId = body.by && PEOPLE.includes(body.by) ? body.by : "shreya";
  const r = decide(id, decision, by);
  if (!r.found) {
    const res: ApproveResponse = { ok: false, proposal_id: id, status: "rejected" };
    return c.json({ ...res, error: "No pending proposal with that id (it may have timed out or belong to a closed stream)." }, 404);
  }
  const res: ApproveResponse = {
    ok: r.status === (decision === "approve" ? "approved" : "rejected"),
    proposal_id: id,
    status: r.status!,
    ...(r.ledger ? { ledger: r.ledger } : {}),
    ...(r.draft ? { draft: r.draft } : {}),
  };
  console.log(`[approve] ${id} → ${res.status} by ${by}`);
  return c.json(res);
});

app.post("/api/ask", async (c) => {
  let req: Partial<AskRequest> & { model?: string };
  try {
    req = await c.req.json();
  } catch {
    return c.json({ error: "Body must be JSON: { question, asker, cached? }" }, 400);
  }
  const question = (req.question ?? "").trim();
  if (!question) return c.json({ error: "question is required" }, 400);
  const asker: PersonId = req.asker && PEOPLE.includes(req.asker) ? req.asker : "shreya";
  const model = typeof req.model === "string" && /^claude-[a-z0-9-]+$/.test(req.model) ? req.model : undefined;

  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");

  return stream(c, async (s) => {
    // Client went away → stop the agent and reject its pending cards. The socket close is the
    // reliable signal: the stream can sit idle for minutes while a card waits for approval.
    const ac = new AbortController();
    s.onAbort(() => ac.abort());
    const outgoing = c.env?.outgoing;
    outgoing?.on("close", () => {
      if (!outgoing.writableFinished) ac.abort();
    });
    const proposalIds = new Set<string>();
    ac.signal.addEventListener("abort", () => {
      cancel([...proposalIds]);
      console.log(`[ask] client disconnected; stopped (${question.slice(0, 50)})`);
    });
    let chain = Promise.resolve();
    const write = (e: AskEvent) => {
      if (e.type === "ledger_proposal" || e.type === "draft") proposalIds.add(e.proposal.id);
      chain = chain.then(() => s.write(`${JSON.stringify(e)}\n`).then(() => undefined)).catch(() => undefined);
    };

    const rec = findRecording(question);
    const doReplay = async (why: string) => {
      console.log(`[ask] replay (${why}): ${question.slice(0, 70)}`);
      const ids = await replay(rec!, {
        emit: write,
        waitForDecision: (p) => waitForDecision(p),
        signal: ac.signal,
        speed: REPLAY_SPEED,
        asker: person(asker).name,
      });
      if (ac.signal.aborted) cancel(ids);
    };

    try {
      const offlineReason = req.cached
        ? "cached requested"
        : FORCE_OFFLINE
          ? "NOTEBOOK_OFFLINE=1"
          : !apiKeyPresent()
            ? "no API key"
            : !(await apiReachable())
              ? "API unreachable"
              : null;
      if (offlineReason) {
        if (rec) await doReplay(offlineReason);
        else {
          write({ type: "error", message: `The agent is offline (${offlineReason}) and there's no recorded answer for this question.` });
          write({ type: "done", cached: true });
        }
        return;
      }

      console.log(`[ask] live (${model ?? DEFAULT_MODEL}): ${question.slice(0, 70)}`);
      const recorder = RECORD ? createRecorder(question) : null;
      const onEvent = (e: AskEvent) => {
        recorder?.onEvent(e);
        write(e);
      };
      const ask = (p: Parameters<typeof waitForDecision>[0]) => waitForDecision(p);
      try {
        const res = await runAgent({
          question,
          asker,
          model,
          approvals: recorder ? recorder.wrapApprovals(ask) : ask,
          onEvent,
          signal: ac.signal,
        });
        console.log(`[ask] done in ${(res.ms / 1000).toFixed(1)} s, $${res.cost_usd.toFixed(4)}, ${res.tool_calls.length} tool calls`);
        if (recorder && !res.events.some((e) => e.type === "error")) {
          const path = saveRecording(recorder.finish({ model: res.model, cost_usd: res.cost_usd, ms: res.ms }));
          console.log(`[ask] recorded → ${path}`);
        }
      } catch (e) {
        if (e instanceof AgentUnavailableError && rec && !ac.signal.aborted) {
          await doReplay(`live failed: ${e.message}`);
        } else if (!ac.signal.aborted) {
          console.error(`[ask] error: ${e instanceof Error ? e.message : String(e)}`);
          write({ type: "error", message: e instanceof Error ? e.message : String(e) });
          write({ type: "done", cached: false });
        }
      }
    } finally {
      if (ac.signal.aborted) cancel([...proposalIds]);
      await chain;
    }
  });
});

// Production (npm start, e.g. on Railway): serve the built UI from dist/ on the same port as the API.
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
if (existsSync(DIST)) {
  app.use("/*", serveStatic({ root: DIST }));
  app.get("*", serveStatic({ root: DIST, path: "index.html" }));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  const n = loadRecordings().length;
  console.log(
    `notebook api on http://localhost:${info.port} · key ${apiKeyPresent() ? "present" : "missing"}${FORCE_OFFLINE ? " · OFFLINE forced" : ""} · ${n} cached question${n === 1 ? "" : "s"}${RECORD ? " · recording live runs" : ""}`,
  );
});
