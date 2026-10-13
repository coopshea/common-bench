// Offline cache: record a live /api/ask event stream with relative timings, and replay it
// with the original pacing. Replay pauses at each proposal until /api/approve/:id arrives.
//
// Files: server/cache/<slug>.json, one per question. Matched by normalized question text.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AskEvent, Proposal } from "../src/shared/types.ts";
import type { Decision } from "./agent.ts";

export const HERO_QUESTION =
  "My best is 1.55 Pa·s. I want to order DiluentX ($1,800, 6 weeks) to get under 1.5. Has anyone tried something like this?";

export const CACHE_DIR = fileURLToPath(new URL("./cache/", import.meta.url));

type Entry = { dt: number; event: AskEvent } | { dt: number; await_decision: string; decision: Decision };

export interface Recording {
  question: string;
  key: string;
  recorded_at: string;
  model: string;
  cost_usd: number;
  ms: number;
  note?: string;
  entries: Entry[];
}

export function normalizeQuestion(q: string): string {
  return q.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const slug = (key: string) => key.split(" ").slice(0, 10).join("-") || "question";

export function loadRecordings(): Recording[] {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(CACHE_DIR + f, "utf8")) as Recording];
      } catch {
        return [];
      }
    });
}

/** Exact normalized match first, then a close match (token overlap ≥ 0.8) to forgive small typos. */
export function findRecording(question: string): Recording | undefined {
  const key = normalizeQuestion(question);
  const recs = loadRecordings();
  const exact = recs.find((r) => r.key === key);
  if (exact) return exact;
  const toks = new Set(key.split(" "));
  let best: { r: Recording; s: number } | undefined;
  for (const r of recs) {
    const rt = new Set(r.key.split(" "));
    const inter = [...toks].filter((t) => rt.has(t)).length;
    const s = inter / new Set([...toks, ...rt]).size;
    if (s >= 0.8 && (!best || s > best.s)) best = { r, s };
  }
  return best?.r;
}

export function saveRecording(rec: Recording): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = `${CACHE_DIR}${slug(rec.key)}.json`;
  writeFileSync(path, JSON.stringify(rec, null, 1));
  return path;
}

/** Wraps a live run: collects events and approval decisions with relative timings. */
export function createRecorder(question: string) {
  const entries: Entry[] = [];
  let last = Date.now();
  const tick = () => {
    const now = Date.now();
    const dt = now - last;
    last = now;
    return dt;
  };
  return {
    onEvent(e: AskEvent) {
      entries.push({ dt: tick(), event: structuredClone(e) });
    },
    /** Wrap an approvals function so the wait for a person is marked, not timed. */
    wrapApprovals(fn: (p: Proposal<unknown>) => Promise<Decision>) {
      return async (p: Proposal<unknown>) => {
        const d = await fn(p);
        entries.push({ dt: tick(), await_decision: p.id, decision: d });
        return d;
      };
    },
    finish(meta: { model: string; cost_usd: number; ms: number; note?: string }): Recording {
      return {
        question,
        key: normalizeQuestion(question),
        recorded_at: new Date().toISOString(),
        ...meta,
        entries,
      };
    },
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export interface ReplayOptions {
  emit: (e: AskEvent) => void;
  /** Register a replayed proposal as pending; resolves with the person's decision. */
  waitForDecision: (p: Proposal<unknown>) => Promise<Decision>;
  signal?: AbortSignal;
  speed?: number;
  asker?: string;
}

/** Replay a recording with its original pacing; returns the ids of proposals it registered. */
export async function replay(rec: Recording, o: ReplayOptions): Promise<string[]> {
  const speed = o.speed && o.speed > 0 ? o.speed : 1;
  const run = Math.random().toString(36).slice(2, 7);
  const idMap = new Map<string, string>();
  const decisions = new Map<string, Promise<Decision>>();
  const latestByKind = new Map<string, string>(); // "ledger" | "draft" → replay proposal id
  const approver = o.asker ?? "Greeshma";

  for (const entry of rec.entries) {
    if (o.signal?.aborted) break;
    if ("await_decision" in entry) {
      const rid = idMap.get(entry.await_decision);
      if (rid) await decisions.get(rid);
      continue;
    }
    await sleep(entry.dt / speed, o.signal);
    if (o.signal?.aborted) break;
    let e = structuredClone(entry.event);
    if (e.type === "ledger_proposal" || e.type === "draft") {
      const p = e.proposal as Proposal<unknown>;
      const orig = p.id;
      if (!idMap.has(orig)) idMap.set(orig, `${orig}-r${run}`);
      const rid = idMap.get(orig)!;
      p.id = rid;
      latestByKind.set(p.kind, rid);
      if (!decisions.has(rid)) {
        p.status = "pending";
        decisions.set(rid, o.waitForDecision(structuredClone(p)));
      } else {
        const d = await decisions.get(rid)!;
        p.status = d === "approve" ? "approved" : "rejected";
      }
    } else if (e.type === "trace" && e.step.status !== "running" && (e.step.tool === "propose_ledger_update" || e.step.tool === "draft_trial")) {
      const rid = latestByKind.get(e.step.tool === "draft_trial" ? "draft" : "ledger");
      const d = rid ? await decisions.get(rid) : undefined;
      if (d) e = { ...e, step: { ...e.step, summary: d === "approve" ? `Approved by ${approver}` : "Rejected — nothing changed" } };
    } else if (e.type === "done") {
      e = { ...e, cached: true };
    }
    o.emit(e);
  }
  return [...idMap.values()];
}
