// Notebook tools: pure functions over notebook.json. Every number comes from code.
// One implementation, exposed two ways: the in-process SDK MCP server (server/mcp-sdk.ts)
// and the stdio MCP server for the Claude Code plugin (server/mcp-stdio.ts).

import { z } from "zod";
import type {
  DiffKind,
  DiffRow,
  DraftArm,
  DraftTrial,
  GuardrailId,
  LedgerChange,
  LedgerItem,
  LedgerStatus,
  LogEntry,
  PersonId,
  Proposal,
  ProtocolDiff,
  RelatedEvidence,
  StepId,
  Trial,
  TrialInputs,
} from "../src/shared/types.ts";
import { estimateRecipe } from "../src/shared/surrogate.ts";
import {
  addDraft,
  firstName,
  getLedger,
  idKind,
  ledgerById,
  logById,
  nextLedgerId,
  nextTrialId,
  notebook,
  person,
  setLedger,
  today,
  trialById,
} from "./notebook.ts";

// ---------- shared shapes ----------

export interface ToolResult<T = unknown> {
  summary: string; // one plain line, used for the trace and shown to the model
  citations: string[]; // ids this result is evidence for
  data: T;
}

export class ToolInputError extends Error {}

const PEOPLE = ["cooper", "shreya"] as const;
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const unique = <T,>(xs: T[]) => [...new Set(xs)];

const INPUT_FIELDS = ["diluent_wt", "photoinit_wt", "degas_min", "rest_h", "mix_rpm", "mix_min", "postcure_min"] as const;
const OUTPUT_FIELDS = [
  "viscosity_pa_s",
  "porosity_pct",
  "uts_mpa",
  "elongation_pct",
  "flex_strength_mpa",
  "flex_modulus_mpa",
  "viability_pct",
] as const;
const NUMERIC_FIELDS = [...INPUT_FIELDS, ...OUTPUT_FIELDS] as const;
type NumericField = (typeof NUMERIC_FIELDS)[number];

const BOOL_METRICS = ["pass_all", "meets_objective", "tensile_pass", "bend_pass", "porosity_pass", "cytotox_pass"] as const;
type BoolMetric = (typeof BOOL_METRICS)[number];

const FIELD_LABEL: Record<string, string> = {
  diluent_wt: "diluent (wt %)",
  photoinit_wt: "photoinitiator (wt %)",
  degas_min: "vacuum degas (min)",
  rest_h: "rest between mixing and printing (h)",
  mix_rpm: "mixer speed (rpm)",
  mix_min: "mix time (min)",
  postcure_min: "UV post-cure (min)",
  viscosity_pa_s: "viscosity (Pa·s)",
  porosity_pct: "bubbles / porosity (%)",
  uts_mpa: "tensile strength (MPa)",
  elongation_pct: "elongation at break (%)",
  flex_strength_mpa: "bend strength (MPa)",
  flex_modulus_mpa: "bend modulus (MPa)",
  viability_pct: "cell viability (%)",
  pass_all: "passing every guardrail",
  meets_objective: "meeting the objective",
  tensile_pass: "passing tensile",
  bend_pass: "passing 3-pt bend",
  porosity_pass: "passing porosity",
  cytotox_pass: "passing cytotoxicity",
};

const SHORT_LABEL: Record<string, string> = {
  uts_mpa: "tensile strength",
  porosity_pct: "bubbles (porosity)",
  viscosity_pa_s: "viscosity",
  flex_strength_mpa: "bend strength",
  flex_modulus_mpa: "bend modulus",
  viability_pct: "cell viability",
  elongation_pct: "elongation",
  diluent_wt: "diluent",
  photoinit_wt: "photoinitiator",
  rest_h: "rest time",
  degas_min: "degassing",
  pass_all: "guardrail pass rate",
  meets_objective: "objective met",
  owner: "person",
  campaign: "campaign",
  fracture: "fracture type",
  excluded: "excluded or not",
  degassed: "degassing",
};

export const FilterSchema = z
  .object({
    ids: z.array(z.string()).optional().describe('Only these trial ids, e.g. ["T08","T09"]'),
    owner: z.enum(PEOPLE).optional().describe("Trials owned by this person"),
    campaign: z.enum(["A", "B", "S"]).optional().describe("A, B = Cooper's campaigns; S = Shreya's"),
    diluent_min: z.number().optional().describe("Diluent wt % at least this"),
    diluent_max: z.number().optional().describe("Diluent wt % at most this"),
    photoinit_min: z.number().optional().describe("Photoinitiator wt % at least this"),
    photoinit_max: z.number().optional().describe("Photoinitiator wt % at most this"),
    degassed: z.boolean().optional().describe("true = vacuum-degassed (degas_min > 0); false = never degassed"),
    viscosity_max: z.number().optional().describe("Viscosity Pa·s at most this (the objective is 1.5)"),
    viscosity_min: z.number().optional().describe("Viscosity Pa·s at least this"),
    pass_all: z.boolean().optional().describe("Every guardrail passed (true) or at least one failed (false)"),
    meets_objective: z.boolean().optional().describe("Passed every guardrail and reached the viscosity objective"),
    include_excluded: z
      .boolean()
      .optional()
      .describe("Include trials their owner excluded from conclusions (default true; excluded trials are flagged)"),
  })
  .describe("Optional trial filter; all conditions must hold");
export type Filter = z.infer<typeof FilterSchema>;

function num(t: Trial, f: NumericField): number {
  return (INPUT_FIELDS as readonly string[]).includes(f)
    ? t.inputs[f as keyof TrialInputs]
    : (t.outputs as unknown as Record<string, number>)[f];
}

function boolMetric(t: Trial, m: BoolMetric): boolean {
  if (m === "pass_all") return t.pass_all;
  if (m === "meets_objective") return t.meets_objective;
  return t.guardrails[m.replace("_pass", "") as GuardrailId];
}

export function applyFilter(f: Filter | undefined): Trial[] {
  const ids = f?.ids?.map((i) => i.trim().toUpperCase());
  return notebook.trials.filter((t) => {
    if (!f) return true;
    if (ids && !ids.includes(t.id)) return false;
    if (f.owner && !t.owners.includes(f.owner)) return false;
    if (f.campaign && t.campaign !== f.campaign) return false;
    if (f.diluent_min !== undefined && t.inputs.diluent_wt < f.diluent_min) return false;
    if (f.diluent_max !== undefined && t.inputs.diluent_wt > f.diluent_max) return false;
    if (f.photoinit_min !== undefined && t.inputs.photoinit_wt < f.photoinit_min) return false;
    if (f.photoinit_max !== undefined && t.inputs.photoinit_wt > f.photoinit_max) return false;
    if (f.degassed !== undefined && t.inputs.degas_min > 0 !== f.degassed) return false;
    if (f.viscosity_max !== undefined && t.outputs.viscosity_pa_s > f.viscosity_max) return false;
    if (f.viscosity_min !== undefined && t.outputs.viscosity_pa_s < f.viscosity_min) return false;
    if (f.pass_all !== undefined && t.pass_all !== f.pass_all) return false;
    if (f.meets_objective !== undefined && t.meets_objective !== f.meets_objective) return false;
    if (f.include_excluded === false && t.excluded) return false;
    return true;
  });
}

