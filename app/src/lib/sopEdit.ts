// Edit a protocol by asking, in ordinary words:
//   "make it a 100 g batch" · "double the batch" · "increase diluent to 40%" · "mix at 2500 rpm"
//   "add a step to rinse the parts after printing" · "move step 3 before step 2" · "delete the last step"
//   "add a 5 minute timer to step 4" · "add a note to step 1: wear gloves" · "add 5 g of pigment to step 2"
//   "add a setting called temperature = 25 C" · "step 4 should use the mixer" · "add a photo to step 5"
// The parse is local (deterministic, works offline) and returns a proposed protocol; nothing applies until the
// approval card is approved. Free-form edits through the agent are the roadmap version, behind the same card.
import type { BenchField, BenchProtocol, BenchStep, StepId } from "../shared/types.ts";
import { parse } from "../shared/calc.ts";
import { saidUnit } from "./benchSpeech.ts";
import { INSTRUMENT_WORDS, minutesIn } from "./sopLibrary.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const unquote = (s: string) => s.trim().replace(/^["“'‘]|["”'’.]$/g, "").trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Which bench drawing each instrument uses (same map as the editor's Step block).
const STATION: Record<string, StepId> = {
  balance: "weigh", mixer: "mix", degasser: "degas", viscometer: "viscosity", "printer-1": "print", "printer-2": "print", "uv-oven": "postcure", "test-frame": "test",
};
const instrumentNamed = (s: string) => INSTRUMENT_WORDS.find(([re]) => re.test(s))?.[1];

const STOP = new Set(["the", "a", "an", "of", "to", "at", "in", "on", "for", "my", "our", "this", "that", "step", "setting", "amount", "value", "size"]);
const words = (s: string) => norm(s).split(" ").filter((w) => w && !STOP.has(w));
const alike = (a: string, b: string) => a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b)) || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));
/** How many of the words asked for appear in a name. */
const overlap = (ref: string, name: string) => { const n = words(name); return words(ref).filter((w) => n.some((x) => alike(w, x))).length; };
/** The one best match by words, with the unit breaking ties; null when nothing matches or it is a toss-up. */
function pick<T>(items: T[], ref: string, name: (x: T) => string, unitOf: (x: T) => string, unit?: string): number {
  const all = words(ref).length;
  const scored = items.map((x, i) => {
    const k = overlap(ref, name(x));
    // Exact name beats a partial one; the unit said ("rpm") breaks a tie between "Mix speed" and "Mix time".
    return { i, k: k === 0 ? 0 : k * 10 + (k === all && k === words(name(x)).length ? 5 : 0) + (unit && unitOf(x) === unit ? 2 : 0) };
  }).filter((x) => x.k > 0).sort((a, b) => b.k - a.k);
  return scored.length && (scored.length === 1 || scored[0].k > scored[1].k) ? scored[0].i : -1;
}

