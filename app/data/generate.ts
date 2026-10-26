// Seeded synthetic data generator: the single source of truth for every number in the demo.
// Run: node data/generate.ts   (Node 24 strips types natively)
// Writes: data/notebook.json (what the app and agent see)
//         data/ground_truth.json (hidden model + true optimum; for evals only, never shown in the UI)

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BenchProtocol,
  Lab,
  Org,
  FittedModels, Guardrail, GuardrailId, LandscapeGrid, LedgerItem, Lens, LogEntry, Notebook, Person,
  PersonId, Pore, Project, Station, StepId, Trial, TrialInputs, TrialOutputs,
} from "../src/shared/types.ts";
import { evaluateAll } from "../src/shared/calc.ts";
import { estimateRecipe, pPassTeam, pPassWithPorosity, predictPorosity } from "../src/shared/surrogate.ts";

const SEED = Number(process.env.SEED ?? 5); // seed 5: first seed where every story check passes
const HERE = dirname(fileURLToPath(import.meta.url));

// ---------- seeded RNG ----------

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const gauss = () => {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------- hidden ground-truth chemistry (simplified, plausible) ----------
// More diluent → thinner resin, but a more brittle cured part.
// Thin resin folds more air in at 3000 rpm; bubbles rise out slowly (Stokes: rise time ∝ viscosity).
// Brittle materials are flaw-sensitive and bubbles are flaws, so the porosity knock-down on strength
// scales with brittleness. That interaction is the "barrier" at ~30% diluent. Degassing removes it.

export const GT = {
  viscosity: (d: number, p: number) => 2.6 * Math.exp(-0.0309 * (d - 15)) * (1 + 0.01 * (p - 0.8)),
  entrained: (d: number, rpm = 3000, min = 2) => 0.3 * Math.exp(0.11 * (d - 15)) * (rpm / 3000) * Math.sqrt(min / 2),
  porosity: (d: number, p: number, degas_min: number, rest_h: number) =>
    GT.entrained(d) * Math.exp(-degas_min / 4.5) * Math.exp(-rest_h / (6.5 * GT.viscosity(d, p))),
  brittleness: (d: number) => 1 / (1 + Math.exp(-(d - 28) / 3)), // 0 = ductile, 1 = brittle
  intrinsicUts: (d: number, p: number) => 54 - 0.25 * (d - 15) - 10 * Math.exp(-(p - 0.5) / 0.3), // PI → better cure
  knockdown: (d: number, por: number) => (1 / (1 + 0.1 * GT.brittleness(d) * por)) * (1 - 0.01 * por),
  uts: (d: number, p: number, por: number) => GT.intrinsicUts(d, p) * GT.knockdown(d, por),
  flexFromUts: (uts: number) => 1.6 * uts,
  modulus: (d: number, p: number, por: number) => 2100 + 20 * (d - 15) + 100 * (p - 0.5) - 30 * por,
  // Residual monomer rises with diluent (sharply above ~37%) and falls with better cure up to ~1.6% PI;
  // past that, the photoinitiator itself is cytotoxic. This is what caps the true optimum at ~41% diluent.
  viability: (d: number, p: number) =>
    92 - 0.4 * (d - 10) - 1.0 * Math.max(0, d - 37) ** 2 + 8 * (Math.min(p, 1.6) - 0.5) - 60 * Math.max(0, p - 1.6) ** 2,
};

// ---------- project definition ----------

const OBJECTIVE_TARGET = 1.5;

const guardrails: Guardrail[] = [
  {
    id: "tensile", label: "Tensile", plain: "Doesn't snap when pulled",
    checks: [{ metric: "uts_mpa", op: ">=", threshold: 40, unit: "MPa" }],
    source_note: "Contrived floor for the demo.",
  },
  {
    id: "bend", label: "3-pt bend", plain: "Holds up under biting load",
    checks: [
      { metric: "flex_strength_mpa", op: ">=", threshold: 65, unit: "MPa" },
      { metric: "flex_modulus_mpa", op: ">=", threshold: 2000, unit: "MPa" },
    ],
    source_note: "Modeled on ISO 20795-1 denture-base values; verify before quoting.",
  },
  {
    id: "porosity", label: "Bubbles (porosity)", plain: "Few bubbles in the cured part",
    checks: [{ metric: "porosity_pct", op: "<=", threshold: 1.0, unit: "%" }],
    source_note: "Contrived for the demo.",
  },
  {
    id: "cytotox", label: "Cytotoxicity", plain: "Safe for cells: at least 70% survive",
    checks: [{ metric: "viability_pct", op: ">=", threshold: 70, unit: "%" }],
    source_note: "The ISO 10993-5 threshold.",
  },
];

const stations: Station[] = [
  { id: "weigh", label: "Weigh", device: "Balance", source: "mhs", in_sop: true,
    card: "Weigh base monomer, diluent and photoinitiator into a 50 g batch. The balance logs each addition, so the recipe is recorded as weighed, not as planned." },
  { id: "mix", label: "Mix", device: "Planetary mixer", source: "mhs", in_sop: true,
    card: "Mix at 3000 rpm for 2 minutes, per SOP v1. The mixer logs speed, duration and when the run ended." },
  { id: "degas", label: "Degas", device: "Vacuum degasser", source: "manual", in_sop: false,
    card: "Pull a vacuum on the mixed resin so trapped bubbles expand and escape. Not in SOP v1, and the degasser has no data interface, so it's only logged if someone writes it on their worksheet." },
  { id: "viscosity", label: "Viscosity", device: "Viscometer", source: "mhs", in_sop: true,
    card: "Measure viscosity at 25 °C. This is the objective: at most 1.5 Pa·s." },
  { id: "print", label: "Print", device: "DLP printer", source: "mhs", in_sop: true,
    card: "Print 6 tensile dogbones and 3 bend bars. The printer logs when each job starts, which is how the rest time between mixing and printing is known." },
  { id: "postcure", label: "Post-cure", device: "UV oven", source: "manual", in_sop: true,
    card: "Post-cure under UV at 60 °C for 45 minutes. The oven has no interface, so the time is entered by hand." },
  { id: "test", label: "Test", device: "Test frame · imaging · plate reader", source: "mhs", in_sop: true,
    card: "Pull and bend the printed parts, image a cross-section for bubbles, and run the cell-viability assay. Results land in the log automatically." },
];

const project: Project = {
  id: "fast-print-denture-resin",
  name: "Fast-print denture base resin",
  concept_label: "Concept: project workspace for Claude Science (unofficial)",
  synthetic_label: "Synthetic data",
  now: "2026-10-13T09:30:00",
  objective: {
    metric: "viscosity_pa_s",
    label: "Viscosity ≤ 1.5 Pa·s",
    target: OBJECTIVE_TARGET,
    baseline: 2.5,
    unit: "Pa·s",
    direction: "minimize",
    why: "Thinner resin recoats faster between layers, so dentures print faster.",
  },
  guardrails,
  sop: { version: "v1", stations },
  team: ["cooper", "greeshma"],
};

const people: Person[] = [
  { id: "cooper", name: "Cooper Shea", initials: "CS", role: "Former member · formulation", color: "#2a78d6",
    joined: "2024-09-16", left: "2025-06-27", status: "former" },
  { id: "greeshma", name: "Greeshma", initials: "G", role: "Scientist · formulation", color: "#6250d6",
    joined: "2026-07-06", status: "current" },
];

// ---------- the trials the story needs ----------

interface Plan {
  id: string; date: string; owner: PersonId; campaign: "A" | "B" | "G";
  d: number; p: number; degas: number;
  mixAt: string; // HH:MM on `date`
  printAt?: { dayOffset: number; time: string }; // explicit print time (T09)
  printDelayMin?: number; // otherwise minutes after mix end
  excluded?: string;
  notes: (o: TrialOutputs) => [StepId, string][]; // lab-notebook entries, each written at a process step
}

const PLANS: Plan[] = [
  // Cooper, campaign A: low diluent. Strong, too viscous.
  { id: "T01", date: "2024-10-08", owner: "cooper", campaign: "A", d: 15, p: 0.6, degas: 0, mixAt: "10:15", printDelayMin: 24,
    notes: (o) => [["weigh", "Baseline: 15% diluent, 0.6% PI."], ["test", `Strong and ductile, UTS ${o.uts_mpa} MPa. But ${o.viscosity_pa_s} Pa·s is way over target.`]] },
  { id: "T02", date: "2024-10-29", owner: "cooper", campaign: "A", d: 18, p: 0.7, degas: 0, mixAt: "09:50", printDelayMin: 27,
    notes: (o) => [["weigh", "Diluent up to 18%, PI 0.7%."], ["viscosity", `${o.viscosity_pa_s} Pa·s. Still too thick.`]] },
  { id: "T03", date: "2024-11-19", owner: "cooper", campaign: "A", d: 20, p: 0.8, degas: 0, mixAt: "13:05", printDelayMin: 22,
    notes: (o) => [["weigh", "20% diluent, PI up to 0.8%."], ["test", `${o.viscosity_pa_s} Pa·s, strength fine. Small steps aren't getting there.`]] },
  { id: "T04", date: "2024-12-10", owner: "cooper", campaign: "A", d: 22, p: 0.9, degas: 0, mixAt: "10:40", printDelayMin: 25,
    notes: (o) => [["viscosity", `22%: ${o.viscosity_pa_s} Pa·s.`], ["test", "Parts look good. Nothing close to 1.5 yet."]] },
  { id: "T05", date: "2025-01-14", owner: "cooper", campaign: "A", d: 24, p: 1.0, degas: 0, mixAt: "11:20", printDelayMin: 23,
    notes: (o) => [["viscosity", `24%: ${o.viscosity_pa_s} Pa·s, best so far, still over.`], ["test", `Strength holding (UTS ${o.uts_mpa} MPa). Next: a big jump in diluent.`]] },
  // Cooper, campaign B: high diluent. Thin enough, but fails strength. Never degassed.
  { id: "T06", date: "2025-02-18", owner: "cooper", campaign: "B", d: 34, p: 0.8, degas: 0, mixAt: "10:05", printDelayMin: 26,
    notes: (o) => [["viscosity", `Jumped to 34%. ${o.viscosity_pa_s} Pa·s, under target!`], ["test", `UTS ${o.uts_mpa} MPa, below the floor. Cross-section full of voids (${o.porosity_pct}%).`]] },
  { id: "T07", date: "2025-03-18", owner: "cooper", campaign: "B", d: 36, p: 0.9, degas: 0, mixAt: "09:35", printDelayMin: 21,
    notes: (o) => [["weigh", "36%, PI 0.9%."], ["test", `Snapped clean, no necking. UTS ${o.uts_mpa} MPa, porosity ${o.porosity_pct}%.`]] },
  { id: "T08", date: "2025-04-15", owner: "cooper", campaign: "B", d: 38, p: 1.0, degas: 0, mixAt: "10:30", printDelayMin: 24,
    notes: (o) => [["weigh", "38%, PI 1.0%."], ["test", `Brittle again: UTS ${o.uts_mpa} MPa, porosity ${o.porosity_pct}%. High diluent seems to make it porous and brittle.`]] },
  // T09: a replicate of T08 that sat overnight. The rest is only visible in the log, never in the note.
  { id: "T09", date: "2025-04-22", owner: "cooper", campaign: "B", d: 38, p: 1.0, degas: 0, mixAt: "16:40",
    printAt: { dayOffset: 1, time: "10:52" }, excluded: "Anomalous, likely a lucky specimen.",
    notes: (o) => [["weigh", "Replicate of T08."], ["test", `UTS ${o.uts_mpa} MPa, porosity ${o.porosity_pct}%: nothing like T08. Anomalous, likely a lucky specimen. Excluded.`]] },
  { id: "T10", date: "2025-05-20", owner: "cooper", campaign: "B", d: 40, p: 1.2, degas: 0, mixAt: "10:10", printDelayMin: 25,
    notes: (o) => [["weigh", "40%, PI up to 1.2% to help the cure."], ["test", `Didn't help: UTS ${o.uts_mpa} MPa, porosity ${o.porosity_pct}%. Calling high diluent a dead end.`]] },
  // Greeshma: a different region (mid diluent, high PI). Degasses 10 min out of habit; never mentions it.
  { id: "T11", date: "2026-07-09", owner: "greeshma", campaign: "G", d: 26, p: 1.5, degas: 10, mixAt: "10:05", printDelayMin: 31,
    notes: (o) => [["weigh", "First trial, following the SOP walkthrough. 26% diluent, PI 1.5% for a stronger cure."], ["test", `Everything passes. ${o.viscosity_pa_s} Pa·s.`]] },
  { id: "T12", date: "2026-08-04", owner: "greeshma", campaign: "G", d: 28, p: 1.8, degas: 10, mixAt: "09:45", printDelayMin: 33,
    notes: (o) => [["weigh", "28%, PI 1.8%."], ["test", `All guardrails pass. ${o.viscosity_pa_s} Pa·s.`]] },
  { id: "T13", date: "2026-08-27", owner: "greeshma", campaign: "G", d: 30, p: 1.7, degas: 10, mixAt: "10:20", printDelayMin: 30,
    notes: (o) => [["weigh", "30%, PI back to 1.7%."], ["test", `Brittle fracture, but strength is fine (UTS ${o.uts_mpa} MPa).`]] },
  { id: "T14", date: "2026-09-22", owner: "greeshma", campaign: "G", d: 32, p: 1.6, degas: 10, mixAt: "09:55", printDelayMin: 32,
    notes: (o) => [["viscosity", `32%, PI 1.6%: ${o.viscosity_pa_s} Pa·s. Closest yet, still above 1.5.`], ["test", "All pass. Might need a lower-viscosity diluent (DiluentX?)."]] },
];

// ---------- time helpers (naive local ISO strings, computed in UTC to avoid TZ drift) ----------

function at(date: string, hhmm: string, addDays = 0, addMin = 0): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return Date.UTC(y, mo - 1, d + addDays, h, mi + addMin);
}
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const MIN = 60_000, HOUR = 3_600_000;