function describeFilter(f: Filter | undefined): string {
  if (!f) return "";
  const parts: string[] = [];
  if (f.ids?.length) parts.push(f.ids.join(", "));
  if (f.owner) parts.push(`${firstName(f.owner)}'s trials`);
  if (f.campaign) parts.push(`campaign ${f.campaign}`);
  if (f.diluent_min !== undefined) parts.push(`diluent ≥ ${f.diluent_min}%`);
  if (f.diluent_max !== undefined) parts.push(`diluent ≤ ${f.diluent_max}%`);
  if (f.photoinit_min !== undefined) parts.push(`PI ≥ ${f.photoinit_min}%`);
  if (f.photoinit_max !== undefined) parts.push(`PI ≤ ${f.photoinit_max}%`);
  if (f.degassed !== undefined) parts.push(f.degassed ? "degassed" : "not degassed");
  if (f.viscosity_max !== undefined) parts.push(`viscosity ≤ ${f.viscosity_max} Pa·s`);
  if (f.viscosity_min !== undefined) parts.push(`viscosity ≥ ${f.viscosity_min} Pa·s`);
  if (f.pass_all !== undefined) parts.push(f.pass_all ? "all guardrails pass" : "a guardrail fails");
  if (f.meets_objective !== undefined) parts.push(f.meets_objective ? "meets objective" : "misses objective");
  if (f.include_excluded === false) parts.push("excluded trials left out");
  return parts.join(", ");
}

/** "T06–T10 (Cooper, B), T13–T14 (Shreya, G)" */
export function describeIds(trials: Trial[]): string {
  if (!trials.length) return "none";
  const groups: { key: string; nums: number[] }[] = [];
  for (const t of [...trials].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = `${t.owners.map(firstName).join("+")}, ${t.campaign}`;
    const n = Number(t.id.slice(1));
    const g = groups.at(-1);
    if (g && g.key === key) g.nums.push(n);
    else groups.push({ key, nums: [n] });
  }
  const id = (n: number) => `T${String(n).padStart(2, "0")}`;
  return groups
    .map((g) => {
      const ranges: string[] = [];
      let start = g.nums[0];
      let prev = start;
      for (const n of [...g.nums.slice(1), NaN]) {
        if (n === prev + 1) {
          prev = n;
          continue;
        }
        ranges.push(start === prev ? id(start) : prev === start + 1 ? `${id(start)}, ${id(prev)}` : `${id(start)}–${id(prev)}`);
        start = prev = n;
      }
      return `${ranges.join(", ")} (${g.key})`;
    })
    .join("; ");
}

const failedGuardrails = (t: Trial) =>
  (Object.entries(t.guardrails) as [GuardrailId, boolean][]).filter(([, ok]) => !ok).map(([g]) => g);

function trialRow(t: Trial) {
  return {
    id: t.id,
    date: t.date,
    owner: t.owners.map((o) => person(o).name).join(", "),
    campaign: t.campaign,
    diluent_wt: t.inputs.diluent_wt,
    photoinit_wt: t.inputs.photoinit_wt,
    degas_min: t.inputs.degas_min,
    rest_h: t.inputs.rest_h,
    viscosity_pa_s: t.outputs.viscosity_pa_s,
    porosity_pct: t.outputs.porosity_pct,
    uts_mpa: t.outputs.uts_mpa,
    flex_strength_mpa: t.outputs.flex_strength_mpa,
    flex_modulus_mpa: t.outputs.flex_modulus_mpa,
    viability_pct: t.outputs.viability_pct,
    fracture: t.outputs.fracture,
    failed_guardrails: failedGuardrails(t),
    pass_all: t.pass_all,
    meets_objective: t.meets_objective,
    excluded: t.excluded,
    ...(t.excluded_reason ? { excluded_reason: t.excluded_reason } : {}),
    notes: t.notes,
  };
}

function mustTrial(id: string): Trial {
  const t = trialById(id);
  if (!t) throw new ToolInputError(`No trial "${id}". Trial ids run T01–T${String(notebook.trials.length).padStart(2, "0")}.`);
  return t;
}

// ---------- A. read tools ----------

export function searchTrials(filter?: Filter): ToolResult {
  const ts = applyFilter(filter);
  const desc = describeFilter(filter);
  const excludedNote = ts.filter((t) => t.excluded).map((t) => `${t.id} excluded by its owner`);
  const owners = unique(ts.flatMap((t) => t.owners));
  const viscRange = (xs: Trial[]) => {
    const v = xs.map((t) => t.outputs.viscosity_pa_s);
    return v.length ? (Math.min(...v) === Math.max(...v) ? `${v[0]}` : `${Math.min(...v)}–${Math.max(...v)}`) + " Pa·s" : "";
  };
  const viscNote = !ts.length
    ? ""
    : owners.length > 1
      ? `. Viscosity: ${owners.map((o) => `${firstName(o)} ${viscRange(ts.filter((t) => t.owners.includes(o)))}`).join(", ")}`
      : `. Viscosity ${viscRange(ts)}`;
  return {
    summary: `${ts.length} trial${ts.length === 1 ? "" : "s"}${desc ? ` with ${desc}` : ""}: ${describeIds(ts)}${
      excludedNote.length ? ` (${excludedNote.join("; ")})` : ""
    }${viscNote}`,
    citations: ts.map((t) => t.id),
    data: {
      objective: { metric: "viscosity_pa_s", target: notebook.project.objective.target },
      count: ts.length,
      trials: ts.map(trialRow),
    },
  };
}

