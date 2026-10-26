// Edit a protocol by asking: "Set batch to 100", "Change diluent formula to batch_g * 0.4", "Add step Rinse after print",
// "Add instruction Wear gloves to step 1", "Remove step 6", "Rename step 4 to Mix 3 min". The parse is local
// (deterministic, works offline) and returns a proposed protocol; nothing applies until the approval card is approved.
// Free-form edits through the agent are the roadmap version, behind the same card.
import type { BenchProtocol, BenchStep, StepId } from "../shared/types.ts";
import { parse } from "../shared/calc.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const unquote = (s: string) => s.trim().replace(/^["“'‘]|["”'’.]$/g, "").trim();

const INSTRUMENT_WORDS: [RegExp, string][] = [
  [/oven|cure/i, "uv-oven"], [/degas|vacuum/i, "degasser"], [/mix/i, "mixer"], [/print/i, "printer-1"],
  [/visco/i, "viscometer"], [/test|pull|bend/i, "test-frame"], [/weigh|balance|pour|add/i, "balance"],
];

// Which bench drawing each instrument uses (same map as the editor's Step block).
const STATION: Record<string, StepId> = {
  balance: "weigh", mixer: "mix", degasser: "degas", viscometer: "viscosity", "printer-1": "print", "printer-2": "print", "uv-oven": "postcure", "test-frame": "test",
};

function findStep(p: BenchProtocol, ref: string): number {
  const r = norm(ref.replace(/^step\s+/i, ""));
  if (/^\d+$/.test(r)) { const i = Number(r) - 1; return i >= 0 && i < p.steps.length ? i : -1; }
  return p.steps.findIndex((s) => norm(s.title).includes(r) || r.includes(norm(s.title)));
}
const findParam = (p: BenchProtocol, ref: string) => { const r = norm(ref); return p.params.findIndex((x) => norm(x.label) === r || x.id === ref.trim() || norm(x.label).includes(r)); };
const findField = (p: BenchProtocol, ref: string) => {
  const r = norm(ref);
  for (const [si, s] of p.steps.entries()) for (const [fi, f] of s.fields.entries()) if (norm(f.label) === r || f.id === ref.trim() || norm(f.label).includes(r)) return [si, fi] as const;
  return null;
};
const clone = (p: BenchProtocol): BenchProtocol => structuredClone(p);

export function parseSopEdit(q: string, p: BenchProtocol): BenchProtocol | null {
  const t = q.trim();
  let m: RegExpMatchArray | null;

  // Formula: "change diluent formula to batch_g * 0.4" / "diluent = batch_g * 0.4"
  if ((m = t.match(/^(?:change|set|make)?\s*(?:the\s+)?(.+?)\s+(?:formula\s+)?(?:to|=)\s+(.+)$/i))) {
    const [, ref, rhs] = m;
    const field = findField(p, ref.replace(/\s+formula$/i, ""));
    const isNumber = /^-?\d*\.?\d+\s*\S*$/.test(rhs.trim());
    if (field && (!isNumber || /formula/i.test(ref))) {
      try { parse(rhs.trim()); } catch { return null; }
      const n = clone(p);
      n.steps[field[0]].fields[field[1]].formula = rhs.trim();
      return n;
    }
    // Setting: "set batch to 100", "diluent to 40%"
    const pi = findParam(p, ref);
    const num = rhs.match(/^-?\d*\.?\d+/);
    if (pi >= 0 && num) { const n = clone(p); n.params[pi].value = Number(num[0]); return n; }
  }

  // Add a step: "add step Rinse parts after print" / "add a step called Rinse before step 2"
  if ((m = t.match(/^add\s+(?:a\s+)?(?:new\s+)?step\s+(?:called\s+)?(.+?)(?:\s+(after|before)\s+(.+))?$/i))) {
    const [, title, where, ref] = m;
    let at = p.steps.length;
    if (where) { const i = findStep(p, ref); if (i < 0) return null; at = where.toLowerCase() === "after" ? i + 1 : i; }
    const prev = p.steps[Math.max(0, at - 1)];
    const instrument = INSTRUMENT_WORDS.find(([re]) => re.test(title))?.[1] ?? prev?.instrument ?? "balance";
    const step: BenchStep = {
      id: `step-${Date.now().toString(36)}`, station: STATION[instrument] ?? prev?.station ?? "weigh", instrument, title: unquote(title),
      detail: [], fields: [], get: [], put: [],
    };
    const n = clone(p);
    n.steps.splice(at, 0, step);
    return n;
  }

  // Add an instruction: "add instruction Wear gloves to step 1"
  if ((m = t.match(/^add\s+(?:an?\s+)?(?:bullet|instruction|note|line)\s+(.+?)\s+to\s+(.+)$/i))) {
    const i = findStep(p, m[2]);
    if (i < 0) return null;
    const n = clone(p);
    n.steps[i].detail.push(unquote(m[1]));
    return n;
  }

  // Remove a step: "remove step 6" / "delete the degas step"
  if ((m = t.match(/^(?:remove|delete|drop)\s+(?:the\s+)?(.+?)(?:\s+step)?$/i))) {
    const i = findStep(p, m[1]);
    if (i < 0) return null;
    const n = clone(p);
    n.steps.splice(i, 1);
    return n;
  }

  // Rename a step: "rename step 4 to Mix and check"
  if ((m = t.match(/^rename\s+(.+?)\s+to\s+(.+)$/i))) {
    const i = findStep(p, m[1]);
    if (i < 0) return null;
    const n = clone(p);
    n.steps[i].title = unquote(m[2]);
    return n;
  }
  return null;
}