// ---------- build each trial ----------

function guardrailResults(o: TrialOutputs): Record<GuardrailId, boolean> {
  const out = {} as Record<GuardrailId, boolean>;
  for (const g of guardrails) {
    out[g.id] = g.checks.every((c) => {
      const v = o[c.metric] as number;
      return c.op === ">=" ? v >= c.threshold : v <= c.threshold;
    });
  }
  return out;
}

function tensileCurve(o: TrialOutputs): [number, number][] {
  const pts: [number, number][] = [];
  const uts = o.uts_mpa, ef = o.elongation_pct;
  if (o.fracture === "brittle") {
    const k = 0.18; // slight concavity, then a clean snap
    for (let i = 0; i <= 14; i++) {
      const e = (ef * i) / 14, x = e / ef;
      pts.push([r2(e), r1((uts * x * (1 - k * x)) / (1 - k))]);
    }
    pts.push([r2(ef + 0.02), 0]);
  } else {
    const E = o.flex_modulus_mpa * 0.95;
    const sy = 0.82 * uts, ey = (sy / E) * 100, eu = ey + 1.1;
    for (let i = 0; i <= 8; i++) { const e = (ey * i) / 8; pts.push([r2(e), r1((e / 100) * E)]); } // elastic
    for (let i = 1; i <= 6; i++) { const x = i / 6; pts.push([r2(ey + (eu - ey) * x), r1(sy + (uts - sy) * Math.sin((x * Math.PI) / 2))]); } // hardening
    for (let i = 1; i <= 7; i++) { const x = i / 7; pts.push([r2(eu + (ef - eu) * x), r1(uts * (1 - 0.13 * x ** 1.4))]); } // necking
    pts.push([r2(ef + 0.03), 0]);
  }
  return pts;
}

