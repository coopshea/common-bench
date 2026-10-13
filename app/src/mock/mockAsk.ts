// Replays the hero fixture with realistic timing. Like Core's server, the stream stays open while
// proposals are pending and only finishes (with `done`) after each one is approved or rejected.
import type { AskEvent, AskRequest } from "../shared/types.ts";
import { buildHeroScript } from "./heroFixture.ts";
import { prefersReducedMotion } from "../lib/hooks.ts";

type Decision = "approve" | "reject";
const decisions = new Map<string, Decision>();
const waiters = new Map<string, Array<(d: Decision) => void>>();

/** Called by the approve flow; resumes a mock stream waiting on this proposal. */
export function resolveMockProposal(id: string, decision: Decision) {
  decisions.set(id, decision);
  for (const w of waiters.get(id) ?? []) w(decision);
  waiters.delete(id);
}

function waitFor(id: string, signal: AbortSignal): Promise<Decision> {
  const known = decisions.get(id);
  if (known) return Promise.resolve(known);
  return new Promise((resolve, reject) => {
    const list = waiters.get(id) ?? [];
    list.push(resolve);
    waiters.set(id, list);
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });

export async function runMockAsk(_req: AskRequest, onEvent: (e: AskEvent) => void, signal: AbortSignal): Promise<void> {
  const script = buildHeroScript();
  // A fresh ask starts with fresh proposals.
  for (const item of script) if (item.kind === "gate") for (const id of item.ids) decisions.delete(id);
  const speed = prefersReducedMotion() ? 0.35 : 1;
  const started = performance.now();
  for (const item of script) {
    if (item.kind === "event") {
      await sleep(item.wait * speed, signal);
      onEvent(item.event);
    } else {
      const got: Record<string, Decision> = {};
      for (const id of item.ids) got[id] = await waitFor(id, signal);
      await sleep(250, signal);
      for (const e of item.after(got)) {
        onEvent(e.type === "done" ? { ...e, ms: Math.round(performance.now() - started) } : e);
        await sleep(40, signal);
      }
    }
  }
}