export function getTrial(id: string): ToolResult {
  const t = mustTrial(id);
  const peak = t.curve.reduce((m, [, s]) => Math.max(m, s), 0);
  const strainAtBreak = t.curve.at(-1)?.[0] ?? 0;
  const ledgerRefs = getLedger()
    .filter((l) => l.evidence.includes(t.id) || l.text.includes(t.id) || l.status_note?.includes(t.id))
    .map((l) => ({ id: l.id, kind: l.kind, status: l.status, text: l.text }));
  const steps = unique(t.log.map((e) => e.step));
  const fails = failedGuardrails(t);
  const degas = t.inputs.degas_min > 0 ? `degas ${t.inputs.degas_min} min` : "no degas";
  return {
    summary:
      `${t.id} · ${t.owners.map(firstName).join(", ")} · ${t.inputs.diluent_wt}% diluent, ${t.inputs.photoinit_wt}% PI, ${degas}, rest ${t.inputs.rest_h} h → ` +
      `${t.outputs.viscosity_pa_s} Pa·s, porosity ${t.outputs.porosity_pct}%, UTS ${t.outputs.uts_mpa} MPa; ` +
      (fails.length ? `failed ${fails.join(", ")}` : "passed every guardrail") +
      (t.excluded ? ` · excluded: "${t.excluded_reason}"` : ""),
    citations: [t.id, ...ledgerRefs.map((l) => l.id)],
    data: {
      trial: {
        id: t.id,
        date: t.date,
        owners: t.owners.map((o) => ({ id: o, name: person(o).name })),
        campaign: t.campaign,
        parent: t.parent,
        sop_version: t.sop_version,
        inputs: t.inputs,
        outputs: t.outputs,
        guardrails: t.guardrails,
        pass_all: t.pass_all,
        meets_objective: t.meets_objective,
        excluded: t.excluded,
        excluded_reason: t.excluded_reason ?? null,
        notes: t.notes,
      },
      tensile_curve: { points: t.curve.length, peak_stress_mpa: round(peak, 1), strain_at_break_pct: round(strainAtBreak, 2) },
      pores_imaged: t.pores.length,
      log: {
        entries: t.log.length,
        first: t.log[0]?.id,
        last: t.log.at(-1)?.id,
        steps_logged: steps,
        backfilled: t.log.some((e) => e.backfilled),
      },
      ledger_refs: ledgerRefs,
    },
  };
}