function flexCurve(o: TrialOutputs): [number, number][] {
  // ISO-style bar 64 × 10 × 3.3 mm on a 50 mm span: F = σ·2bh²/(3L), δ = σL²/(6Eh)
  const L = 50, b = 10, h = 3.3;
  const Fmax = (o.flex_strength_mpa * 2 * b * h * h) / (3 * L);
  const dmax = (o.flex_strength_mpa * L * L) / (6 * o.flex_modulus_mpa * h);
  const pts: [number, number][] = [];
  const k = 0.1;
  for (let i = 0; i <= 12; i++) {
    const x = i / 12;
    pts.push([r2(dmax * x), r1((Fmax * x * (1 - k * x)) / (1 - k))]);
  }
  if (o.fracture === "brittle") pts.push([r2(dmax + 0.04), r1(Fmax * 0.06)]);
  else { pts.push([r2(dmax * 1.12), r1(Fmax * 0.97)], [r2(dmax * 1.25), r1(Fmax * 0.9)], [r2(dmax * 1.27), r1(Fmax * 0.1)]); }
  return pts;
}

function pores(porosity_pct: number): Pore[] {
  const target = porosity_pct / 100; // area fraction on the cross-section ≈ volume fraction
  const out: Pore[] = [];
  let area = 0;
  while (area < target && out.length < 80) {
    const r = Math.min(0.045, Math.max(0.008, 0.018 * Math.exp(0.35 * gauss())));
    out.push({ x: r2(0.06 + rand() * 0.88), y: r2(0.06 + rand() * 0.88), r: Math.round(r * 1000) / 1000 });
    area += Math.PI * r * r;
  }
  return out;
}

function buildTrial(plan: Plan, parent: string | null): Trial {
  const owner = plan.owner;
  const backfilled = owner === "cooper" ? true : undefined;
  const log: LogEntry[] = [];
  const add = (t: number, step: StepId, device: string, source: LogEntry["source"], event: string, value?: number, unit?: string) => {
    log.push({ id: `${plan.id}-L${String(log.length + 1).padStart(2, "0")}`, t: iso(t), step, device, source, actor: owner,
      event, ...(value !== undefined ? { value } : {}), ...(unit ? { unit } : {}), ...(backfilled ? { backfilled } : {}) });
  };

  const mixStart = at(plan.date, plan.mixAt);
  const mixEnd = mixStart + 2 * MIN;
  const printStart = plan.printAt
    ? at(plan.date, plan.printAt.time, plan.printAt.dayOffset)
    : mixEnd + (plan.printDelayMin ?? 25) * MIN;
  const rest_h = r1((printStart - mixEnd) / HOUR);

  const inputs: TrialInputs = {
    diluent_wt: plan.d, photoinit_wt: plan.p, degas_min: plan.degas, rest_h,
    mix_rpm: 3000, mix_min: 2, postcure_min: 45,
  };

  // outputs from the hidden model + seeded noise
  const d = plan.d, p = plan.p;
  const visc = GT.viscosity(d, p) * (1 + 0.008 * gauss());
  const por = GT.porosity(d, p, plan.degas, (printStart - mixEnd) / HOUR) * Math.exp(0.08 * gauss());
  const uts = GT.uts(d, p, por) * (1 + 0.022 * gauss());
  const flex = GT.flexFromUts(uts) * (1 + 0.02 * gauss());
  const B = GT.brittleness(d);
  const elong = (1.6 + 6.0 * (1 - B)) * (B > 0.5 ? GT.knockdown(d, por) : 1) * (1 + 0.05 * gauss());
  const outputs: TrialOutputs = {
    viscosity_pa_s: r2(visc),
    porosity_pct: r2(por),
    uts_mpa: r1(uts),
    elongation_pct: r1(elong),
    fracture: B > 0.5 ? "brittle" : "ductile",
    flex_strength_mpa: r1(flex),
    flex_modulus_mpa: Math.round(GT.modulus(d, p, por) + 40 * gauss()),
    viability_pct: r1(GT.viability(d, p) + 1.2 * gauss()),
  };

  // log: weigh → mix → (degas) → viscosity → print → post-cure → test
  const batch = 50;
  add(mixStart - 18 * MIN, "weigh", "Balance", "mhs", "Weighed base monomer", r2(batch * (1 - (d + p) / 100)), "g");
  add(mixStart - 15 * MIN, "weigh", "Balance", "mhs", `Added diluent (${d}%)`, r2((batch * d) / 100), "g");
  add(mixStart - 12 * MIN, "weigh", "Balance", "mhs", `Added photoinitiator (${p}%)`, r2((batch * p) / 100), "g");
  add(mixStart, "mix", "Planetary mixer", "mhs", "Mix started", 3000, "rpm");
  add(mixEnd, "mix", "Planetary mixer", "mhs", "Mix ended", 2, "min");
  let tVisc = mixEnd + 6 * MIN;
  if (plan.degas > 0) {
    add(mixEnd + 3 * MIN, "degas", "Vacuum degasser", "manual", `Vacuum degas, ${plan.degas} min (from worksheet)`, plan.degas, "min");
    tVisc = mixEnd + 16 * MIN;
  }
  add(tVisc, "viscosity", "Viscometer", "mhs", "Viscosity at 25 °C", outputs.viscosity_pa_s, "Pa·s");
  add(printStart, "print", "DLP printer", "mhs", "Print job started: 6 dogbones + 3 bend bars");
  const printEnd = printStart + 85 * MIN;
  add(printEnd, "print", "DLP printer", "mhs", "Print job finished", 85, "min");
  add(printEnd + 15 * MIN, "postcure", "UV oven", "manual", "Post-cure at 60 °C", 45, "min");
  const testDay = iso(printStart).slice(0, 10);
  add(at(testDay, "10:05", 1), "test", "Test frame", "mhs", "Tensile: ultimate strength", outputs.uts_mpa, "MPa");
  add(at(testDay, "10:06", 1), "test", "Test frame", "mhs", `Tensile: elongation at break (${outputs.fracture})`, outputs.elongation_pct, "%");
  add(at(testDay, "10:40", 1), "test", "Test frame", "mhs", "3-pt bend: flexural strength", outputs.flex_strength_mpa, "MPa");
  add(at(testDay, "10:41", 1), "test", "Test frame", "mhs", "3-pt bend: flexural modulus", outputs.flex_modulus_mpa, "MPa");
  add(at(testDay, "11:15", 1), "test", "Cross-section imaging", "camera", "Cross-section porosity", outputs.porosity_pct, "%");
  add(at(testDay, "15:30", 3), "test", "Plate reader", "mhs", "Cell viability (extract test)", outputs.viability_pct, "%");

  const g = guardrailResults(outputs);
  const pass_all = Object.values(g).every(Boolean);
  return {
    id: plan.id, date: plan.date, owners: [owner], campaign: plan.campaign, parent, sop_version: "v1",
    inputs, outputs, guardrails: g, pass_all,
    meets_objective: pass_all && outputs.viscosity_pa_s <= OBJECTIVE_TARGET,
    excluded: Boolean(plan.excluded), ...(plan.excluded ? { excluded_reason: plan.excluded } : {}),
    notes: plan.notes(outputs).map(([step, text], i) => {
      // Written just after that step's last log entry, as a notebook entry would be.
      // (Test notes follow the cross-section image, when strength and bubbles are both known.)
      const last = (step === "test" ? log.find((e) => e.source === "camera") : [...log].reverse().find((e) => e.step === step)) ?? log[log.length - 1];
      return { id: `${plan.id}-N${i + 1}`, step, t: iso(Date.parse(last.t + "Z") + 4 * MIN), text };
    }),
    curve: tensileCurve(outputs), flex_curve: flexCurve(outputs), pores: pores(outputs.porosity_pct), log,
  };
}

