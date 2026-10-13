// Notebook data access and the server's in-memory state.
// notebook.json is read once and never written. Approved changes go to an
// in-memory copy of the ledger (and a list of approved drafts), which resets
// when the server restarts or when POST /api/reset is called.
// data/ground_truth.json is hidden eval truth: nothing here reads it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  Citation,
  DraftTrial,
  LedgerItem,
  LogEntry,
  Notebook,
  Person,
  PersonId,
  Trial,
} from "../src/shared/types.ts";

// NOTEBOOK_PATH (env) points the server at another notebook file, e.g. a stress haystack in
// evals/stress/data/. Unset (the demo), it reads data/notebook.json as before.
const NOTEBOOK_PATH = process.env.NOTEBOOK_PATH || fileURLToPath(new URL("../data/notebook.json", import.meta.url));

export const notebook: Notebook = JSON.parse(readFileSync(NOTEBOOK_PATH, "utf8"));

const trialIndex = new Map<string, Trial>(notebook.trials.map((t) => [t.id, t]));
const logIndex = new Map<string, { trial: Trial; entry: LogEntry }>();
for (const t of notebook.trials) for (const e of t.log) logIndex.set(e.id, { trial: t, entry: e });

// ---------- mutable state (in memory only) ----------

let ledger: LedgerItem[] = structuredClone(notebook.ledger);
let drafts: DraftTrial[] = [];

export function getLedger(): LedgerItem[] {
  return ledger;
}
export function setLedger(next: LedgerItem[]): void {
  ledger = next;
}
export function getDrafts(): DraftTrial[] {
  return drafts;
}
export function addDraft(d: DraftTrial): void {
  drafts = [...drafts.filter((x) => x.id !== d.id), d];
}
export function resetState(): void {
  ledger = structuredClone(notebook.ledger);
  drafts = [];
}

// ---------- lookups ----------

export function trialById(id: string): Trial | undefined {
  return trialIndex.get(id.trim().toUpperCase());
}
export function logById(id: string): { trial: Trial; entry: LogEntry } | undefined {
  return logIndex.get(id.trim().toUpperCase());
}
export function ledgerById(id: string): LedgerItem | undefined {
  const k = id.trim().toUpperCase();
  return ledger.find((l) => l.id === k);
}
export function person(id: PersonId): Person {
  const p = notebook.people.find((x) => x.id === id);
  if (!p) throw new Error(`unknown person ${id}`);
  return p;
}
export function personName(id: PersonId | "device" | "agent"): string {
  if (id === "device" || id === "agent") return id;
  return person(id).name;
}
export function firstName(id: PersonId): string {
  return person(id).name.split(" ")[0];
}

export type IdKind = "trial" | "log" | "ledger";

export function idKind(id: string): IdKind | null {
  if (trialById(id)) return "trial";
  if (logById(id)) return "log";
  if (ledgerById(id)) return "ledger";
  return null;
}

/** Next unused trial id ("T15"), counting real trials, approved drafts and any reserved ids. */
export function nextTrialId(reserved: string[] = []): string {
  const nums = [...notebook.trials.map((t) => t.id), ...drafts.map((d) => d.id), ...reserved]
    .map((id) => Number(/^T(\d+)$/.exec(id)?.[1] ?? 0));
  const n = Math.max(0, ...nums) + 1;
  return `T${String(n).padStart(2, "0")}`;
}

/** Next unused ledger id ("L4"), counting the live ledger and any reserved ids. */
export function nextLedgerId(reserved: string[] = []): string {
  const nums = [...ledger.map((l) => l.id), ...reserved].map((id) => Number(/^L(\d+)$/.exec(id)?.[1] ?? 0));
  return `L${Math.max(0, ...nums) + 1}`;
}

export const today = (): string => notebook.project.now.slice(0, 10);

// ---------- citation labels (for the citations event) ----------

const fmtTime = (t: string) => t.replace("T", " ").slice(0, 16);

export function citationFor(id: string): Citation | null {
  const k = id.trim().toUpperCase();
  const t = trialById(k);
  if (t) {
    const who = t.owners.map(firstName).join(", ");
    const degas = t.inputs.degas_min > 0 ? `degas ${t.inputs.degas_min} min` : "no degas";
    return {
      id: k,
      kind: "trial",
      label: `${k} · ${who} · ${t.inputs.diluent_wt}% diluent, ${t.inputs.photoinit_wt}% PI, ${degas}`,
    };
  }
  const l = logById(k);
  if (l) return { id: k, kind: "log", label: `${k} · ${fmtTime(l.entry.t)} · ${l.entry.event}` };
  const g = ledgerById(k);
  if (g) return { id: k, kind: "ledger", label: `${k} · ${g.kind.replace("_", " ")} · ${g.text}` };
  return null;
}

/** Pull citation tokens like [T08], [T09-L07], [L2] or [T08, T13] out of answer text. */
export function extractCitationIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[([^\]\n]{1,80})\]/g)) {
    for (const tok of m[1].matchAll(/\b(T\d{2}(?:-L\d{2})?|L\d{1,3})\b/g)) {
      const id = tok[1].toUpperCase();
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}