const hoursBetween = (a: string, b: string) => (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 3.6e6;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface RestInterval {
  from: LogEntry;
  to: LogEntry;
  hours: number;
}

/** Rest = end of mixing (last mix entry) → start of printing (first print entry). */
export function restInterval(t: Trial): RestInterval | null {
  const mixes = t.log.filter((e) => e.step === "mix");
  const print = t.log.find((e) => e.step === "print");
  const mixEnd = mixes.at(-1);
  if (!mixEnd || !print) return null;
  return { from: mixEnd, to: print, hours: hoursBetween(mixEnd.t, print.t) };
}

// Typical step-to-step gaps across every trial, to judge what's unusual.
const TYPICAL = (() => {
  const byKey = new Map<string, number[]>();
  const rests: number[] = [];
  for (const t of notebook.trials) {
    for (let i = 1; i < t.log.length; i++) {
      const a = t.log[i - 1];
      const b = t.log[i];
      if (a.step === b.step) continue;
      const k = `${a.step}>${b.step}`;
      byKey.set(k, [...(byKey.get(k) ?? []), hoursBetween(a.t, b.t)]);
    }
    const r = restInterval(t);
    if (r) rests.push(r.hours);
  }
  return { gaps: new Map([...byKey].map(([k, v]) => [k, median(v)])), rest: median(rests) };
})();

const isNotable = (h: number, typical: number) => h >= 2 && h > 3 * typical;
const fmtT = (t: string) => t.replace("T", " ").slice(0, 16);
const hhmm = (t: string) => t.slice(11, 16);

export function getLog(trialId: string, step?: StepId): ToolResult {
  const t = mustTrial(trialId);
  const gaps = [];
  for (let i = 1; i < t.log.length; i++) {
    const a = t.log[i - 1];
    const b = t.log[i];
    if (a.step === b.step) continue;
    if (step && a.step !== step && b.step !== step) continue;
    const h = hoursBetween(a.t, b.t);
    const typical = TYPICAL.gaps.get(`${a.step}>${b.step}`) ?? h;
    gaps.push({
      from: a.id,
      to: b.id,
      from_step: a.step,
      to_step: b.step,
      hours: round(h, 1),
      typical_hours: round(typical, 1),
      notable: isNotable(h, typical),
    });
  }
  const rest = restInterval(t);
  const intervals = rest
    ? [
        {
          label: "Rest: mixing ended → printing started",
          from: rest.from.id,
          from_t: rest.from.t,
          to: rest.to.id,
          to_t: rest.to.t,
          hours: round(rest.hours, 1),
          typical_hours: round(TYPICAL.rest, 1),
          notable: isNotable(rest.hours, TYPICAL.rest),
        },
      ]
    : [];
  const entries = step ? t.log.filter((e) => e.step === step) : t.log;
  const steps = unique(t.log.map((e) => e.step));
  const missing = notebook.project.sop.stations.map((s) => s.id).filter((s) => !steps.includes(s));
  const backfilled = t.log.some((e) => e.backfilled);

  let summary = `${t.id}: ${entries.length} log entr${entries.length === 1 ? "y" : "ies"}${step ? ` at ${step}` : ""}`;
  if (rest) {
    const nextDay = rest.to.t.slice(0, 10) !== rest.from.t.slice(0, 10) ? " next day" : "";
    summary += isNotable(rest.hours, TYPICAL.rest)
      ? `. Unusual gap: ${round(rest.hours, 1)} h rest between mixing (${rest.from.id}, ${hhmm(rest.from.t)}) and printing (${rest.to.id}, ${hhmm(rest.to.t)}${nextDay}); typical ${round(TYPICAL.rest, 1)} h`
      : `. Rest before printing ${round(rest.hours, 1)} h (typical ${round(TYPICAL.rest, 1)} h)`;
  }
  if (missing.length) summary += `. No ${missing.join(", ")} step logged`;
  const degasEntries = t.log.filter((e) => e.step === "degas");
  if (degasEntries.length) summary += `. Degas logged: ${degasEntries.map((e) => `${e.id} (${e.source})`).join(", ")}`;
  if (backfilled) summary += ". Backfilled from instrument exports";

  const cited = unique([
    ...(rest && isNotable(rest.hours, TYPICAL.rest) ? [rest.from.id, rest.to.id] : []),
    ...degasEntries.map((e) => e.id),
    ...(step ? entries.map((e) => e.id) : []),
  ]);
  return {
    summary,
    citations: cited.length ? cited : [t.id],
    data: {
      trial_id: t.id,
      owner: t.owners.map((o) => person(o).name).join(", "),
      backfilled,
      backfilled_note: backfilled
        ? "Imported from instrument exports (mixer run log, printer job history) before passive logging existed."
        : undefined,
      steps_logged: steps,
      steps_not_logged: missing,
      entries: entries.map((e) => ({ ...e, t: e.t })),
      gaps,
      intervals,
    },
  };
}

// ----- diff_protocols -----

const DEFAULT_STUDY_VARS = ["diluent_wt", "photoinit_wt"];

interface DiffField {
  step: StepId;
  field: string;
  label: string;
  value: (t: Trial) => string | number | null;
  logs: (t: Trial) => string[];
}

const logsWhere = (t: Trial, pred: (e: LogEntry) => boolean) => t.log.filter(pred).map((e) => e.id);

const DIFF_FIELDS: DiffField[] = [
  {
    step: "weigh",
    field: "diluent_wt",
    label: "Diluent (wt %)",
    value: (t) => t.inputs.diluent_wt,
    logs: (t) => logsWhere(t, (e) => e.step === "weigh" && /diluent/i.test(e.event)),
  },
  {
    step: "weigh",
    field: "photoinit_wt",
    label: "Photoinitiator (wt %)",
    value: (t) => t.inputs.photoinit_wt,
    logs: (t) => logsWhere(t, (e) => e.step === "weigh" && /photoinit/i.test(e.event)),
  },
  {
    step: "mix",
    field: "mix_rpm",
    label: "Mixer speed (rpm)",
    value: (t) => t.inputs.mix_rpm,
    logs: (t) => logsWhere(t, (e) => e.step === "mix").slice(0, 1),
  },
  {
    step: "mix",
    field: "mix_min",
    label: "Mix time (min)",
    value: (t) => t.inputs.mix_min,
    logs: (t) => logsWhere(t, (e) => e.step === "mix").slice(-1),
  },
  {
    step: "degas",
    field: "degas_min",
    label: "Vacuum degas (min)",
    value: (t) => (t.log.some((e) => e.step === "degas") || t.inputs.degas_min > 0 ? t.inputs.degas_min : null),
    logs: (t) => logsWhere(t, (e) => e.step === "degas"),
  },
  {
    step: "viscosity",
    field: "viscosity_measured",
    label: "Viscosity measured at 25 °C",
    value: (t) => (t.log.some((e) => e.step === "viscosity") ? "logged" : null),
    logs: (t) => logsWhere(t, (e) => e.step === "viscosity"),
  },
  {
    step: "print",
    field: "rest_h",
    label: "Rest between mixing and printing (h)",
    value: (t) => t.inputs.rest_h,
    logs: (t) => {
      const r = restInterval(t);
      return r ? [r.from.id, r.to.id] : [];
    },
  },
  {
    step: "postcure",
    field: "postcure_min",
    label: "UV post-cure (min)",
    value: (t) => t.inputs.postcure_min,
    logs: (t) => logsWhere(t, (e) => e.step === "postcure"),
  },
  {
    step: "test",
    field: "tests_run",
    label: "Guardrail tests run",
    value: (t) => {
      const n = t.log.filter((e) => e.step === "test").length;
      return n ? `${n} results logged` : null;
    },
    logs: (t) => {
      const ids = logsWhere(t, (e) => e.step === "test");
      return ids.length ? [ids[0], ids.at(-1)!] : [];
    },
  },
];

/** Is a rest-time difference big enough to matter? (0.4 vs 0.5 h is not; 0.4 vs 18.2 h is.) */
const materialRest = (a: number, b: number) => Math.abs(a - b) >= 2 && Math.max(a, b) / Math.max(0.1, Math.min(a, b)) >= 3;

function sameRecipe(x: Trial, y: Trial) {
  return Math.abs(x.inputs.diluent_wt - y.inputs.diluent_wt) < 0.5 && Math.abs(x.inputs.photoinit_wt - y.inputs.photoinit_wt) < 0.05;
}

function processDifferences(base: Trial, other: Trial): { text: string; log_ids: string[] }[] {
  const out: { text: string; log_ids: string[] }[] = [];
  if (other.inputs.degas_min > 0 !== base.inputs.degas_min > 0) {
    const ids = logsWhere(other, (e) => e.step === "degas");
    out.push({
      text:
        other.inputs.degas_min > 0
          ? `a ${other.inputs.degas_min}-min vacuum degas${ids.length ? ` (${ids.join(", ")})` : ""}`
          : "no degassing",
      log_ids: ids,
    });
  }
  if (materialRest(base.inputs.rest_h, other.inputs.rest_h)) {
    const r = restInterval(other);
    out.push({
      text: r
        ? `a logged rest of ${round(r.hours, 1)} h between mixing (${r.from.id}, ${fmtT(r.from.t)}) and printing (${r.to.id}, ${fmtT(r.to.t)})`
        : `a ${other.inputs.rest_h} h rest before printing`,
      log_ids: r ? [r.from.id, r.to.id] : [],
    });
  }
  return out;
}

export function diffProtocols(aId: string, bId: string, studyVars?: string[]): ToolResult<ProtocolDiff> {
  const a = mustTrial(aId);
  const b = mustTrial(bId);
  const study = studyVars?.length ? studyVars : DEFAULT_STUDY_VARS;
  const rows: DiffRow[] = DIFF_FIELDS.map((f) => {
    const va = f.value(a);
    const vb = f.value(b);
    let kind: DiffKind;
    let note: string | undefined;
    const differs = va !== vb;
    if (!differs) kind = "same";
    else if (study.includes(f.field)) {
      kind = "intended";
      note = "Varied on purpose (a study variable).";
    } else if (f.field === "rest_h" && typeof va === "number" && typeof vb === "number" && !materialRest(va, vb)) {
      kind = "same";
      note = `Minor difference (${va} vs ${vb} h), both printed within the hour.`;
    } else {
      kind = "unintended";
      if (f.field === "degas_min") {
        const withDegas = va !== null && va !== 0 ? a : b;
        const without = withDegas === a ? b : a;
        const ids = logsWhere(withDegas, (e) => e.step === "degas");
        const src = withDegas.log.find((e) => e.step === "degas")?.source;
        note =
          `${firstName(withDegas.owners[0])} degassed ${withDegas.inputs.degas_min} min` +
          (ids.length ? ` (${ids.join(", ")}${src === "manual" ? ", from her worksheet" : ""})` : "") +
          `; ${without.id}'s log has no degas step. Degassing is not in SOP ${a.sop_version}.`;
      } else if (f.field === "rest_h") {
        note = `Rest time differs a lot: ${va} h vs ${vb} h between mixing and printing.`;
      } else {
        note = "Differs, but isn't a study variable.";
      }
    }
    const logIds = [...f.logs(a), ...f.logs(b)];
    return {
      step: f.step,
      field: f.field,
      label: f.label,
      a: va,
      b: vb,
      kind,
      ...(note ? { note } : {}),
      ...(logIds.length ? { log_ids: logIds } : {}),
    };
  });

  const related: RelatedEvidence[] = [];
  for (const base of [a, b]) {
    for (const o of notebook.trials) {
      if (o.id === a.id || o.id === b.id || !sameRecipe(base, o)) continue;
      const diffs = processDifferences(base, o);
      if (!diffs.length) continue;
      const fails = failedGuardrails(o);
      related.push({
        trial: o.id,
        text:
          `Same recipe as ${base.id} (${base.inputs.diluent_wt}% diluent, ${base.inputs.photoinit_wt}% PI), but ${diffs
            .map((d) => d.text)
            .join(" and ")}. ` +
          `Porosity ${o.outputs.porosity_pct}% vs ${base.outputs.porosity_pct}%, UTS ${o.outputs.uts_mpa} vs ${base.outputs.uts_mpa} MPa; ` +
          (fails.length ? `failed ${fails.join(", ")}.` : "passed every guardrail.") +
          (o.excluded ? ` Excluded at the time by ${firstName(o.owners[0])}: "${o.excluded_reason}"` : ""),
        log_ids: diffs.flatMap((d) => d.log_ids),
      });
    }
  }

  const intended = rows.filter((r) => r.kind === "intended");
  const unintended = rows.filter((r) => r.kind === "unintended");
  const fmtVal = (v: string | number | null, r?: DiffRow) => (v === null ? "none" : r && /%/.test(r.label) ? `${v}%` : String(v));
  const summary =
    `${a.id} vs ${b.id}: ${intended.length} intended difference${intended.length === 1 ? "" : "s"}` +
    (intended.length ? ` (${intended.map((r) => `${r.label.replace(/ \(.*\)/, "").toLowerCase()} ${fmtVal(r.a, r)} vs ${fmtVal(r.b, r)}`).join(", ")})` : "") +
    `; ${unintended.length} unintended` +
    (unintended.length ? ` (${unintended.map((r) => `${r.label.replace(/ \(.*\)/, "").toLowerCase()}: ${fmtVal(r.a)} vs ${fmtVal(r.b)}`).join(", ")})` : "") +
    (related.length ? `. Related: ${related.map((r) => r.trial).join(", ")} (${related[0].text.split(". ")[0].replace(/^Same recipe as \S+ \([^)]*\), but /, "")})` : "");

  const diff: ProtocolDiff = { a: a.id, b: b.id, study_vars: study, rows, related };
  return {
    summary,
    citations: unique([a.id, b.id, ...unintended.flatMap((r) => r.log_ids ?? []), ...related.flatMap((r) => [r.trial, ...r.log_ids])]),
    data: diff,
  };
}

// ----- compare_groups / correlate -----

const GROUP_BY = ["degas_min", "degassed", "owner", "campaign", "fracture", "excluded", "pass_all"] as const;
type GroupBy = (typeof GROUP_BY)[number];

function groupKey(t: Trial, g: GroupBy): string {
  switch (g) {
    case "degas_min":
      return `degas ${t.inputs.degas_min} min`;
    case "degassed":
      return t.inputs.degas_min > 0 ? "degassed" : "not degassed";
    case "owner":
      return t.owners.map(firstName).join("+");
    case "campaign":
      return `campaign ${t.campaign}`;
    case "fracture":
      return t.outputs.fracture;
    case "excluded":
      return t.excluded ? "excluded" : "included";
    case "pass_all":
      return t.pass_all ? "passed all" : "failed one or more";
  }
}

export function compareGroups(metric: NumericField | BoolMetric, groupBy: GroupBy, filter?: Filter): ToolResult {
  const ts = applyFilter(filter);
  if (!ts.length) throw new ToolInputError(`No trials match ${describeFilter(filter) || "that filter"}.`);
  const isBool = (BOOL_METRICS as readonly string[]).includes(metric);
  const groups = new Map<string, Trial[]>();
  for (const t of ts) groups.set(groupKey(t, groupBy), [...(groups.get(groupKey(t, groupBy)) ?? []), t]);
  const out = [...groups.entries()]
    .sort(([x], [y]) => x.localeCompare(y, undefined, { numeric: true }))
    .map(([key, g]) => {
      const passAll = g.filter((t) => t.pass_all).length;
      if (isBool) {
        const k = g.filter((t) => boolMetric(t, metric as BoolMetric)).length;
        return { key, n: g.length, count_true: k, rate: round(k / g.length, 2), trial_ids: g.map((t) => t.id) };
      }
      const vals = g.map((t) => num(t, metric as NumericField));
      return {
        key,
        n: g.length,
        mean: round(vals.reduce((s, v) => s + v, 0) / vals.length, 2),
        min: Math.min(...vals),
        max: Math.max(...vals),
        values: Object.fromEntries(g.map((t) => [t.id, num(t, metric as NumericField)])),
        passed_all_guardrails: `${passAll} of ${g.length}`,
        trial_ids: g.map((t) => t.id),
      };
    });
  const desc = describeFilter(filter);
  const summary =
    `${SHORT_LABEL[metric] ?? metric} by ${SHORT_LABEL[groupBy] ?? groupBy}${desc ? ` (${desc})` : ""}: ` +
    out
      .map((g) =>
        "mean" in g
          ? `${g.key}: n=${g.n}, ${g.min === g.max ? g.min : `${g.min}–${g.max}`}, ${g.passed_all_guardrails} passed all [${g.trial_ids.join(", ")}]`
          : `${g.key}: ${g.count_true}/${g.n} [${g.trial_ids.join(", ")}]`,
      )
      .join("; ");
  return {
    summary,
    citations: ts.map((t) => t.id),
    data: { metric, metric_label: FIELD_LABEL[metric], group_by: groupBy, filter: filter ?? null, groups: out },
  };
}

export function correlate(x: NumericField, y: NumericField, filter?: Filter): ToolResult {
  const ts = applyFilter(filter);
  if (ts.length < 3) throw new ToolInputError(`Need at least 3 trials to correlate; ${ts.length} match.`);
  const xs = ts.map((t) => num(t, x));
  const ys = ts.map((t) => num(t, y));
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
  const desc = describeFilter(filter);
  return {
    summary: `r = ${Number.isNaN(r) ? "undefined (no variation)" : round(r, 2)} between ${SHORT_LABEL[x] ?? x} and ${SHORT_LABEL[y] ?? y}, n = ${ts.length}${
      desc ? ` (${desc})` : ""
    }`,
    citations: ts.map((t) => t.id),
    data: {
      x,
      y,
      r: Number.isNaN(r) ? null : round(r, 3),
      n: ts.length,
      trial_ids: ts.map((t) => t.id),
      points: ts.map((t, i) => ({ id: t.id, x: xs[i], y: ys[i] })),
      note: "Pearson correlation across trials; correlation is not cause.",
    },
  };
}

export function readLedger(): ToolResult {
  const items = getLedger();
  return {
    summary: `${items.length} ledger items: ${items
      .map((l) => `${l.id} ${l.kind.replace("_", " ")} (${firstName(l.owner)}, ${l.status})`)
      .join("; ")}`,
    citations: items.map((l) => l.id),
    data: { items },
  };
}

// ---------- write tools: proposals (code builds them; nothing applies without approval) ----------

const STATUSES = ["accepted", "candidate", "active", "disputed", "open", "answered"] as const;

export const LedgerChangeInput = z.object({
  op: z.enum(["update", "add"]).describe('"update" an existing item, or "add" a new one'),
  id: z.string().optional().describe("update only: the ledger id, e.g. L2"),
  status: z.enum(STATUSES).optional().describe("update: new status; add: defaults to candidate for a finding"),
  status_note: z
    .string()
    .optional()
    .describe('Why the status changed, e.g. "reason disputed: <cause> (see <ids>)"'),
  add_evidence: z.array(z.string()).optional().describe("update only: trial/log/ledger ids to add as evidence"),
  kind: z.enum(["finding", "dead_end", "question"]).optional().describe("add only (default finding)"),
  text: z.string().optional().describe("add only: the item text, one plain sentence"),
  owner: z.enum(PEOPLE).optional().describe("add only: the person whose work produced it"),
  evidence: z.array(z.string()).optional().describe("add only: trial/log/ledger ids that support it"),
  pending_on: z.string().optional().describe('add only: the draft trial that will settle it, e.g. "T15"'),
  reason: z.string().describe("One sentence: why this change"),
});
export type LedgerChangeInputT = z.infer<typeof LedgerChangeInput>;

export const DraftArmInput = z.object({
  label: z.string().describe('Short label, e.g. "T08 recipe + 1.7% PI + 10-min degas"'),
  role: z.enum(["treatment", "control"]),
  diluent_wt: z.number().min(5).max(50),
  photoinit_wt: z.number().min(0.2).max(3),
  degas_min: z.number().min(0).max(60).describe("0 = no degassing"),
  rest_h: z.number().min(0).max(48).optional().describe("Rest between mixing and printing; default 0.5 h"),
});

export const DraftPlanShape = {
  title: z.string().describe("Short title"),
  owner: z.enum(PEOPLE).describe("Who will run it (the asker, usually)"),
  hypothesis: z.string().describe("One or two plain sentences"),
  linked_trials: z.array(z.string()).describe("Existing trials this builds on, e.g. T08, T09, T13"),
  arms: z.array(DraftArmInput).min(1).max(4).describe("Treatment arm(s) first, then the control"),
  citations: z.array(z.string()).optional().describe("Other trial/log/ledger ids that support the plan"),
};
const DraftPlan = z.object(DraftPlanShape);
export type DraftPlanT = z.infer<typeof DraftPlan>;

let proposalSeq = 0;
export function newProposalId(kind: "ledger" | "draft"): string {
  proposalSeq += 1;
  return `p-${kind}-${Date.now().toString(36)}-${proposalSeq}`;
}

function checkIds(ids: string[], where: string, allowDraft = false): string[] {
  const bad = ids.filter((id) => !idKind(id) && !(allowDraft && /^T\d{2}[a-z]?$/i.test(id.trim())));
  if (bad.length) throw new ToolInputError(`${where}: unknown id(s) ${bad.join(", ")}. Use ids returned by the read tools.`);
  return ids.map((i) => i.trim().toUpperCase().replace(/^(T\d{2})([A-Z])$/, (_, t, s) => t + s.toLowerCase()));
}

export function buildLedgerProposal(changesIn: LedgerChangeInputT[], reservedLedgerIds: string[] = []): Proposal<LedgerChange[]> {
  if (!changesIn.length) throw new ToolInputError("changes is empty.");
  const reserved = [...reservedLedgerIds];
  const changes: LedgerChange[] = [];
  const lines: string[] = [];
  for (const c of changesIn) {
    if (c.op === "update") {
      if (!c.id) throw new ToolInputError('update needs "id" (e.g. "L2").');
      const item = ledgerById(c.id);
      if (!item) throw new ToolInputError(`No ledger item ${c.id}. Call get_ledger to see the ids.`);
      const patch: Partial<Pick<LedgerItem, "status" | "status_note" | "evidence" | "text">> = {};
      if (c.status) patch.status = c.status as LedgerStatus;
      if (c.status_note) patch.status_note = c.status_note;
      if (c.add_evidence?.length) patch.evidence = unique([...item.evidence, ...checkIds(c.add_evidence, "add_evidence")]);
      if (c.text) patch.text = c.text;
      if (!Object.keys(patch).length) throw new ToolInputError(`update ${item.id}: nothing to change.`);
      changes.push({ op: "update", id: item.id, patch, reason: c.reason });
      lines.push(`${item.id} → ${patch.status ?? item.status}${patch.status_note ? `: ${patch.status_note}` : ""}`);
    } else {
      if (!c.text) throw new ToolInputError('add needs "text".');
      if (!c.owner) throw new ToolInputError('add needs "owner" (the person whose work produced it).');
      const evidence = checkIds(c.evidence ?? [], "evidence");
      if (!evidence.length) throw new ToolInputError("add needs at least one evidence id.");
      const kind = c.kind ?? "finding";
      const status: LedgerStatus = (c.status as LedgerStatus) ?? (kind === "finding" ? "candidate" : kind === "dead_end" ? "active" : "open");
      // pending_on names the draft trial (T15), not one of its arms (T15a)
      const pending = c.pending_on ? checkIds([c.pending_on], "pending_on", true)[0].replace(/^(T\d{2})[a-z]$/i, "$1") : undefined;
      const id = nextLedgerId(reserved);
      reserved.push(id);
      const item: LedgerItem = {
        id,
        kind,
        text: c.text,
        owner: c.owner,
        evidence,
        status,
        recorded_at: today(),
        ...(c.status_note ? { status_note: c.status_note } : {}),
        ...(pending ? { pending_on: pending } : {}),
        history: [{ at: today(), by: "agent", change: "proposed" }],
      };
      changes.push({ op: "add", item, reason: c.reason });
      lines.push(`new ${kind.replace("_", " ")} ${id} (${person(c.owner).name}): ${c.text}${pending ? ` · pending ${pending}` : ""}`);
    }
  }
  const title =
    "Ledger: " +
    changes
      .map((c) => (c.op === "update" ? `${c.id} → ${c.patch.status ?? "edit"}` : `add ${c.item.id} (${firstName(c.item.owner)})`))
      .join(" · ");
  return {
    id: newProposalId("ledger"),
    kind: "ledger",
    title,
    summary: lines.join("; "),
    payload: changes,
    status: "pending",
  };
}

// Materials: everything in stock is something the notebook shows was already used.
function materialsFor(arms: DraftArm[]): DraftTrial["materials"] {
  const used = (pred: (t: Trial) => boolean) => notebook.trials.filter(pred).map((t) => t.id);
  const degassers = used((t) => t.inputs.degas_min > 0);
  const range = (ids: string[]) => (ids.length > 1 ? `${ids[0]}–${ids.at(-1)}` : ids[0]);
  const all = notebook.trials.map((t) => t.id);
  const m: DraftTrial["materials"] = [
    { item: "Base monomer", in_stock: true, note: `used in every trial (${range(all)})` },
    { item: "Reactive diluent (the current one)", in_stock: true, note: `used in every trial (${range(all)}); no new diluent needed` },
    { item: "Photoinitiator", in_stock: true, note: `used in every trial (${range(all)})` },
  ];
  if (arms.some((a) => a.recipe.degas_min > 0))
    m.push({
      item: "Vacuum degasser",
      in_stock: degassers.length > 0,
      note: degassers.length ? `on the bench; used in ${range(degassers)}` : "not used in any trial yet",
    });
  return m;
}

export function buildDraftProposal(plan: DraftPlanT, reservedTrialIds: string[] = []): Proposal<DraftTrial> {
  const id = nextTrialId(reservedTrialIds);
  const models = notebook.landscape.models;
  const ext = notebook.landscape.lenses.degas.extrapolated_beyond;
  const dilRange = [Math.min(...notebook.trials.map((t) => t.inputs.diluent_wt)), Math.max(...notebook.trials.map((t) => t.inputs.diluent_wt))];
  const sop = notebook.trials.at(-1)!.inputs; // SOP v1 settings, identical across trials
  const linked = checkIds(plan.linked_trials, "linked_trials");
  const citations = unique([...linked, ...checkIds(plan.citations ?? [], "citations")]);
  const owner: PersonId = plan.owner;

  const ordered = [...plan.arms.filter((a) => a.role === "treatment"), ...plan.arms.filter((a) => a.role === "control")];
  const arms: DraftArm[] = ordered.map((a, i) => {
    const rest = a.rest_h ?? 0.5;
    const est = estimateRecipe(models, { diluent_wt: a.diluent_wt, photoinit_wt: a.photoinit_wt, degas_min: a.degas_min, rest_h: rest });
    let basis = `fitted to ${models.viscosity.n} trials`;
    if (a.degas_min > 0 && ext !== null && a.diluent_wt > ext) basis += `; extrapolated beyond ${ext}% diluent for degassed resin`;
    else if (a.diluent_wt < dilRange[0] || a.diluent_wt > dilRange[1]) basis += `; extrapolated beyond the tested ${dilRange[0]}–${dilRange[1]}% diluent range`;
    return {
      id: `${id}${String.fromCharCode(97 + i)}`,
      label: a.label,
      role: a.role,
      recipe: {
        diluent_wt: a.diluent_wt,
        photoinit_wt: a.photoinit_wt,
        degas_min: a.degas_min,
        rest_h: rest,
        mix_rpm: sop.mix_rpm,
        mix_min: sop.mix_min,
        postcure_min: sop.postcure_min,
      },
      estimate: { ...est, basis },
    };
  });

  const pct = (x: number) => `${x}%`;
  const steps = [
    `Weigh one 50 g batch per arm: ${arms.map((a) => `${a.id} ${pct(a.recipe.diluent_wt)} diluent / ${pct(a.recipe.photoinit_wt)} photoinitiator`).join("; ")}.`,
    `Mix each at ${sop.mix_rpm} rpm for ${sop.mix_min} min (SOP ${notebook.project.sop.version}).`,
    ...(arms.some((a) => a.recipe.degas_min > 0)
      ? [
          arms
            .map((a) => (a.recipe.degas_min > 0 ? `Degas ${a.id} under vacuum for ${a.recipe.degas_min} min` : `do not degas ${a.id} (${a.role})`))
            .join("; ") + ". Log it on the worksheet so the degasser step is recorded.",
        ]
      : []),
    `Measure viscosity at 25 °C.`,
    `Print each arm ${arms.every((a) => (a.recipe.rest_h ?? 0.5) < 1) ? "within an hour of mixing, so rest time isn't a second variable" : `after the planned rest (${arms.map((a) => `${a.id} ${a.recipe.rest_h} h`).join(", ")})`}.`,
    `Post-cure ${sop.postcure_min} min, then run all four guardrails: tensile, 3-pt bend, porosity (cross-section), cytotoxicity.`,
  ];
  const materials = materialsFor(arms);
  const nothingToOrder = materials.every((m) => m.in_stock);

  const draft: DraftTrial = {
    id,
    title: plan.title.replace(/^T\d{2}[a-z]?\s*[:\-–]\s*/i, "").trim() || plan.title,
    owner,
    linked_trials: linked,
    hypothesis: plan.hypothesis,
    arms,
    steps,
    materials,
    nothing_to_order: nothingToOrder,
    citations,
  };
  const armLine = (a: DraftArm) =>
    `${a.id} (${a.role}): ${a.recipe.diluent_wt}% diluent, ${a.recipe.photoinit_wt}% PI, ${
      a.recipe.degas_min > 0 ? `degas ${a.recipe.degas_min} min` : "no degas"
    } → est. ${a.estimate.viscosity_pa_s} Pa·s, porosity ${a.estimate.porosity_pct}%, P(pass all) ${a.estimate.p_pass}`;
  return {
    id: newProposalId("draft"),
    kind: "draft",
    title: `Draft ${id}: ${draft.title}`,
    summary: `${arms.map(armLine).join("; ")}. ${nothingToOrder ? "Nothing to order." : "Needs materials ordered."} Owner: ${person(owner).name}`,
    payload: draft,
    status: "pending",
  };
}

/** Apply an approved proposal to the in-memory state. Returns what changed. */
export function applyProposal(p: Proposal<unknown>, by: PersonId): { ledger?: LedgerItem[]; draft?: DraftTrial } {
  if (p.kind === "ledger") {
    const changes = p.payload as LedgerChange[];
    let ledger = structuredClone(getLedger());
    for (const c of changes) {
      if (c.op === "update") {
        const cur = ledger.find((l) => l.id === c.id);
        const unchanged =
          cur && (Object.keys(c.patch) as (keyof typeof c.patch)[]).every((k) => JSON.stringify(cur[k]) === JSON.stringify(c.patch[k]));
        if (unchanged) continue; // already applied (e.g. the same card approved twice)
        ledger = ledger.map((l) =>
          l.id === c.id
            ? {
                ...l,
                ...c.patch,
                history: [
                  ...(l.history ?? []),
                  {
                    at: today(),
                    by,
                    change: [c.patch.status && `status → ${c.patch.status}`, c.patch.status_note && `note: ${c.patch.status_note}`, c.patch.evidence && "evidence added"]
                      .filter(Boolean)
                      .join("; "),
                  },
                ],
              }
            : l,
        );
      } else if (!ledger.some((l) => l.id === c.item.id)) {
        ledger.push({ ...c.item, history: [...(c.item.history ?? []), { at: today(), by, change: "approved" }] });
      }
    }
    setLedger(ledger);
    return { ledger };
  }
  const draft = p.payload as DraftTrial;
  addDraft(draft);
  return { draft };
}

// ---------- tool specs (one list, two MCP servers) ----------

export interface ToolSpec {
  name: string;
  kind: "read" | "write";
  description: string;
  shape: z.ZodRawShape;
  /** Read tools only. Parsed args in, exact result out. */
  run?: (args: any) => ToolResult;
}

const StepEnum = z.enum(["weigh", "mix", "degas", "viscosity", "print", "postcure", "test"]);

export const TOOLS: ToolSpec[] = [
  {
    name: "search_trials",
    kind: "read",
    description:
      "Find trials matching a filter. Returns each trial's id, owner, recipe (diluent %, photoinitiator %, degas minutes, rest hours), " +
      "key results (viscosity, porosity, tensile and bend strength, cell viability), which guardrails failed, and whether its owner excluded it. " +
      "Excluded trials are included by default and flagged. Exact numbers from the notebook.",
    shape: { filter: FilterSchema.optional() },
    run: (a: { filter?: Filter }) => searchTrials(a.filter),
  },
  {
    name: "get_trial",
    kind: "read",
    description:
      "Get one trial in full: owners, inputs, all outputs, guardrail results, the owner's notes in their own words, " +
      "exclusion reason if excluded, what was logged, and which ledger items cite it.",
    shape: { id: z.string().describe('Trial id, e.g. "T09"') },
    run: (a: { id: string }) => getTrial(a.id),
  },
  {
    name: "get_log",
    kind: "read",
    description:
      "Get a trial's step-by-step log (balance, mixer, degasser worksheet, viscometer, printer, oven, test frame, imaging, plate reader) " +
      "with computed gaps between steps compared with the typical gap across all trials, and the rest time between mixing and printing. " +
      "Unusual gaps are flagged notable. Lists steps that were never logged (e.g. no degas).",
    shape: {
      trial_id: z.string().describe('Trial id, e.g. "T09"'),
      step: StepEnum.optional().describe("Only entries at this step (gaps touching it, too)"),
    },
    run: (a: { trial_id: string; step?: StepId }) => getLog(a.trial_id, a.step),
  },
  {
    name: "diff_protocols",
    kind: "read",
    description:
      "Compare how two trials were actually run, step by step from their logs. Differences in study_vars are labeled intended; " +
      "every other difference (a step present in one and absent in the other, a very different rest time) is labeled unintended. " +
      "Also returns related evidence: other trials with the same recipe but a different process.",
    shape: {
      a: z.string().describe('First trial id, e.g. "T08"'),
      b: z.string().describe('Second trial id, e.g. "T13"'),
      study_vars: z
        .array(z.string())
        .optional()
        .describe('Fields varied on purpose. Default ["diluent_wt","photoinit_wt"]'),
    },
    run: (a: { a: string; b: string; study_vars?: string[] }) => diffProtocols(a.a, a.b, a.study_vars),
  },
  {
    name: "compare_groups",
    kind: "read",
    description:
      "Group trials (optionally filtered) and compare a metric across groups: n, min, max, mean, per-trial values and how many passed " +
      "every guardrail; or, for a pass/fail metric, the count and rate. E.g. tensile strength above 30% diluent, grouped by degassing.",
    shape: {
      metric: z.enum([...NUMERIC_FIELDS, ...BOOL_METRICS]).describe("What to compare"),
      group_by: z.enum(GROUP_BY).describe("How to group"),
      filter: FilterSchema.optional(),
    },
    run: (a: { metric: NumericField | BoolMetric; group_by: GroupBy; filter?: Filter }) => compareGroups(a.metric, a.group_by, a.filter),
  },
  {
    name: "correlate",
    kind: "read",
    description: "Pearson correlation between two numeric trial fields (inputs or outputs), with n and the trial ids used.",
    shape: {
      x: z.enum(NUMERIC_FIELDS),
      y: z.enum(NUMERIC_FIELDS),
      filter: FilterSchema.optional(),
    },
    run: (a: { x: NumericField; y: NumericField; filter?: Filter }) => correlate(a.x, a.y, a.filter),
  },
  {
    name: "get_ledger",
    kind: "read",
    description:
      "Read the team's findings ledger: findings, dead ends (with the map region they rule out) and open questions, each with owner, " +
      "evidence ids, status and history.",
    shape: {},
    run: () => readLedger(),
  },
  {
    name: "propose_ledger_update",
    kind: "write",
    description:
      "Propose changes to the findings ledger as ONE approval card: update an existing item (e.g. mark a dead end disputed with a " +
      "status_note) and/or add a new item owned by the person whose work produced it. Nothing changes until a person approves. " +
      "Ids for new items are assigned by the notebook.",
    shape: { changes: z.array(LedgerChangeInput).min(1).max(4) },
  },
  {
    name: "draft_trial",
    kind: "write",
    description:
      "Propose a draft experiment as an approval card: one or more arms (treatment first, then a control). The notebook assigns the " +
      "trial id, computes each arm's estimated viscosity, porosity and pass probability from models fitted to the trials, writes the " +
      "steps, and checks which materials are already in stock. Nothing is scheduled until a person approves.",
    shape: DraftPlanShape,
  },
];

export const READ_TOOL_NAMES = TOOLS.filter((t) => t.kind === "read").map((t) => t.name);
export const WRITE_TOOL_NAMES = TOOLS.filter((t) => t.kind === "write").map((t) => t.name);

/** The JSON text a tool returns to the model: summary first, then exact data. */
export function toolText(r: ToolResult): string {
  return JSON.stringify({ summary: r.summary, cited_ids: r.citations, ...(r.data as object) });
}

/** Run a read tool by name with raw (unparsed) args. Throws ToolInputError on bad input. */
export function runReadTool(name: string, rawArgs: unknown): ToolResult {
  const spec = TOOLS.find((t) => t.name === name && t.kind === "read");
  if (!spec?.run) throw new ToolInputError(`Unknown read tool ${name}`);
  const args = z.object(spec.shape).parse(rawArgs ?? {});
  return spec.run(args);
}

// ---------- plain-language trace labels ----------

export function traceLabel(name: string, input: any): string {
  const f: Filter | undefined = input?.filter;
  switch (name) {
    case "search_trials": {
      if (f?.viscosity_max !== undefined && f.viscosity_max <= notebook.project.objective.target) return "Searched trials that reached the viscosity target";
      if (f?.owner) return `Searched ${firstName(f.owner)}'s trials`;
      if (f?.ids?.length) return `Looked up ${f.ids.join(", ")}`;
      const d = describeFilter(f);
      return d ? `Searched trials: ${d}` : "Searched all trials";
    }
    case "get_trial":
      return `Opened trial ${String(input?.id ?? "").toUpperCase()}`;
    case "get_log":
      return `Pulled ${String(input?.trial_id ?? "").toUpperCase()}'s log${input?.step ? ` (${input.step} step)` : ""}`;
    case "diff_protocols":
      return `Diffed protocols, ${String(input?.a ?? "").toUpperCase()} against ${String(input?.b ?? "").toUpperCase()}`;
    case "compare_groups": {
      const d = describeFilter(f);
      return `Compared ${SHORT_LABEL[input?.metric] ?? input?.metric} by ${SHORT_LABEL[input?.group_by] ?? input?.group_by}${d ? ` (${d})` : ""}`;
    }
    case "correlate":
      return `Correlated ${SHORT_LABEL[input?.x] ?? input?.x} with ${SHORT_LABEL[input?.y] ?? input?.y}`;
    case "get_ledger":
      return "Read the findings ledger";
    case "propose_ledger_update":
      return "Proposed a ledger change (needs approval)";
    case "draft_trial":
      return "Drafted an experiment (needs approval)";
    default:
      return name;
  }
}