const trials: Trial[] = [];
const lastByOwner: Partial<Record<PersonId, string>> = {};
for (const plan of PLANS) {
  trials.push(buildTrial(plan, lastByOwner[plan.owner] ?? null));
  lastByOwner[plan.owner] = plan.id;
}
const T = Object.fromEntries(trials.map((t) => [t.id, t])) as Record<string, Trial>;

// ---------- ledger seed ----------

const range = (ids: string[], f: (t: Trial) => number) => {
  const v = ids.map((id) => f(T[id]));
  return [Math.min(...v), Math.max(...v)];
};
const [aLo, aHi] = range(["T01", "T02", "T03", "T04", "T05"], (t) => t.outputs.viscosity_pa_s);
const bFails = ["T06", "T07", "T08", "T10"];
const [bUtsLo, bUtsHi] = range(bFails, (t) => t.outputs.uts_mpa);

const ledger: LedgerItem[] = [
  { id: "L1", kind: "finding", owner: "cooper", status: "accepted", recorded_at: "2025-01-21",
    text: `Low diluent (15–24%) passes every strength guardrail, but viscosity stays too high (${aLo.toFixed(2)}–${aHi.toFixed(2)} Pa·s).`,
    evidence: ["T01", "T02", "T03", "T04", "T05"] },
  { id: "L2", kind: "dead_end", owner: "cooper", status: "active", recorded_at: "2025-06-10",
    text: "Dead end: high diluent (> 30%) too brittle.",
    status_note: `Porous with brittle fracture; UTS ${bUtsLo}–${bUtsHi} MPa, below the 40 MPa floor in 4 of 4 included trials. T09 excluded as anomalous.`,
    evidence: bFails, region: { diluent: [30, 45], photoinit: [0.5, 1.3] } },
  { id: "L3", kind: "question", owner: "greeshma", status: "open", recorded_at: "2026-09-24",
    text: "Can we reach 1.5 Pa·s without new materials?", evidence: ["T14"] },
];

// ---------- fit models from the trials (not from GT) ----------

function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function ols(X: number[][], y: number[]) {
  const k = X[0].length;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, x) => s + x[i] * x[j], 0)));
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, x, r) => s + x[i] * y[r], 0));
  const b = solve(XtX, Xty);
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const pred = X.map((x) => x.reduce((s, v, i) => s + v * b[i], 0));
  const ssr = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0), sst = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  return { b, r2: 1 - ssr / sst };
}