/** What changed between two versions, one line each, for approval cards and the version list. */
export function diffProtocols(a: BenchProtocol, b: BenchProtocol): string[] {
  const out: string[] = [];
  for (const x of b.params) {
    const o = a.params.find((y) => y.id === x.id);
    if (!o) out.push(`Added setting ${x.label} = ${x.value} ${x.unit}`.trim());
    else if (o.value !== x.value || o.unit !== x.unit) out.push(`${x.label}: ${o.value} → ${x.value} ${x.unit}`.trim());
    else if (o.label !== x.label) out.push(`Renamed setting ${o.label} → ${x.label}`);
  }
  for (const o of a.params) if (!b.params.some((y) => y.id === o.id)) out.push(`Removed setting ${o.label}`);
  for (const [i, s] of b.steps.entries()) {
    const o = a.steps.find((y) => y.id === s.id);
    if (!o) { out.push(`Added step ${i + 1}: ${s.title}`); continue; }
    if (o.title !== s.title) out.push(`Step ${i + 1}: ${o.title} → ${s.title}`);
    if (o.instrument !== s.instrument) out.push(`Step ${i + 1} instrument: ${o.instrument} → ${s.instrument}`);
    if ((o.timer_min ?? 0) !== (s.timer_min ?? 0)) out.push(`Step ${i + 1} timer: ${o.timer_min ?? "none"} → ${s.timer_min ?? "none"} min`);
    if (!!o.photo !== !!s.photo) out.push(`Step ${i + 1}: ${s.photo ? "photo added" : "photo removed"}`);
    if (o.get.join() !== s.get.join() || o.put.join() !== s.put.join()) out.push(`Step ${i + 1}: consumables changed`);
    for (const d of s.detail) if (!o.detail.includes(d)) out.push(`Step ${i + 1} +“${d}”`);
    for (const d of o.detail) if (!s.detail.includes(d)) out.push(`Step ${i + 1} −“${d}”`);
    for (const f of s.fields) {
      const of = o.fields.find((y) => y.id === f.id);
      if (!of) out.push(`Step ${i + 1}: added ${f.label}`);
      else if (of.formula !== f.formula) out.push(`${f.label}: ${of.formula} → ${f.formula}`);
    }
    for (const f of o.fields) if (!s.fields.some((y) => y.id === f.id)) out.push(`Step ${i + 1}: removed ${f.label}`);
  }
  for (const o of a.steps) if (!b.steps.some((y) => y.id === o.id)) out.push(`Removed step: ${o.title}`);
  return out;
}
