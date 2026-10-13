// Models fitted to the trials (by data/generate.ts) and the predictions made from them.
// Shared by the generator (lens grids), the server (draft_trial estimates) and the UI.
// These are estimates from data, not the generator's hidden ground truth.

import type { FittedModels } from "./types.ts";

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function predictViscosity(m: FittedModels, diluent: number, photoinit: number): number {
  const v = m.viscosity;
  return Math.exp(v.b0 + v.b_diluent * diluent + v.b_photoinit * photoinit);
}

export function predictPorosity(m: FittedModels, diluent: number, degassed: boolean, rest_h: number): number {
  const p = m.porosity;
  return Math.exp(p.b0 + p.b_diluent * diluent + p.b_degassed * (degassed ? 1 : 0) + p.b_rest_h * rest_h);
}

function logistic(w: number[], means: number[], sds: number[], raw: number[]): number {
  let s = w[0];
  for (let i = 0; i < raw.length; i++) s += w[i + 1] * ((raw[i] - means[i]) / sds[i]);
  return sigmoid(s);
}

/** "As the team saw it": pass ~ diluent (the dead end's variable), excluded trials left out. */
export function pPassTeam(m: FittedModels, diluent: number): number {
  const t = m.pass_team;
  return logistic(t.w, t.means, t.sds, [diluent]);
}

/** "Split by degassing": pass ~ diluent + photoinitiator + ln(porosity), all trials. */
export function pPassWithPorosity(m: FittedModels, diluent: number, photoinit: number, porosity_pct: number): number {
  const t = m.pass_porosity;
  return logistic(t.w, t.means, t.sds, [diluent, photoinit, Math.log(porosity_pct)]);
}

export interface ArmEstimate {
  viscosity_pa_s: number;
  porosity_pct: number;
  p_pass: number;
  uts_mpa: number;
  flex_strength_mpa: number;
  viability_pct: number;
}

const dot = (b: number[], x: number[]) => b.reduce((s, v, i) => s + v * x[i], 0);

/** Estimate a planned recipe from the fitted models. Used for draft_trial arms. */
export function estimateRecipe(
  m: FittedModels,
  r: { diluent_wt: number; photoinit_wt: number; degas_min: number; rest_h?: number },
): ArmEstimate {
  const rest = r.rest_h ?? 0.5;
  const visc = predictViscosity(m, r.diluent_wt, r.photoinit_wt);
  const por = predictPorosity(m, r.diluent_wt, r.degas_min > 0, rest);
  const p = pPassWithPorosity(m, r.diluent_wt, r.photoinit_wt, por);
  const sx = [1, r.diluent_wt, r.photoinit_wt, por, r.diluent_wt * por];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    viscosity_pa_s: Math.round(visc * 100) / 100,
    porosity_pct: Math.round(por * 100) / 100,
    p_pass: Math.round(p * 100) / 100,
    uts_mpa: r1(dot(m.uts.b, sx)),
    flex_strength_mpa: r1(dot(m.flex.b, sx)),
    viability_pct: r1(dot(m.viability.b, [1, r.diluent_wt, r.diluent_wt ** 2, r.photoinit_wt])),
  };
}
