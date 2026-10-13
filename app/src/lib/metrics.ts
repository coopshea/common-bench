// The five numbers every trial is judged on: the objective plus four guardrail checks.
// Thresholds come from notebook.project, so plots and table can't drift from the data.
import type { DraftArm, DraftTrial, PersonId, Trial, TrialOutputs } from "../shared/types.ts";
import { landscape, project } from "../data/notebook.ts";
import { estimateRecipe } from "../shared/surrogate.ts";

export interface Metric {
  key: keyof Pick<TrialOutputs, "viscosity_pa_s" | "uts_mpa" | "flex_strength_mpa" | "porosity_pct" | "viability_pct">;
  label: string;
  unit: string;
  op: "<=" | ">=";
  threshold: number;
  digits: number;
}

const check = (metric: string) => {
  for (const g of project.guardrails) for (const c of g.checks) if (c.metric === metric) return c;
  throw new Error(`no check for ${metric}`);
};

const fromCheck = (key: Metric["key"], label: string, digits: number): Metric => {
  const c = check(key);
  return { key, label, unit: c.unit, op: c.op, threshold: c.threshold, digits };
};

export const METRICS: Metric[] = [
  { key: "viscosity_pa_s", label: "Viscosity", unit: project.objective.unit, op: "<=", threshold: project.objective.target, digits: 2 },
  fromCheck("uts_mpa", "Tensile", 1),
  fromCheck("flex_strength_mpa", "Bend", 1),
  fromCheck("porosity_pct", "Bubbles", 2),
  fromCheck("viability_pct", "Cells alive", 1),
];

export const passes = (m: Metric, v: number) => (m.op === "<=" ? v <= m.threshold : v >= m.threshold);
export const fmtMetric = (m: Metric, v: number) => v.toFixed(m.digits);
export const limitText = (m: Metric) => `${m.op === "<=" ? "≤" : "≥"} ${m.threshold}${m.unit === "%" ? "%" : ` ${m.unit}`}`;

/** A row the plots and table can draw: a real trial, or an approved draft arm (estimates). */
export interface Row {
  id: string;
  owner: PersonId;
  date: string;
  diluent: number;
  photoinit: number;
  values: Record<Metric["key"], number>;
  trial?: Trial;
  arm?: DraftArm;
  draft?: DraftTrial;
}

export const rowOfTrial = (t: Trial): Row => ({
  id: t.id,
  owner: t.owners[0],
  date: t.date,
  diluent: t.inputs.diluent_wt,
  photoinit: t.inputs.photoinit_wt,
  values: {
    viscosity_pa_s: t.outputs.viscosity_pa_s,
    uts_mpa: t.outputs.uts_mpa,
    flex_strength_mpa: t.outputs.flex_strength_mpa,
    porosity_pct: t.outputs.porosity_pct,
    viability_pct: t.outputs.viability_pct,
  },
  trial: t,
});

/** Draft arms are estimated in code from models fitted to the trials, never by the language model. */
export const rowsOfDraft = (d: DraftTrial, date: string): Row[] =>
  d.arms.map((a) => {
    const e = estimateRecipe(landscape.models, a.recipe);
    return {
      id: a.id,
      owner: d.owner,
      date,
      diluent: a.recipe.diluent_wt,
      photoinit: a.recipe.photoinit_wt,
      values: {
        viscosity_pa_s: e.viscosity_pa_s,
        uts_mpa: e.uts_mpa,
        flex_strength_mpa: e.flex_strength_mpa,
        porosity_pct: e.porosity_pct,
        viability_pct: e.viability_pct,
      },
      arm: a,
      draft: d,
    };
  });

export const failsOf = (r: Row) => METRICS.filter((m) => !passes(m, r.values[m.key]));

/** Overall state of a trial against the goal: the objective plus every guardrail check. */
export type Status = "goal" | "close" | "fail";
export const guardrailFails = (r: Row) => METRICS.slice(1).filter((m) => !passes(m, r.values[m.key]));
export function statusOf(r: Row): Status {
  if (guardrailFails(r).length) return "fail";
  return passes(METRICS[0], r.values[METRICS[0].key]) ? "goal" : "close";
}
/** State of one check: the objective's miss is "close" (not there yet), a guardrail's miss is "fail". */
export function checkStatus(m: Metric, v: number): Status {
  if (passes(m, v)) return "goal";
  return m.key === "viscosity_pa_s" ? "close" : "fail";
}
export const STATUS_LABEL: Record<Status, string> = { goal: "Goal met", close: "Too thick", fail: "Fails" };
export const metricByKey = (k: Metric["key"]) => METRICS.find((m) => m.key === k)!;
