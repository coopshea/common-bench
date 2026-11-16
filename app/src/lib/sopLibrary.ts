// Your own SOPs, next to the seeded ones: start blank, paste the steps you already have, or duplicate an SOP.
// Saved on this device (localStorage), like trials and versions. Server storage and sharing: issue #9.
// Pasted text is read locally (deterministic, offline): numbered or plain lines become steps, bullets become a step's
// instructions, a time ("5 min") becomes the step's timer, and an amount ("30 g of monomer") becomes a value to record.
import { useSyncExternalStore } from "react";
import type { BenchField, BenchProtocol, BenchStep, PersonId, StepId } from "../shared/types.ts";
import { notebook } from "../data/notebook.ts";

const KEY = "common-bench:sops:v1";
const seeded = notebook.bench ?? [];

let custom: BenchProtocol[] = load();
let all: BenchProtocol[] = [...seeded, ...custom];
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

function load(): BenchProtocol[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string" && Array.isArray(p.steps) && Array.isArray(p.params)) : []; } catch { return []; }
}
function commit(next: BenchProtocol[]) {
  custom = next;
  all = [...seeded, ...custom];
  try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch { /* private window or full: keep working in memory */ }
  listeners.forEach((l) => l());
}

/** Every SOP: the seeded ones, then the ones made on this device. */
export const useProtocols = () => useSyncExternalStore(subscribe, () => all);
export const isCustom = (id: string) => custom.some((p) => p.id === id);
export const addProtocol = (p: BenchProtocol) => commit([...custom, p]);
export const removeProtocol = (id: string) => commit(custom.filter((p) => p.id !== id));
export const renameProtocol = (id: string, title: string) => commit(custom.map((p) => (p.id === id ? { ...p, title } : p)));

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const newId = (title: string) => {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "sop";
  return `${slug}-${Date.now().toString(36).slice(-5)}`;
};

/** A copy of an SOP as it stands now, owned by whoever copied it. */
export function duplicateProtocol(p: BenchProtocol, by: PersonId): BenchProtocol {
  const copy: BenchProtocol = { ...structuredClone(p), id: newId(p.title), title: `${p.title} copy`, runner: by, uploaded: today(), last_run: null, next_run: "1", script: [] };
  addProtocol(copy);
  return copy;
}

// ---------- Pasted text → protocol ----------

// Which instrument a step most likely happens at, from its words (the same guesses as "Add step …" in the editor).
export const INSTRUMENT_WORDS: [RegExp, string][] = [
  [/oven|cure|bake/i, "uv-oven"], [/degas|vacuum/i, "degasser"], [/mix|stir|blend/i, "mixer"], [/print/i, "printer-1"],
  [/visco/i, "viscometer"], [/test|pull|bend/i, "test-frame"], [/weigh|balance|pour|add/i, "balance"],
];
const STATION: Record<string, StepId> = {
  balance: "weigh", mixer: "mix", degasser: "degas", viscometer: "viscosity", "printer-1": "print", "printer-2": "print", "uv-oven": "postcure", "test-frame": "test",
};

const TIME = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|seconds?|secs?|s)(?![A-Za-z])/i;
const AMOUNT = /(\d+(?:\.\d+)?)\s*(mg|kg|g|mL|ml|µL|uL|ul|L|°C|°F|rpm|%|mm|cm|psi|bar|mM|µM|uM|M)(?![A-Za-z])/g;
const NOUN: Record<string, string> = { g: "Mass", mg: "Mass", kg: "Mass", ml: "Volume", "µl": "Volume", ul: "Volume", l: "Volume", "°c": "Temperature", "°f": "Temperature", rpm: "Speed", "%": "Percent", mm: "Length", cm: "Length", psi: "Pressure", bar: "Pressure" };
const nounOf = (unit: string) => (/M$/.test(unit) ? "Concentration" : NOUN[unit.toLowerCase()] ?? "Amount");
const NUMBERED = /^\s*(?:step\s*)?\d+\s*[.):\-–]\s+/i;
const BULLET = /^\s*[-•*–·]\s+/;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function minutesIn(text: string): number | undefined {
  const m = text.match(TIME);
  if (!m) return undefined;
  const n = Number(m[1]), u = m[2].toLowerCase();
  const min = u.startsWith("h") ? n * 60 : u.startsWith("s") ? n / 60 : n;
  return Math.round(min * 100) / 100;
}

/** Amounts named in a line: "30 g of base monomer" → Base monomer = 30 g. */
function amountsIn(text: string, used: Set<string>): BenchField[] {
  const out: BenchField[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const unit = m[2];
    const of = text.slice(m.index + m[0].length).match(/^\s+of\s+(?:the\s+)?([A-Za-z][A-Za-z -]*?)(?=\s+(?:and|then|to|into|in|for|at|on|until|with)\b|[.,;:()]|$)/);
    const base = of ? cap(of[1].trim().split(/\s+/).slice(0, 4).join(" ")) : nounOf(unit);
    let label = base, k = 2;
    while (used.has(label)) label = `${base} ${k++}`;
    used.add(label);
    out.push({ id: `a${used.size}`, label, unit, formula: m[1] });
  }
  return out;
}

/** Read pasted steps into a protocol. Empty text gives one empty step to start from. */
export function protocolFromText(title: string, text: string, by: PersonId): BenchProtocol {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const anyNumbered = lines.some((l) => NUMBERED.test(l));
  const steps: BenchStep[] = [];
  const used = new Set<string>();
  const add = (raw: string) => {
    const full = raw.replace(NUMBERED, "").trim();
    // A long line is a title plus its instruction: keep the first clause as the title.
    const clause = full.length > 56 ? full.split(/[.;,:]\s/)[0].split(/\s+/).slice(0, 12).join(" ") : full.replace(/[.:]$/, "");
    const instrument = INSTRUMENT_WORDS.find(([re]) => re.test(full))?.[1] ?? steps[steps.length - 1]?.instrument ?? "balance";
    steps.push({
      id: `s${steps.length + 1}`, station: STATION[instrument] ?? "weigh", instrument, title: cap(clause),
      detail: clause === full.replace(/[.:]$/, "") ? [] : [full], fields: amountsIn(full, used), get: [], put: [], timer_min: minutesIn(full),
    });
  };
  for (const l of lines) {
    const isBullet = BULLET.test(l) || (anyNumbered && !NUMBERED.test(l));
    if (isBullet && steps.length) {
      const d = l.replace(BULLET, "").trim(), st = steps[steps.length - 1];
      st.detail.push(d);
      st.fields.push(...amountsIn(d, used));
      st.timer_min ??= minutesIn(d);
    } else add(l.replace(BULLET, ""));
  }
  if (!steps.length) steps.push({ id: "s1", station: "weigh", instrument: "balance", title: "First step", detail: [], fields: [], get: [], put: [] });
  for (const s of steps) if (s.timer_min === undefined) delete s.timer_min;
  const name = title.trim() || "Untitled SOP";
  return { id: newId(name), title: name, runner: by, uploaded: today(), last_run: null, next_run: "1", params: [], steps, script: [] };
}