function findStep(p: BenchProtocol, ref: string): number {
  const r = norm(ref.replace(/^(?:the\s+)?step\s+/i, "").replace(/\s+step$/i, "").replace(/^the\s+/i, ""));
  if (!r) return -1;
  if (/^\d+$/.test(r)) { const i = Number(r) - 1; return i >= 0 && i < p.steps.length ? i : -1; }
  if (/^(last|final|end)( one)?$/.test(r)) return p.steps.length - 1;
  if (/^(first|1st)( one)?$/.test(r)) return p.steps.length ? 0 : -1;
  const ord = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"].indexOf(r);
  if (ord >= 0) return ord < p.steps.length ? ord : -1;
  const exact = p.steps.findIndex((s) => norm(s.title) === r);
  if (exact >= 0) return exact;
  const inc = p.steps.findIndex((s) => norm(s.title).includes(r) || r.includes(norm(s.title)));
  return inc >= 0 ? inc : pick(p.steps, ref, (s) => s.title, () => "");
}
const findParam = (p: BenchProtocol, ref: string, unit?: string) => {
  const exact = p.params.findIndex((x) => x.id === ref.trim() || norm(x.label) === norm(ref));
  return exact >= 0 ? exact : pick(p.params, ref, (x) => `${x.label} ${x.id.replace(/_/g, " ")}`, (x) => x.unit, unit);
};
const findField = (p: BenchProtocol, ref: string, unit?: string) => {
  const flat = p.steps.flatMap((s, si) => s.fields.map((f, fi) => ({ f, at: [si, fi] as const })));
  const exact = flat.find(({ f }) => f.id === ref.trim() || norm(f.label) === norm(ref));
  if (exact) return exact.at;
  const i = pick(flat, ref, (x) => x.f.label, (x) => x.f.unit, unit);
  return i >= 0 ? flat[i].at : null;
};
const clone = (p: BenchProtocol): BenchProtocol => structuredClone(p);
const unitSaid = (u: string | undefined) => { const w = (u ?? "").trim().replace(/[.,]$/, ""); return w ? saidUnit(w.toLowerCase()) ?? w : ""; };
const NUM = String.raw`(-?\d*\.?\d+)`;
const DUR = String.raw`(\d*\.?\d+)[\s-]*(seconds?|secs?|s|minutes?|mins?|min|hours?|hrs?|h)?`;
const minutes = (n: string, u?: string) => { const v = Number(n), w = (u ?? "min").toLowerCase(); return Math.round((w.startsWith("h") ? v * 60 : w.startsWith("s") ? v / 60 : v) * 100) / 100; };
const freshId = (p: BenchProtocol, label: string) => {
  const taken = new Set([...p.params.map((x) => x.id), ...p.steps.flatMap((s) => s.fields.map((f) => f.id))]);
  const base = norm(label).replace(/ /g, "_").replace(/^(\d)/, "_$1") || "value";
  let id = base, k = 2;
  while (taken.has(id)) id = `${base}_${k++}`;
  return id;
};
const re = (src: string) => new RegExp(src, "i");