function ridgeLogistic(raw: number[][], y: number[], lambda: number) {
  const k = raw[0].length;
  const means = Array.from({ length: k }, (_, j) => raw.reduce((s, r) => s + r[j], 0) / raw.length);
  const sds = Array.from({ length: k }, (_, j) => Math.sqrt(raw.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / raw.length) || 1);
  const X = raw.map((r) => [1, ...r.map((v, j) => (v - means[j]) / sds[j])]);
  let w = new Array(k + 1).fill(0);
  for (let it = 0; it < 100; it++) {
    const p = X.map((x) => 1 / (1 + Math.exp(-x.reduce((s, v, i) => s + v * w[i], 0))));
    const g = w.map((wi, i) => X.reduce((s, x, r) => s + x[i] * (p[r] - y[r]), 0) + (i > 0 ? lambda * wi : 0));
    const H = w.map((_, i) => w.map((_, j) => X.reduce((s, x, r) => s + x[i] * x[j] * p[r] * (1 - p[r]), 0) + (i === j && i > 0 ? lambda : 0)));
    const step = solve(H, g);
    w = w.map((wi, i) => wi - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return { w: w.map((v) => Math.round(v * 1e5) / 1e5), means: means.map((v) => Math.round(v * 1e4) / 1e4), sds: sds.map((v) => Math.round(v * 1e4) / 1e4) };
}

const LAMBDA = 1.0;
const visFit = ols(trials.map((t) => [1, t.inputs.diluent_wt, t.inputs.photoinit_wt]), trials.map((t) => Math.log(t.outputs.viscosity_pa_s)));
const porFit = ols(
  trials.map((t) => [1, t.inputs.diluent_wt, t.inputs.degas_min > 0 ? 1 : 0, t.inputs.rest_h]),
  trials.map((t) => Math.log(t.outputs.porosity_pct)),
);
// Strength and bend fall with diluent and with bubbles, more steeply when both are high (brittle + flaws).
const strengthX = (t: Trial) => [1, t.inputs.diluent_wt, t.inputs.photoinit_wt, t.outputs.porosity_pct, t.inputs.diluent_wt * t.outputs.porosity_pct];
const utsFit = ols(trials.map(strengthX), trials.map((t) => t.outputs.uts_mpa));
const flexFit = ols(trials.map(strengthX), trials.map((t) => t.outputs.flex_strength_mpa));
const viaFit = ols(trials.map((t) => [1, t.inputs.diluent_wt, t.inputs.diluent_wt ** 2, t.inputs.photoinit_wt]), trials.map((t) => t.outputs.viability_pct));
const teamTrials = trials.filter((t) => !t.excluded);
const teamFit = ridgeLogistic(teamTrials.map((t) => [t.inputs.diluent_wt]), teamTrials.map((t) => (t.pass_all ? 1 : 0)), LAMBDA);
const porPassFit = ridgeLogistic(
  trials.map((t) => [t.inputs.diluent_wt, t.inputs.photoinit_wt, Math.log(t.outputs.porosity_pct)]),
  trials.map((t) => (t.pass_all ? 1 : 0)), LAMBDA,
);
const rd = (x: number) => Math.round(x * 1e5) / 1e5;

const models: FittedModels = {
  viscosity: { b0: rd(visFit.b[0]), b_diluent: rd(visFit.b[1]), b_photoinit: rd(visFit.b[2]), r2: r2(visFit.r2), n: trials.length },
  porosity: { b0: rd(porFit.b[0]), b_diluent: rd(porFit.b[1]), b_degassed: rd(porFit.b[2]), b_rest_h: rd(porFit.b[3]), r2: r2(porFit.r2), n: trials.length },
  uts: { b: utsFit.b.map(rd), features: ["1", "diluent_wt", "photoinit_wt", "porosity_pct", "diluent_wt*porosity_pct"], r2: r2(utsFit.r2), n: trials.length },
  flex: { b: flexFit.b.map(rd), features: ["1", "diluent_wt", "photoinit_wt", "porosity_pct", "diluent_wt*porosity_pct"], r2: r2(flexFit.r2), n: trials.length },
  viability: { b: viaFit.b.map(rd), features: ["1", "diluent_wt", "diluent_wt^2", "photoinit_wt"], r2: r2(viaFit.r2), n: trials.length },
  pass_team: { ...teamFit, features: ["diluent_wt"], lambda: LAMBDA, n: teamTrials.length },
  pass_porosity: { ...porPassFit, features: ["diluent_wt", "photoinit_wt", "ln_porosity_pct"], lambda: LAMBDA, n: trials.length },
};

// ---------- landscape grids for the two lenses ----------

const DIL = Array.from({ length: 36 }, (_, i) => 10 + i); // 10..45
const PI_ = Array.from({ length: 16 }, (_, i) => r1(0.5 + i * 0.1)); // 0.5..2.0

function gridOf(f: (d: number, p: number) => number): LandscapeGrid {
  return { diluent: DIL, photoinit: PI_, p_pass: PI_.map((p) => DIL.map((d) => r2(f(d, p)))) };
}
function boundaryOf(grid: LandscapeGrid) {
  return grid.photoinit.map((p, row) => {
    const vals = grid.p_pass[row];
    for (let c = 1; c < vals.length; c++) {
      if (vals[c - 1] >= 0.5 && vals[c] < 0.5) {
        const x = (vals[c - 1] - 0.5) / (vals[c - 1] - vals[c]);
        return { photoinit: p, diluent: r1(grid.diluent[c - 1] + x * (grid.diluent[c] - grid.diluent[c - 1])) };
      }
    }
    return { photoinit: p, diluent: vals[0] < 0.5 ? grid.diluent[0] : null };
  });
}

const teamGrid = gridOf((d) => pPassTeam(models, d));
const degasGrid = gridOf((d, p) => pPassWithPorosity(models, d, p, predictPorosity(models, d, true, 0.5)));
const degassedTrials = trials.filter((t) => t.inputs.degas_min > 0);
const maxDegassedD = Math.max(...degassedTrials.map((t) => t.inputs.diluent_wt));

const lenses: Record<"team" | "degas", Lens> = {
  team: {
    id: "team", label: "As the team saw it",
    description: `All ${teamTrials.length} included trials pooled (T09 left out, as its owner excluded it). Pass/fail fitted on diluent, the variable the dead end was declared on.`,
    trials_used: teamTrials.map((t) => t.id), grid: teamGrid, boundary: boundaryOf(teamGrid), extrapolated_beyond: null,
  },
  degas: {
    id: "degas", label: "Split by degassing",
    description: `Predicted pass region for degassed resin. Bubbles (porosity) fitted from all ${trials.length} trials, then pass/fail on diluent, photoinitiator and bubbles. Only ${degassedTrials.length} degassed trials exist, all at ≤ ${maxDegassedD}% diluent; beyond that it's extrapolated, supported only by T09.`,
    trials_used: trials.map((t) => t.id), grid: degasGrid, boundary: boundaryOf(degasGrid), extrapolated_beyond: maxDegassedD,
  },
};

const viscosity_target_contour = PI_.map((p) => ({
  photoinit: p,
  diluent: r1((Math.log(OBJECTIVE_TARGET) - models.viscosity.b0 - models.viscosity.b_photoinit * p) / models.viscosity.b_diluent),
}));


// ---------- the lab around the project ----------
// Thrusts → projects → experiments. Only the notebook project has trials; its siblings exist so it isn't alone.

const span = (c: "A" | "B" | "G") => {
  const ds = trials.filter((t) => t.campaign === c).map((t) => t.date).sort();
  const m = (d: string) => new Date(d + "T12:00:00").toLocaleString("en-US", { month: "short", year: "numeric" });
  return `${m(ds[0])} – ${m(ds[ds.length - 1])}`;
};
const lastDate = project.now.slice(0, 10); // the notebook project is the one being worked on today

const org: Org = {
  thrusts: [
    { id: "materials", title: "Printable dental materials", blurb: "Resins that print faster and last longer.", funding: "R&D program DR-07" },
    { id: "access", title: "Accessible chairside dentistry", blurb: "Same-day parts on low-cost printers.", funding: "Clinic partnership pilot" },
    { id: "process", title: "Print process reliability", blurb: "Every printer and oven gives the same part.", funding: "Internal" },
    { id: "devices", title: "Bioresorbable devices", blurb: "Closed in 2025.", funding: "SBIR Phase I (fictional)", closed: true },
  ],
  projects: [
    { id: project.id, thrust: "materials", title: project.name, people: ["greeshma", "cooper"], last: lastDate,
      goal: `${project.objective.label}, every guardrail passing`, deliverable: "Formulation spec and a manuscript",
      why: project.objective.why, docs: ["Program proposal (2024)", `SOP ${project.sop.version}: resin prep and print`, "Guardrail sources"] },
    { id: "shade-match", thrust: "materials", title: "Match shades A1–A3 with two pigments", people: ["cooper"], last: "2025-05-30",
      goal: "Two pigments cover A1–A3 within ΔE 2", deliverable: "Pigment recipe", why: "Fewer pigments, fewer mixing errors.",
      docs: ["Shade guide scans"], known: [{ text: "One pigment reaches A1 and A2", cite: "Shade run 1" }],
      open: [{ text: "Can A3 be reached without a third?", cite: "" }] },
    { id: "chairside-fit", thrust: "access", title: "Same-day denture fit on a $3k printer", people: ["greeshma"], last: "2026-09-12",
      goal: "Fit within 50 µm from a low-cost printer", deliverable: "Clinic protocol", why: "Most clinics can't afford a lab printer.",
      docs: ["Pilot agreement"], known: [{ text: "First fit is within 80 µm", cite: "Fit test 1" }],
      open: [{ text: "Is the gap from the printer or the resin?", cite: "" }] },
    { id: "printer-drift", thrust: "process", title: "Measure printer-to-printer drift", people: ["greeshma"], last: "2026-10-02",
      goal: "Know how far printers 1 and 2 disagree", deliverable: "Calibration note", why: "Printer 2 isn't logged, so nobody has compared them.",
      docs: ["Draft proposal"], known: [], open: [{ text: "Is drift larger than fit tolerance?", cite: "" }] },
    { id: "fast-cure", thrust: "process", title: "Halve post-cure time", people: ["greeshma"], last: "2026-09-29",
      goal: "Post-cure in 25 min, no strength lost", deliverable: "Oven profile", why: "The UV oven is the bottleneck between print and test.",
      docs: ["Scoping note"], known: [{ text: "35 min is the shortest passing profile", cite: "Cure run 1" }],
      open: [{ text: "Does temperature matter more than time?", cite: "" }] },
    { id: "stent-resin", thrust: "devices", title: "Stent resin degradation in saline", people: ["cooper"], last: "2025-06-20",
      goal: "Hold strength 8 weeks, then degrade", deliverable: "Phase I report", why: "A resin that holds, then disappears.",
      docs: ["Phase I final report"], known: [], open: [] },
  ],
  experiments: [
    { id: "A", project: project.id, campaign: "A", title: "Low-diluent formulations", people: ["cooper"], when: span("A"), protocol: `SOP ${project.sop.version}` },
    { id: "B", project: project.id, campaign: "B", title: "High-diluent formulations", people: ["cooper"], when: span("B"), protocol: `SOP ${project.sop.version}` },
    { id: "G", project: project.id, campaign: "G", title: "Mid-diluent, high photoinitiator", people: ["greeshma"], when: span("G"), protocol: `SOP ${project.sop.version}` },
    { id: "cure-1", project: "fast-cure", title: "Cure profiles, round 1", people: ["greeshma"], when: "Sep 2026", protocol: "Oven SOP draft" },
    { id: "fit-1", project: "chairside-fit", title: "Fit test 1", people: ["greeshma"], when: "Sep 2026", protocol: "Fit SOP draft" },
    { id: "shade-1", project: "shade-match", title: "Shade run 1", people: ["cooper"], when: "May 2025", protocol: "Color SOP v1" },
  ],
};

// The room. Instruments carry the device names the trial logs use, so a trial traces to a place.
const src = (device: string) => stations.find((st) => st.device === device)?.source ?? "mhs";
const lab: Lab = {
  room: "Room 214",
  width: 1000, depth: 560,
  benches: [
    { name: "Formulation bench", x: 40, y: 40, w: 420, h: 80 },
    { name: "Print bay", x: 560, y: 40, w: 400, h: 80 },
    { name: "Test bench", x: 560, y: 440, w: 400, h: 80 },
    { name: "Prep bench", x: 140, y: 300, w: 260, h: 90 },
  ],
  fixtures: [
    { name: "Fume hood", x: 40, y: 440, w: 160, h: 80, z: 160 },
    { name: "Sink", x: 240, y: 460, w: 80, h: 60, z: 45 },
    { name: "Chemical shelf", x: 600, y: 250, w: 160, h: 50, z: 120 },
    { name: "Supply cabinet", x: 430, y: 300, w: 60, h: 90, z: 100 },
    { name: "Waste", x: 345, y: 470, w: 40, h: 40, z: 60 },
  ],
  // Today's other reservations (project.now is 09:30). In-use blocks come from in_use above.
  schedule: [
    { inst: "balance", by: "greeshma", from: "08:45", to: "09:15", what: "Cure profiles, round 2" },
    { inst: "viscometer", by: "greeshma", from: "09:15", to: "09:45", what: "Cure profiles, round 2" },
    { inst: "degasser", by: "greeshma", from: "10:15", to: "10:35", what: "Cure profiles, round 2" },
    { inst: "uv-oven", by: "greeshma", from: "12:00", to: "12:45", what: "Cure profiles, round 2" },
    { inst: "viscometer", by: "greeshma", from: "14:00", to: "14:30", what: "Shade run check" },
  ],
  consumables: [
    { id: "base", name: "Base monomer", home: "Chemical shelf" },
    { id: "diluent", name: "Diluent", home: "Chemical shelf" },
    { id: "pi", name: "Photoinitiator", home: "Chemical shelf" },
    { id: "cup", name: "Mixing cup", home: "Supply cabinet", back: "Waste" },
  ],
  instruments: [
    { id: "balance", name: "Balance", device: "Balance", source: src("Balance"), calibrated: "2026-09-02", x: 60, y: 55, w: 60, h: 50, z: 18 },
    { id: "mixer", name: "Planetary mixer", device: "Planetary mixer", source: src("Planetary mixer"), calibrated: "2026-06-11", x: 150, y: 50, w: 80, h: 60, z: 42,
      in_use: { by: "greeshma", from: "09:20", until: "10:10", what: "Cure profiles, round 2" } },
    { id: "degasser", name: "Vacuum degasser", device: "Vacuum degasser", source: src("Vacuum degasser"), calibrated: null, x: 260, y: 50, w: 80, h: 60, z: 46 },
    { id: "viscometer", name: "Viscometer", device: "Viscometer", source: src("Viscometer"), calibrated: "2026-08-20", x: 370, y: 55, w: 70, h: 50, z: 50 },
    { id: "printer-1", name: "DLP printer", device: "DLP printer", source: src("DLP printer"), calibrated: "2026-09-30", x: 580, y: 45, w: 100, h: 70, z: 70,
      in_use: { by: "greeshma", from: "09:25", until: "11:45", what: "Cure profiles, round 2" } },
    { id: "printer-2", name: "Printer 2", source: "none", calibrated: null, x: 700, y: 45, w: 100, h: 70, z: 70 },
    { id: "uv-oven", name: "UV oven", device: "UV oven", source: src("UV oven"), calibrated: "2025-11-04", x: 830, y: 50, w: 110, h: 60, z: 50 },
    { id: "test-frame", name: "Test frame", device: "Test frame", source: "mhs", calibrated: "2026-05-15", x: 580, y: 450, w: 110, h: 60, z: 90 },
    { id: "imaging", name: "Cross-section imaging", device: "Cross-section imaging", source: "camera", calibrated: "2026-07-01", x: 720, y: 455, w: 90, h: 50, z: 34 },
    { id: "plate-reader", name: "Plate reader", device: "Plate reader", source: "mhs", calibrated: "2026-04-09", x: 840, y: 455, w: 100, h: 50, z: 30 },
    { id: "hot-plate", name: "Hot plate", source: "none", calibrated: null, x: 170, y: 320, w: 60, h: 50, z: 12 },
  ],
};
const logDevices = new Set(trials.flatMap((t) => t.log.map((e) => e.device)));

// ---------- bench: T15a as a programmable protocol, run hands-free (Bench view) ----------
// Amounts are formulas over the protocol's parameters, so changing the batch (or overshooting a weigh) recalculates
// everything after it. The script overshoots the first weigh by 2%, the way a real batch drifts.

const benchParams = [
  { id: "batch_g", label: "Batch", value: 50, unit: "g" },
  { id: "diluent_pct", label: "Diluent", value: 38, unit: "%" },
  { id: "pi_pct", label: "Photoinitiator", value: 1.7, unit: "%" },
  { id: "mix_rpm", label: "Mix speed", value: 3000, unit: "rpm" },
  { id: "mix_min", label: "Mix time", value: 2, unit: "min" },
  { id: "degas_min", label: "Degas", value: 10, unit: "min" },
];
const benchSteps: BenchProtocol["steps"] = [
  { id: "base", station: "weigh", instrument: "balance", title: "Weigh base monomer", get: ["cup", "base"], put: [],
    detail: ["Place a clean cup on the balance", "Tare", "Pour base monomer slowly", "Stop just short and let it settle"],
    fields: [{ id: "base", label: "Base monomer", unit: "g", formula: "batch_g * (100 - diluent_pct - pi_pct) / 100", scales: true }] },
  { id: "diluent", station: "weigh", instrument: "balance", title: "Add diluent", get: ["diluent"], put: ["base"],
    detail: ["Keep the cup on the balance", "Pour diluent on top", "Pipette the last gram"],
    fields: [{ id: "diluent", label: "Diluent", unit: "g", formula: "batch_g * diluent_pct / 100", scales: true }] },
  { id: "pi", station: "weigh", instrument: "balance", title: "Add photoinitiator", get: ["pi"], put: ["diluent"],
    detail: ["Weigh the powder on a boat", "Tip it into the cup", "Keep it out of direct light"],
    fields: [{ id: "pi", label: "Photoinitiator", unit: "g", formula: "batch_g * pi_pct / 100", scales: true }] },
  { id: "mix", station: "mix", instrument: "mixer", title: "Mix", get: [], put: ["pi"], timer_min: 2,
    detail: ["Cap the cup", "Load it and balance the arm", "Run", "Check no powder is left"],
    fields: [{ id: "rpm", label: "Speed", unit: "rpm", formula: "mix_rpm" }, { id: "mix_min", label: "Time", unit: "min", formula: "mix_min" }] },
  { id: "degas", station: "degas", instrument: "degasser", title: "Degas", get: [], put: [], timer_min: 10,
    detail: ["Uncap the cup", "Place it in the chamber", "Pull vacuum", "Foam rises, then collapses", "Hold until no bubbles rise"],
    fields: [{ id: "degas_min", label: "Vacuum", unit: "min", formula: "degas_min" }] },
  { id: "print", station: "print", instrument: "printer-1", title: "Print", get: [], put: ["cup"], photo: true, timer_min: 85,
    detail: ["Pour resin into the vat", "Start the job: 6 dogbones, 3 bend bars", "Photograph the plate when it finishes", "Throw the cup away"],
    fields: [] },
];
const benchVal = Object.fromEntries(benchParams.map((x) => [x.id, x.value]));
const benchPlanned = evaluateAll(benchSteps.flatMap((x) => x.fields), benchVal).values;
const benchK = r1(benchPlanned.base * 1.02) / benchPlanned.base;
const said = (id: string) => r2(benchPlanned[id] * benchK);
const bench: BenchProtocol[] = [{
  id: "resin-batch",
  title: "Resin batch",
  runner: "greeshma",
  uploaded: project.now.slice(0, 10),
  last_run: "2026-10-09",
  next_run: "T15a", // the agent's proposed crossover arm; a run's name is filled in per run
  params: benchParams,
  steps: benchSteps,
  script: [
    { say: `Base monomer, ${r1(benchPlanned.base * benchK)} grams.`, step: "base", values: { base: r1(benchPlanned.base * benchK) } },
    { say: `Diluent, ${said("diluent")} grams.`, step: "diluent", values: { diluent: said("diluent") } },
    { say: `Photoinitiator, ${said("pi")} grams.`, step: "pi", values: { pi: said("pi") } },
    { say: `Mixed at ${benchVal.mix_rpm} for ${benchVal.mix_min} minutes.`, step: "mix", values: { rpm: benchVal.mix_rpm, mix_min: benchVal.mix_min } },
    { say: `Degassed ${benchVal.degas_min} minutes.`, step: "degas", values: { degas_min: benchVal.degas_min } },
    { say: "Photo.", step: "print", photo: "Build plate" },
  ],
}, {
  // A second, older protocol so the list has an order: Greeshma's post-cure, last run before T15a was drafted.
  id: "postcure",
  title: "Post-cure printed parts",
  runner: "greeshma",
  uploaded: "2026-09-14",
  last_run: "2026-10-02",
  params: [
    { id: "cure_c", label: "Oven", value: 60, unit: "°C" },
    { id: "cure_min", label: "Cure", value: 45, unit: "min" },
    { id: "parts", label: "Parts", value: 9, unit: "" },
  ],
  steps: [
    { id: "rinse", station: "postcure", instrument: "uv-oven", title: "Rinse parts", get: [], put: [],
      detail: ["Remove parts from the plate", "Rinse twice in IPA", "Let them dry fully"],
      fields: [{ id: "rinsed", label: "Parts rinsed", unit: "", formula: "parts" }] },
    { id: "cure", station: "postcure", instrument: "uv-oven", title: "Cure", get: [], put: [], timer_min: 45,
      detail: ["Preheat the oven", "Lay parts flat, not touching", "Run the cure", "Let parts cool before handling"],
      fields: [{ id: "oven_c", label: "Oven", unit: "°C", formula: "cure_c" }, { id: "oven_min", label: "Time", unit: "min", formula: "cure_min" }] },
  ],
  script: [
    { say: "Rinsed 9 parts.", step: "rinse", values: { rinsed: 9 } },
    { say: "Cured at 60 for 45 minutes.", step: "cure", values: { oven_c: 60, oven_min: 45 } },
  ],
}];

// ---------- assemble + write ----------

const notebook: Notebook = {
  meta: { generator: "data/generate.ts", seed: SEED, generated_at: project.now, synthetic: true },
  project, people, trials, ledger, org, lab, bench,
  landscape: { axes: { diluent: [10, 45], photoinit: [0.5, 2.0] }, viscosity_target_contour, lenses, models },
};
writeFileSync(join(HERE, "notebook.json"), JSON.stringify(notebook, null, 2) + "\n");

// ---------- ground truth (hidden; evals only) ----------

function truthAt(d: number, p: number, degas: number, rest_h = 0.5) {
  const por = GT.porosity(d, p, degas, rest_h);
  const uts = GT.uts(d, p, por);
  const o = {
    viscosity_pa_s: GT.viscosity(d, p), porosity_pct: por, uts_mpa: uts,
    flex_strength_mpa: GT.flexFromUts(uts), flex_modulus_mpa: GT.modulus(d, p, por), viability_pct: GT.viability(d, p),
  };
  const pass = o.uts_mpa >= 40 && o.flex_strength_mpa >= 65 && o.flex_modulus_mpa >= 2000 && o.porosity_pct <= 1.0 && o.viability_pct >= 70;
  return { ...o, pass };
}

let best = { d: 0, p: 0, v: Infinity };
const feasibleNearBest: { d: number; p: number; v: number }[] = [];
for (let d = 10; d <= 45.001; d += 0.1) {
  for (let p = 0.5; p <= 2.0001; p += 0.05) {
    const t = truthAt(d, p, 10);
    if (t.pass && t.viscosity_pa_s < best.v) best = { d: r1(d), p: r2(p), v: r2(t.viscosity_pa_s) };
  }
}
for (let d = 10; d <= 45.001; d += 0.1) for (let p = 0.5; p <= 2.0001; p += 0.05) {
  const t = truthAt(d, p, 10);
  if (t.pass && t.viscosity_pa_s <= best.v * 1.05) feasibleNearBest.push({ d: r1(d), p: r2(p), v: r2(t.viscosity_pa_s) });
}
const roundTruth = (o: ReturnType<typeof truthAt>) => ({
  viscosity_pa_s: r2(o.viscosity_pa_s), porosity_pct: r2(o.porosity_pct), uts_mpa: r1(o.uts_mpa),
  flex_strength_mpa: r1(o.flex_strength_mpa), viability_pct: r1(o.viability_pct), pass: o.pass,
});
const T15a = truthAt(38, 1.7, 10), T15b = truthAt(38, 1.7, 0);
const groundTruth = {
  note: "Hidden ground truth for evals and sanity checks. Never shown in the UI or given to the agent.",
  seed: SEED,
  true_best_degassed: best,
  near_best_region: {
    diluent: [Math.min(...feasibleNearBest.map((c) => c.d)), Math.max(...feasibleNearBest.map((c) => c.d))],
    photoinit: [Math.min(...feasibleNearBest.map((c) => c.p)), Math.max(...feasibleNearBest.map((c) => c.p))],
  },
  T15a: { recipe: { diluent_wt: 38, photoinit_wt: 1.7, degas_min: 10 }, outcome: roundTruth(T15a) },
  T15b: { recipe: { diluent_wt: 38, photoinit_wt: 1.7, degas_min: 0 }, outcome: roundTruth(T15b) },
  mechanism: "Pores are flaws; brittle (high-diluent) resin is flaw-sensitive. Undegassed thin resin holds 2–5% bubbles after <1 h, which drops strength below the floor above ~30% diluent. Degassing (or an 18 h rest, T09) removes the bubbles and the barrier.",
};
writeFileSync(join(HERE, "ground_truth.json"), JSON.stringify(groundTruth, null, 2) + "\n");

// ---------- verification ----------

const strength = (t: Trial) => t.guardrails.tensile && t.guardrails.bend;
const checks: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => checks.push([name, ok, detail]);
const A = ["T01", "T02", "T03", "T04", "T05"].map((id) => T[id]);
const Bc = ["T06", "T07", "T08", "T09", "T10"].map((id) => T[id]);
const G = ["T11", "T12", "T13", "T14"].map((id) => T[id]);

check("Campaign A passes strength", A.every(strength));
check("Campaign A misses viscosity (> 1.5)", A.every((t) => t.outputs.viscosity_pa_s > 1.5), A.map((t) => t.outputs.viscosity_pa_s).join(", "));
check("Campaign B meets viscosity (≤ 1.5)", Bc.every((t) => t.outputs.viscosity_pa_s <= 1.5), Bc.map((t) => t.outputs.viscosity_pa_s).join(", "));
check("Campaign B fails strength except T09", bFails.every((id) => !strength(T[id])) && strength(T.T09));
check("T09 passes every guardrail", T.T09.pass_all, `porosity ${T.T09.outputs.porosity_pct}%, UTS ${T.T09.outputs.uts_mpa}`);
check("T09 rested ~18 h (from log)", T.T09.inputs.rest_h >= 17.5 && T.T09.inputs.rest_h <= 18.5, `${T.T09.inputs.rest_h} h`);
check("T09 porosity ≈ 0.4%", T.T09.outputs.porosity_pct >= 0.3 && T.T09.outputs.porosity_pct <= 0.5, `${T.T09.outputs.porosity_pct}%`);
check("Only T09 rested > 2 h", trials.filter((t) => t.inputs.rest_h > 2).map((t) => t.id).join() === "T09");
check("T09 notes don't mention the rest", !T.T09.notes.some((n) => /rest|overnight|next day|18 ?h/i.test(n.text)));
check("All Greeshma trials pass every guardrail", G.every((t) => t.pass_all));
check("Greeshma best viscosity = 1.55", Math.min(...G.map((t) => t.outputs.viscosity_pa_s)) === 1.55, G.map((t) => t.outputs.viscosity_pa_s).join(", "));
check("Only Greeshma degassed", trials.filter((t) => t.inputs.degas_min > 0).every((t) => t.owners[0] === "greeshma") && G.every((t) => t.inputs.degas_min === 10));
check("Every high-diluent (> 30%) strength failure was undegassed", trials.filter((t) => t.inputs.diluent_wt > 30 && !strength(t)).every((t) => t.inputs.degas_min === 0));
check("True best (degassed) at 38–42% diluent", best.d >= 38 && best.d <= 42, `${best.d}% diluent, ${best.p}% PI, ${best.v} Pa·s`);
check("True best photoinitiator ≈ 1.6%", best.p >= 1.5 && best.p <= 1.7);
check("No trial in the T15 cell (38%, 1.7%)", !trials.some((t) => Math.abs(t.inputs.diluent_wt - 38) < 1 && Math.abs(t.inputs.photoinit_wt - 1.7) < 0.1));
check("Truth: T15a passes and meets target", T15a.pass && T15a.viscosity_pa_s <= 1.5, `${r2(T15a.viscosity_pa_s)} Pa·s, UTS ${r1(T15a.uts_mpa)}, por ${r2(T15a.porosity_pct)}%`);
check("Truth: T15b (control) fails strength", T15b.uts_mpa < 40 || T15b.flex_strength_mpa < 65, `UTS ${r1(T15b.uts_mpa)}, por ${r2(T15b.porosity_pct)}%`);
const teamWall = lenses.team.boundary.map((b) => b.diluent).filter((x): x is number => x !== null);
const wallAt = (lens: Lens, p: number) => lens.boundary.find((b) => Math.abs(b.photoinit - p) < 1e-6)?.diluent ?? null;
check("Team lens: vertical wall at ~30–34%", teamWall.length === 16 && Math.min(...teamWall) >= 29 && Math.max(...teamWall) <= 34, `wall: ${teamWall[0]}%`);
const degasWall17 = wallAt(lenses.degas, 1.7);
check("Degas lens: barrier recedes past 40% at PI 1.7", degasWall17 === null || degasWall17 > 40, `PI 1.7 wall: ${degasWall17 ?? "off map"}`);
check("Campaign B and T15a pass cytotoxicity with margin (≥ 72%)", [...Bc].every((t) => t.outputs.viability_pct >= 72) && GT.viability(38, 1.7) >= 72);
check("Dead-end hatch covers campaign B", Bc.every((t) => t.inputs.diluent_wt >= 30 && t.inputs.photoinit_wt <= 1.3));
check("Greeshma's points sit outside the hatch", G.every((t) => t.inputs.photoinit_wt > 1.3));
{
  const masses = bench[0].steps.flatMap((x) => x.fields).filter((f) => f.scales);
  const sum = r2(masses.reduce((acc, f) => acc + benchPlanned[f.id], 0));
  check("Bench resin-batch masses sum to the batch", sum === benchVal.batch_g, `${sum} g`);
  const homes = new Set(lab.fixtures.map((f) => f.name));
  check("Bench steps use lab instruments and consumables kept in the lab",
    bench[0].steps.every((x) => lab.instruments.some((i) => i.id === x.instrument) && [...x.get, ...x.put].every((c) => lab.consumables.some((k) => k.id === c)))
      && lab.consumables.every((k) => homes.has(k.home) && (!k.back || homes.has(k.back))));
}

console.log("\nTrials (synthetic, seed " + SEED + ")\n");
console.log("id   owner     camp  dil%  PI%   degas rest_h  visc   por%   UTS   flex  viab  fract    T B P C  all  note");
for (const t of trials) {
  const g = t.guardrails, f = (b: boolean) => (b ? "✓" : "✗");
  console.log(
    [t.id.padEnd(4), t.owners[0].padEnd(9), t.campaign.padEnd(5), String(t.inputs.diluent_wt).padEnd(5), String(t.inputs.photoinit_wt).padEnd(5),
      String(t.inputs.degas_min).padEnd(5), String(t.inputs.rest_h).padEnd(7), t.outputs.viscosity_pa_s.toFixed(2).padEnd(6),
      t.outputs.porosity_pct.toFixed(2).padEnd(6), String(t.outputs.uts_mpa).padEnd(5), String(t.outputs.flex_strength_mpa).padEnd(5),
      String(t.outputs.viability_pct).padEnd(5), t.outputs.fracture.padEnd(8), `${f(g.tensile)} ${f(g.bend)} ${f(g.porosity)} ${f(g.cytotox)}`,
      (t.pass_all ? "PASS" : "fail").padEnd(4), t.excluded ? "EXCLUDED" : ""].join(" "),
  );
}
console.log("\nFitted models: ln(visc) R² " + models.viscosity.r2 + " · ln(porosity) R² " + models.porosity.r2 + " · UTS R² " + models.uts.r2 + " · flex R² " + models.flex.r2 + " · viability R² " + models.viability.r2);
{
  const est = (deg: number) => estimateRecipe(models, { diluent_wt: 38, photoinit_wt: 1.7, degas_min: deg });
  const a = est(10), b = est(0);
  console.log(`Estimates (fitted): T15a UTS ${a.uts_mpa} flex ${a.flex_strength_mpa} via ${a.viability_pct} por ${a.porosity_pct} · T15b UTS ${b.uts_mpa} flex ${b.flex_strength_mpa} por ${b.porosity_pct}`);
  check("Fitted estimates: T15a clears strength floors, T15b doesn't", a.uts_mpa >= 40 && a.flex_strength_mpa >= 65 && b.uts_mpa < 40, `T15a ${a.uts_mpa}/${a.flex_strength_mpa}, T15b ${b.uts_mpa}/${b.flex_strength_mpa}`);
}
console.log("Team-lens wall by PI:  " + lenses.team.boundary.map((b) => `${b.photoinit}:${b.diluent ?? "—"}`).join("  "));
console.log("Degas-lens wall by PI: " + lenses.degas.boundary.map((b) => `${b.photoinit}:${b.diluent ?? "—"}`).join("  "));
console.log("Viscosity 1.5 contour: " + viscosity_target_contour.map((c) => `${c.photoinit}:${c.diluent}`).join("  "));
console.log(`True best (degassed): ${best.d}% diluent, ${best.p}% PI → ${best.v} Pa·s. Near-best region: diluent ${groundTruth.near_best_region.diluent.join("–")}, PI ${groundTruth.near_best_region.photoinit.join("–")}`);
check("Every logged device is an instrument in the lab", [...logDevices].every((d) => lab.instruments.some((i) => i.device === d)), [...logDevices].filter((d) => !lab.instruments.some((i) => i.device === d)).join(", "));
check("Every trial campaign is an experiment", ["A", "B", "G"].every((c) => org.experiments.some((x) => x.campaign === c)));
console.log("\nVerification\n");
for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
const failed = checks.filter((c) => !c[1]).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed) process.exit(1);
