// One heard sentence applied to a trial, with no screen involved: the same rules as the trial view's own `apply`
// (pages/BenchRun.tsx), written as a plain function so a finished recording can be worked through again later
// (server/glasses-reprocess.ts). The trial view still uses its own copy; when one changes, change the other.
// `npm run test:reprocess` runs a known recording through this and checks what comes out.
import type { BenchProtocol, BenchStep } from "../shared/types.ts";
import { TOLERANCE, compute, offBy, type Entry, type RunState } from "./benchRun.ts";
import { parseUtterance, stepNamed, wordsToDigits } from "./benchSpeech.ts";

/** What the trial view remembers between sentences: the field(s) last recorded, and one waiting to be said again. */
export interface ApplyMemo { last: string[]; rerecord: string | null }
export const freshMemo = (): ApplyMemo => ({ last: [], rerecord: null });

export type Did =
  | { kind: "values"; step: number; values: Record<string, number> }
  | { kind: "note"; step: number; text: string }
  | { kind: "timer_start" | "timer_stop" | "skip" | "done" | "photo"; step: number }
  | { kind: "confirm"; ids: string[] }
  | { kind: "redo"; id: string }
  | { kind: "missed" };

export const emptyRun = (p: BenchProtocol, params: Record<string, number> = {}, name = ""): RunState =>
  ({ name, params: { ...Object.fromEntries(p.params.map((x) => [x.id, x.value])), ...params }, entries: {}, done: {}, timers: {}, photo: null, pinned: null, last: null });