export function parseSopEdit(q: string, p: BenchProtocol): BenchProtocol | null {
  const t = q.trim().replace(/^(?:please|can you|could you|let'?s|i want to|i'd like to|we should|you should)\s+/i, "").replace(/\s+please$/i, "").replace(/[.!?]+$/, "").trim();
  let m: RegExpMatchArray | null;
  const edit = (fn: (n: BenchProtocol) => void) => { const n = clone(p); fn(n); return n; };
  const step = (ref: string) => findStep(p, ref);

  // ----- Order: "swap steps 2 and 3", "move step 3 before step 2", "move degas to the end" -----
  if ((m = t.match(/^swap\s+(?:steps?\s+)?(.+?)\s+(?:and|with)\s+(.+)$/i))) {
    const a = step(m[1]), b = step(m[2]);
    return a < 0 || b < 0 || a === b ? null : edit((n) => { [n.steps[a], n.steps[b]] = [n.steps[b], n.steps[a]]; });
  }
  if ((m = t.match(/^(?:move|put|do)\s+(.+?)\s+(before|after|above|below|to the|at the)\s+(.+)$/i))) {
    const from = step(m[1]), how = m[2].toLowerCase();
    if (from < 0) return null;
    let to: number;
    if (how.endsWith("the")) { if (/^(end|bottom|last)/i.test(m[3])) to = p.steps.length - 1; else if (/^(start|beginning|top|front)/i.test(m[3])) to = 0; else return null; }
    else { const ref = step(m[3]); if (ref < 0 || ref === from) return null; const after = how === "after" || how === "below"; to = (after ? ref + 1 : ref) - (from < ref ? 1 : 0); }
    return edit((n) => { const [s] = n.steps.splice(from, 1); n.steps.splice(to, 0, s); });
  }

  // ----- Timers: "add a 5 minute timer to step 4", "set timer on degas to 15 min", "remove the timer from step 4" -----
  if ((m = t.match(/^(?:remove|delete|drop|clear|no)\s+(?:the\s+)?timer\s+(?:from|on|of|for|in)\s+(.+)$/i))) {
    const i = step(m[1]);
    return i < 0 ? null : edit((n) => { delete n.steps[i].timer_min; });
  }
  if (/\btimer\b/i.test(t)) {
    let ref: string | undefined, d: string | undefined, u: string | undefined;
    if ((m = t.match(re(`^(?:add|set|put|give|start|use)?\\s*(?:an?\\s+|the\\s+)?${DUR}\\s+timer\\s+(?:to|on|for|in|at)\\s+(.+)$`)))) [, d, u, ref] = m;
    else if ((m = t.match(re(`^(?:add|set|change|make|put)?\\s*(?:an?\\s+|the\\s+)?timer\\s+(?:on|for|of|in|to|at)\\s+(.+?)\\s+(?:to|=|at|of|for)\\s+${DUR}$`)))) [, ref, d, u] = m;
    else if ((m = t.match(re(`^(?:set\\s+|change\\s+)?(?:the\\s+)?(.+?)\\s+timer\\s+(?:to\\s+|=\\s*|at\\s+)?${DUR}$`)))) [, ref, d, u] = m;
    const i = ref ? step(ref) : -1;
    if (i >= 0 && d) return edit((n) => { n.steps[i].timer_min = minutes(d!, u); });
  }

  // ----- Photos: "add a photo to step 5", "remove the photo from print" -----
  if ((m = t.match(/^(?:add|take|require|need)\s+(?:an?\s+)?(?:photo|picture)\s+(?:to|on|in|at|after|for|of)\s+(.+)$/i))) {
    const i = step(m[1]);
    return i < 0 ? null : edit((n) => { n.steps[i].photo = true; });
  }
  if ((m = t.match(/^(?:remove|delete|drop|no)\s+(?:the\s+)?(?:photo|picture)(?:\s+(?:from|on|in|of|at)\s+(.+))?$/i))) {
    const i = m[1] ? step(m[1]) : p.steps.findIndex((s) => s.photo);
    return i < 0 ? null : edit((n) => { delete n.steps[i].photo; });
  }

  // ----- Instrument: "change the instrument of step 2 to mixer", "step 4 should use the mixer", "do step 2 on the mixer" -----
  if ((m = t.match(/^(?:change|set|switch)\s+(?:the\s+)?instrument\s+(?:of|for|on|in)\s+(.+?)\s+to\s+(?:the\s+)?(.+)$/i))
    ?? (m = t.match(/^((?:the\s+)?step\s+\S+|the\s+.+?\s+step)\s+(?:should\s+|must\s+)?(?:use|uses|happens\s+(?:at|on)|is\s+(?:at|on|done\s+(?:at|on))|on|at)\s+(?:the\s+)?(.+)$/i))
    ?? (m = t.match(/^(?:do|run)\s+(.+?)\s+(?:on|at|in|with)\s+(?:the\s+)?(.+)$/i))) {
    const i = step(m[1]), inst = instrumentNamed(m[2]);
    if (i >= 0 && inst) return edit((n) => { n.steps[i].instrument = inst; n.steps[i].station = STATION[inst] ?? n.steps[i].station; });
  }

  // ----- A new setting: "add a setting called temperature = 25 C" -----
  if ((m = t.match(re(`^add\\s+(?:an?\\s+)?(?:new\\s+)?(?:setting|parameter|param|variable)\\s+(?:called\\s+|named\\s+|for\\s+)?(.+?)\\s*(?:=|:|\\s+of|\\s+at|\\s+to|\\s+is|\\s)\\s*${NUM}\\s*(\\S+)?$`)))) {
    const label = cap(unquote(m[1])), value = Number(m[2]), unit = unitSaid(m[3]);
    return edit((n) => { n.params.push({ id: freshId(p, label), label, value, unit }); });
  }

  // ----- A new amount to record: "add amount 5 g of pigment to step 2", "add 5 g of pigment to step 2", "add amount Pigment = batch_g * 0.01 to step 2" -----
  const amount = t.match(/^add\s+(?:an?\s+)?(?:new\s+)?(?:amount|measurement|field|reading|value)\s+(?:called\s+|named\s+|for\s+|of\s+)?(.+)$/i)?.[1] ?? (/^add\s+-?\d*\.?\d+\s*\S*\s+(?:of\s+)?\S/i.test(t) ? t.replace(/^add\s+/i, "") : null);
  if (amount) {
    const where = amount.match(/^(.+?)\s+(?:to|in|on|under|at)\s+((?:the\s+)?step\s+\S+|the\s+.+?\s+step|.+)$/i);
    const i = where && step(where[2]) >= 0 ? step(where[2]) : -1;
    const body = (i >= 0 ? where![1] : amount).trim();
    const at = i >= 0 ? i : p.steps.length - 1;
    if (at < 0) return null;
    let f: BenchField | null = null, x: RegExpMatchArray | null;
    if ((x = body.match(/^(.+?)\s*=\s*(.+?)$/))) {
      const u = x[2].match(/^(.*\S)\s+(g|mg|kg|mL|ml|L|µL|rpm|min|s|h|%|°C|C|mm|cm)$/);
      const formula = (u ? u[1] : x[2]).trim();
      try { parse(formula); } catch { return null; }
      f = { id: freshId(p, x[1]), label: cap(unquote(x[1])), unit: u ? unitSaid(u[2]) : "", formula };
    } else if ((x = body.match(re(`^${NUM}\\s*(\\S+?)?\\s+(?:of\\s+)?(?:the\\s+)?(.+)$`)))) f = { id: freshId(p, x[3]), label: cap(unquote(x[3])), unit: unitSaid(x[2]), formula: x[1] };
    else if ((x = body.match(re(`^(.+?)\\s+${NUM}\\s*(\\S+)?$`)))) f = { id: freshId(p, x[1]), label: cap(unquote(x[1])), unit: unitSaid(x[3]), formula: x[2] };
    if (f) return edit((n) => { n.steps[at].fields.push(f!); });
  }

  // ----- A new step: "add a step to rinse the parts after printing", "add step: preheat oven before step 1", "add step Soak for 10 min at the end" -----
  if ((m = t.match(/^(?:add|insert|new)\s+(?:an?\s+)?(?:new\s+|another\s+)?step\s*[:\-–,]?\s*(?:called\s+|named\s+|to\s+|for\s+|where\s+(?:we|i|you)\s+)?(.+)$/i))) {
    let title = m[1].trim(), at = p.steps.length, x: RegExpMatchArray | null;
    if ((x = title.match(/^(.+?)\s+(?:at|to)\s+the\s+(end|bottom|start|beginning|top)$/i))) { title = x[1]; if (!/end|bottom/i.test(x[2])) at = 0; }
    else if ((x = title.match(/^(.+)\s+(after|before)\s+(.+)$/i)) && step(x[3]) >= 0) { title = x[1]; const i = step(x[3]); at = x[2].toLowerCase() === "after" ? i + 1 : i; }
    else if ((x = title.match(/^(.+?)\s+(first|last)$/i))) { title = x[1]; if (x[2].toLowerCase() === "first") at = 0; }
    title = cap(unquote(title));
    if (!title) return null;
    const prev = p.steps[Math.max(0, at - 1)];
    const instrument = instrumentNamed(title) ?? prev?.instrument ?? "balance";
    const s: BenchStep = { id: `step-${Date.now().toString(36)}`, station: STATION[instrument] ?? prev?.station ?? "weigh", instrument, title, detail: [], fields: [], get: [], put: [] };
    const timer = minutesIn(title);
    if (timer) s.timer_min = timer;
    return edit((n) => { n.steps.splice(at, 0, s); });
  }

  // ----- An instruction: "add a note to step 1: wear gloves", "in step 1, add wear gloves", "add wear gloves to step 1" -----
  {
    let ref: string | undefined, text: string | undefined;
    const NOTE = String.raw`(?:bullet|instruction|note|line|reminder|warning|tip)`;
    if ((m = t.match(re(`^add\\s+(?:an?\\s+)?${NOTE}\\s+(?:to|on|in|for|under)\\s+(.+?)\\s*(?:[:\\-–]|\\s+(?:saying|that says|to))\\s*(.+)$`)))) [, ref, text] = m;
    else if ((m = t.match(re(`^add\\s+(?:an?\\s+)?${NOTE}\\s*[:\\-–]?\\s*(.+)\\s+(?:to|on|in|for|under)\\s+(.+)$`)))) [, text, ref] = m;
    else if ((m = t.match(/^(?:in|on|for|under|at)\s+(.+?)\s*[,:]\s*(?:add|note|say|write|remind\s+(?:me|us)\s+to)\s+(?:an?\s+)?(?:note\s+|instruction\s+)?(?:to\s+|that\s+)?(.+)$/i))) [, ref, text] = m;
    else if ((m = t.match(/^add\s+(.+)\s+(?:to|in|under)\s+((?:the\s+)?step\s+\S+|the\s+.+?\s+step)$/i))) [, text, ref] = m;
    if (ref && text) { const i = step(ref); if (i >= 0) return edit((n) => { n.steps[i].detail.push(cap(unquote(text!))); }); }
  }

  // ----- Remove: "remove step 6", "delete the last step", "remove the degas step", "remove the pigment amount", "remove setting temperature" -----
  if ((m = t.match(/^(?:remove|delete|drop|get rid of|take out|skip)\s+(?:the\s+)?(setting|parameter|variable|amount|measurement|field)?\s*(.+?)(?:\s+(setting|parameter|amount|measurement|field|step))?$/i))) {
    const kind = (m[1] ?? m[3] ?? "").toLowerCase(), ref = m[2];
    const isStep = !kind || kind === "step", isParam = /setting|param|variable/.test(kind), isField = /amount|measure|field/.test(kind);
    const i = isStep ? step(ref) : -1;
    if (i >= 0) return edit((n) => { n.steps.splice(i, 1); });
    const f = isParam ? null : findField(p, ref);
    if (f && (isField || !kind)) return edit((n) => { n.steps[f[0]].fields.splice(f[1], 1); });
    const pi = isField ? -1 : findParam(p, ref);
    if (pi >= 0 && (isParam || !kind)) return edit((n) => { n.params.splice(pi, 1); });
    return null;
  }

  // ----- Rename: "rename step 4 to Mix and check", "rename diluent to Thinner", "call step 2 Thin it" -----
  if ((m = t.match(/^(?:rename|retitle)\s+(.+?)\s+(?:to|as)\s+(.+)$/i)) ?? (m = t.match(/^call\s+((?:the\s+)?step\s+\S+)\s+(.+)$/i))) {
    const name = cap(unquote(m[2]));
    // A setting or amount named exactly wins over a step that merely mentions it ("diluent" vs "Add diluent").
    const exactly = (label: string) => norm(label) === norm(m![1]);
    const named = /\bstep\b/i.test(m[1]) || !(p.params.some((x) => exactly(x.label)) || p.steps.some((s) => s.fields.some((f) => exactly(f.label))));
    const i = named ? step(m[1]) : -1;
    if (i >= 0) return edit((n) => { n.steps[i].title = name; });
    const pi = findParam(p, m[1]);
    if (pi >= 0) return edit((n) => { n.params[pi].label = name; });
    const f = findField(p, m[1]);
    return f ? edit((n) => { n.steps[f[0]].fields[f[1]].label = name; }) : null;
  }

  // ----- Numbers. A setting changes its value; an amount that is a plain number changes too. -----
  const setValue = (ref: string, value: (old: number) => number, unit?: string) => {
    const r = ref.replace(/\s+(?:at|to|of|is|=)$/i, "").replace(/^(?:the|a|an)\s+/i, "");
    const pi = findParam(p, r, unit);
    if (pi >= 0) return edit((n) => { n.params[pi].value = Math.round(value(p.params[pi].value) * 1e6) / 1e6; });
    const f = findField(p, r, unit);
    if (f && /^\s*-?\d*\.?\d+\s*$/.test(p.steps[f[0]].fields[f[1]].formula))
      return edit((n) => { n.steps[f[0]].fields[f[1]].formula = String(Math.round(value(Number(p.steps[f[0]].fields[f[1]].formula)) * 1e6) / 1e6); });
    // No name matched, but only one thing here is measured in that unit: "stir at 350 rpm" → the one rpm value.
    if (unit) {
      const ps = p.params.filter((x) => x.unit === unit);
      const fs = p.steps.flatMap((s, si) => s.fields.map((x, fi) => ({ x, si, fi }))).filter(({ x }) => x.unit === unit && /^\s*-?\d*\.?\d+\s*$/.test(x.formula));
      if (ps.length === 1 && !fs.length) return edit((n) => { const x = n.params.find((y) => y.id === ps[0].id)!; x.value = Math.round(value(x.value) * 1e6) / 1e6; });
      if (fs.length === 1 && !ps.length) return edit((n) => { const x = n.steps[fs[0].si].fields[fs[0].fi]; x.formula = String(Math.round(value(Number(x.formula)) * 1e6) / 1e6); });
    }
    return null;
  };
  if ((m = t.match(/^(double|triple|halve|half|quadruple)\s+(?:the\s+)?(.+)$/i))) {
    const k = { double: 2, triple: 3, quadruple: 4, halve: 0.5, half: 0.5 }[m[1].toLowerCase()]!;
    return setValue(m[2], (v) => v * k);
  }
  if ((m = t.match(re(`^(increase|raise|bump|up|decrease|lower|reduce|drop|cut)\\s+(?:the\\s+)?(.+?)\\s+by\\s+${NUM}\\s*(%|percent)?(?:\\s*\\S+)?$`)))) {
    const up = /increase|raise|bump|up/i.test(m[1]), d = Number(m[3]);
    return setValue(m[2], (v) => (m![4] ? v * (1 + (up ? d : -d) / 100) : v + (up ? d : -d)));
  }
  // A formula: "change diluent formula to batch_g * 0.4" / "diluent = batch_g * 0.4"
  if ((m = t.match(/^(?:change|set|make)?\s*(?:the\s+)?(.+?)\s+(?:formula\s+)?(?:to|=)\s+(.+)$/i))) {
    const [, ref, rhs] = m;
    const isNumber = /^-?\d*\.?\d+\s*\S*$/.test(rhs.trim());
    const field = !isNumber || /formula/i.test(ref) ? findField(p, ref.replace(/\s+formula$/i, "")) : null;
    if (field) {
      try { parse(rhs.trim()); } catch { return null; }
      return edit((n) => { n.steps[field[0]].fields[field[1]].formula = rhs.trim(); });
    }
  }
  const VERB = String.raw`(?:change|set|make|increase|raise|bump|decrease|lower|reduce|drop|update|use|put)`;
  // "set batch to 100", "increase diluent to 40%", "change batch size to 100g", "mix time should be 3 minutes"
  if ((m = t.match(re(`^${VERB}?\\s*(?:the\\s+)?(.+?)\\s+(?:to|=|at|is|should be|up to|down to)\\s+${NUM}\\s*(\\S+)?$`)))) { const r = setValue(m[1], () => Number(m![2]), unitSaid(m[3])); if (r) return r; }
  // "make it a 100 g batch", "use a 40 % diluent"
  if ((m = t.match(re(`^(?:make it|make|use|do|run)\\s+(?:an?\\s+)?${NUM}\\s*(\\S+?)?\\s+(.+)$`)))) { const r = setValue(m[3], () => Number(m![1]), unitSaid(m[2])); if (r) return r; }
  // "diluent 40", "mix at 2500 rpm", "batch 100 g"
  if ((m = t.match(re(`^${VERB}?\\s*(?:the\\s+)?(.+?)\\s+${NUM}\\s*(\\S+)?$`)))) { const r = setValue(m[1], () => Number(m![2]), unitSaid(m[3])); if (r) return r; }
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
    if ((o.timer_min ?? 0) !== (s.timer_min ?? 0)) out.push(`Step ${i + 1} timer: ${o.timer_min ? `${o.timer_min} min` : "none"} → ${s.timer_min ? `${s.timer_min} min` : "none"}`);
    if (!!o.photo !== !!s.photo) out.push(`Step ${i + 1}: ${s.photo ? "photo added" : "photo removed"}`);
    if (o.get.join() !== s.get.join() || o.put.join() !== s.put.join()) out.push(`Step ${i + 1}: consumables changed`);
    for (const d of s.detail) if (!o.detail.includes(d)) out.push(`Step ${i + 1} +“${d}”`);
    for (const d of o.detail) if (!s.detail.includes(d)) out.push(`Step ${i + 1} −“${d}”`);
    for (const f of s.fields) {
      const of = o.fields.find((y) => y.id === f.id);
      if (!of) out.push(`Step ${i + 1}: added ${f.label}`);
      else if (of.formula !== f.formula) out.push(`${f.label}: ${of.formula} → ${f.formula}`);
      else if (of.label !== f.label) out.push(`Renamed ${of.label} → ${f.label}`);
    }
    for (const f of o.fields) if (!s.fields.some((y) => y.id === f.id)) out.push(`Step ${i + 1}: removed ${f.label}`);
  }
  for (const o of a.steps) if (!b.steps.some((y) => y.id === o.id)) out.push(`Removed step: ${o.title}`);
  const kept = (x: BenchProtocol, y: BenchProtocol) => x.steps.filter((s) => y.steps.some((z) => z.id === s.id)).map((s) => s.id).join();
  if (kept(a, b) !== kept(b, a)) out.push(`New order: ${b.steps.map((s) => s.title).join(" → ")}`);
  return out;
}