/** Apply one sentence said at time `at` (ISO). Returns the trial after it, and what it did (empty when nothing). */
export function applyUtterance(proto: BenchProtocol, run: RunState, text: string, at: string, memo: ApplyMemo): { run: RunState; memo: ApplyMemo; did: Did[] } {
  const c = compute(proto, run);
  const said = text.trim();
  const named = stepNamed(text);
  const all = proto.steps.flatMap((x) => x.fields);
  const stepOfField = (id: string) => proto.steps.find((x) => x.fields.some((f) => f.id === id));
  const st: BenchStep | undefined = memo.rerecord ? stepOfField(memo.rerecord)
    : named && proto.steps[named - 1] ? proto.steps[named - 1]
    : proto.steps[c.done ? proto.steps.length - 1 : c.current];
  if (!st) return { run, memo, did: [] };
  const i = proto.steps.indexOf(st);
  const out = (next: RunState, did: Did[], m: ApplyMemo = memo) => ({ run: next, memo: m, did });
  const record = (values: Record<string, number>, by: Entry["by"] = "voice") => {
    const entries = { ...run.entries, ...Object.fromEntries(Object.entries(values).map(([id, value]) => {
      const off = offBy(value, c.target[id]);
      return [id, { value, by, at, ok: by === "typed" && !(off !== null && Math.abs(off) > TOLERANCE) }];
    })) };
    const first = Object.keys(values)[0];
    return out({ ...run, entries }, [{ kind: "values", step: proto.steps.indexOf(stepOfField(first) ?? st), values }], { last: Object.keys(values), rerecord: null });
  };

  const note = said.replace(/^(?:for\s+|on\s+)?step\s+\w+[\s,:.-]*/i, "").match(/^(?:note|notes|comment|observation|remark)(?:\s+that)?[\s:,.-]+(.+)$/i);
  if (note) {
    const t = note[1].trim().replace(/^./, (ch) => ch.toUpperCase());
    return out({ ...run, notes: { ...run.notes, [st.id]: [...(run.notes?.[st.id] ?? []), { text: t, at, by: "voice" }] } }, [{ kind: "note", step: i, text: t }]);
  }
  const CORRECT = /^(?:no|nope|sorry|scratch that|i mean|actually|correction|make that|wait)\b/i;
  if (!memo.rerecord && memo.last.length && CORRECT.test(said) && /\d/.test(wordsToDigits(said))) {
    const fixed = parseUtterance(said, all.filter((f) => memo.last.includes(f.id))).values;
    if (Object.keys(fixed).length) return record(fixed);
  }
  if (!memo.rerecord && memo.last.length && /^(?:redo|undo|wrong|scratch that|delete that|no|nope)\W*$/i.test(said)) {
    const id = memo.last[memo.last.length - 1];
    const { [id]: _, ...rest } = run.entries;
    return out({ ...run, entries: rest }, [{ kind: "redo", id }], { ...memo, rerecord: id });
  }
  // A value held for being outside the SOP's acceptance needs the word itself: a passing "okay" doesn't let it through.
  const strong = /^(?:confirm(?:ed)?|accept(?:ed)?(?: it)?|keep it)\W*$/i.test(said);
  const waiting = all.filter((f) => run.entries[f.id] && !run.entries[f.id].ok && (strong || !c.held(f.id))).map((f) => f.id);
  if (waiting.length && /^(?:confirm(?:ed)?|accept(?:ed)?(?: it)?|keep it|yes|yep|yeah|correct|that'?s right|right|looks good|good|ok|okay)\W*$/i.test(said))
    return out({ ...run, entries: { ...run.entries, ...Object.fromEntries(waiting.map((id) => [id, { ...run.entries[id], ok: true }])) } }, [{ kind: "confirm", ids: waiting }]);
  if (st.timer_min && !run.timers[st.id] && /\b(?:skip|no)\b.*\btimer\b/i.test(said)) return out({ ...run, skipped: { ...run.skipped, [st.id]: at } }, [{ kind: "skip", step: i }]);
  if (c.done && !memo.rerecord) return out(run, [{ kind: "missed" }]);
  if (st.timer_min && /\bstart(ed)?\b/i.test(text) && !run.timers[st.id]) return out({ ...run, timers: { ...run.timers, [st.id]: { start: at } } }, [{ kind: "timer_start", step: i }]);
  if (/\bstop(ped)?\b/i.test(text) && run.timers[st.id] && !run.timers[st.id].stop) {
    const t = run.timers[st.id];
    const minutes = Math.round(((new Date(at).getTime() - new Date(t.start).getTime()) / 60_000) * 2) / 2;
    const timeField = st.fields.find((f) => f.unit === "min" && !run.entries[f.id]);
    return out({
      ...run,
      timers: { ...run.timers, [st.id]: { ...t, stop: at } },
      entries: timeField ? { ...run.entries, [timeField.id]: { value: minutes, by: "timer", at, ok: false } } : run.entries,
    }, [{ kind: "timer_stop", step: i }]);
  }
  const { values, photo } = parseUtterance(text, memo.rerecord ? st.fields.filter((f) => f.id === memo.rerecord) : st.fields);
  const finished = !st.fields.length && !st.photo && /\b(done|next|finished|complete|completed|check|okay|ok)\b/i.test(text);
  let next = run, m = memo;
  const did: Did[] = [];
  if (Object.keys(values).length) { const r = record(values); next = r.run; m = r.memo; did.push(...r.did); }
  if (photo && st.photo) { next = { ...next, photo: { at } }; did.push({ kind: "photo", step: i }); }
  if (finished) { next = { ...next, done: { ...next.done, [st.id]: at } }; did.push({ kind: "done", step: i }); }
  if (!did.length) did.push({ kind: "missed" });
  // A step that completes stops its own timer, as the trial view does.
  const after = compute(proto, next);
  const open = Object.entries(next.timers).filter(([sid, t]) => !t.stop && proto.steps.some((x, k) => x.id === sid && after.stepDone(k)));
  if (open.length) next = { ...next, timers: { ...next.timers, ...Object.fromEntries(open.map(([sid, t]) => [sid, { ...t, stop: at }])) } };
  return { run: next, memo: m, did };
}
