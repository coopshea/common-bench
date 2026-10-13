// Stress haystack generator: seeded, synthetic, eval-only.
//
// Writes notebooks in the same `Notebook` shape as data/notebook.json, at several sizes, with
// 8 fictional people (Cooper and Greeshma plus six invented colleagues), multiple campaigns,
// full step-by-step logs and notes. Then plants needles and traps at every size, and builds the
// question set from the generated data (evals/stress/questions.ts).
//
// It only READS data/notebook.json (project, SOP, guardrails, fitted models). It never writes it,
// and never touches data/generate.ts. The demo dataset stays exactly as it is.
//
// Run:  npx tsx evals/stress/generate-haystack.ts [--sizes 50,250,1000] [--seed 11]
// Out:  evals/stress/data/notebook-<size>.json, evals/stress/data/plants-<size>.json,
//       evals/stress/questions-<size>.json

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Campaign,
  GuardrailId,
  LedgerItem,
  LogEntry,
  LogSource,
  NoteEntry,
  Notebook,
  Person,
  PersonId,
  Pore,
  StepId,
  Trial,
  TrialOutputs,
} from "../../src/shared/types.ts";
import { buildQuestions } from "./questions.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "../..");
const demo: Notebook = JSON.parse(readFileSync(join(appRoot, "data/notebook.json"), "utf8"));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

// ---------- rng ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const uni = (r: Rng, a: number, b: number) => a + (b - a) * r();
const randint = (r: Rng, a: number, b: number) => Math.floor(uni(r, a, b + 1));
const pick = <T,>(r: Rng, xs: T[]): T => xs[Math.floor(r() * xs.length)];
function gauss(r: Rng): number {
  const u = Math.max(r(), 1e-12);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------- time (minutes since 2024-01-01T00:00, formatted as local ISO without zone) ----------

const EPOCH = Date.UTC(2024, 0, 1);
const dayOf = (iso: string) => Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - EPOCH) / 60000);
const fmt = (m: number) => new Date(EPOCH + Math.round(m) * 60000).toISOString().slice(0, 19);
const dateOf = (m: number) => fmt(m).slice(0, 10);
const startOfDay = (m: number) => Math.floor(m / 1440) * 1440;

// ---------- the team (fictional except Cooper and Greeshma, who match the demo) ----------

interface CampaignSpec {
  code: string;
  dil: [number, number];
  pi: [number, number];
}
interface PersonSpec {
  id: string;
  name: string;
  initials: string;
  role: string;
  color: string;
  joined: string;
  left?: string;
  campaigns: CampaignSpec[];
  degas: number; // minutes, 0 = never
  prewarm?: boolean; // warms resin before printing (habit, never logged by a device)
}

const PEOPLE: PersonSpec[] = [
  { id: "tomas", name: "Tomás Herrera", initials: "TH", role: "Former member · process", color: "#8C6BB1", joined: "2024-01-08", left: "2025-09-26", degas: 0,
    campaigns: [{ code: "M", dil: [18, 30], pi: [0.8, 1.4] }, { code: "N", dil: [24, 34], pi: [1.8, 2.4] }] },
  { id: "dana_whitfield", name: "Dana Whitfield", initials: "DW", role: "Senior scientist · formulation", color: "#2E8B57", joined: "2024-03-04", degas: 0,
    campaigns: [{ code: "C", dil: [14, 26], pi: [0.6, 1.2] }, { code: "D", dil: [22, 34], pi: [1.0, 1.6] }] },
  { id: "ravi", name: "Ravi Menon", initials: "RM", role: "Former member · formulation", color: "#C28A2B", joined: "2024-06-03", left: "2026-03-20", degas: 0,
    campaigns: [{ code: "F", dil: [26, 36], pi: [1.0, 1.6] }, { code: "H", dil: [30, 40], pi: [1.2, 1.8] }] },
  { id: "cooper", name: "Cooper Shea", initials: "CS", role: "Former member · formulation", color: "#3B6FD8", joined: "2024-09-16", left: "2025-06-27", degas: 0,
    campaigns: [{ code: "A", dil: [15, 24], pi: [0.6, 1.0] }, { code: "B", dil: [34, 40], pi: [0.8, 1.2] }] },
  { id: "dana_whitford", name: "Dana Whitford", initials: "DF", role: "Scientist · printing", color: "#1F9AA8", joined: "2025-02-10", degas: 5,
    campaigns: [{ code: "E", dil: [36, 46], pi: [1.2, 1.8] }] },
  { id: "lucia", name: "Lucia Ferreira", initials: "LF", role: "Scientist · formulation", color: "#D4537E", joined: "2025-05-12", degas: 0, prewarm: true,
    campaigns: [{ code: "K", dil: [28, 38], pi: [1.2, 1.8] }] },
  { id: "ines", name: "Ines Kowalski", initials: "IK", role: "Scientist · materials", color: "#6B8E23", joined: "2025-09-15", degas: 10,
    campaigns: [{ code: "P", dil: [30, 42], pi: [1.4, 2.0] }] },
  { id: "greeshma", name: "Greeshma", initials: "GN", role: "Scientist · formulation", color: "#E4674F", joined: "2026-07-06", degas: 10,
    campaigns: [{ code: "G", dil: [26, 34], pi: [1.5, 1.8] }] },
];
const spec = (id: string) => PEOPLE.find((p) => p.id === id)!;

const FIRST_DAY = dayOf("2024-01-08");
const LAST_DAY = dayOf("2026-10-09");
const NOW = "2026-10-13T09:30:00";
const MIXER2_FROM = dayOf("2025-11-03");
const MIXER2_TO = dayOf("2026-02-13") + 1439;
const BACKFILL_BEFORE = dayOf("2025-07-01");
const PAIR_FROM = dayOf("2025-05-19");
const PAIR_TO = dayOf("2025-10-24");
const POSTCURE30_BEFORE = dayOf("2024-07-01");

const active = (p: PersonSpec, day: number) => dayOf(p.joined) <= day && (!p.left || day <= dayOf(p.left));

// ---------- planted facts (written next to each notebook; questions read them only to know WHICH trial to ask about) ----------

export interface Plants {
  size: number;
  overnight_rest: string; // T09-like: rested overnight before printing, excluded as a lucky specimen
  postcure_delay: string; // parts sat > 1 day between print end and post-cure (log only)
  print_restart: string; // print job aborted and restarted (log only)
  near_dup: { ravi: string; lucia: string }; // same recipe; Lucia pre-warms (notes only)
  prewarm_notes: string[]; // Lucia trials whose notes mention the pre-warm
  contradictions: { tensile: string; viscosity: string; porosity: string };
  whitford_44: string; // Dana Whitford trial at 44% diluent (Whitfield has none)
  pi_24: string; // a trial at 2.4% PI (none at 2.5%)
  superseded: { old: string; new: string };
  mixer2_window: [string, string];
}

// ---------- physics (simple, directionally plausible; same story as the demo) ----------

interface Ctx {
  dil: number;
  pi: number;
  degas: number;
  restH: number;
  mixer2: boolean;
  prewarm: boolean;
  postcure: number;
}

function physics(r: Rng, c: Ctx): TrialOutputs {
  const visc = r2(2.6 * Math.exp(-0.03 * (c.dil - 15) - 0.06 * (c.pi - 0.8) + 0.02 * gauss(r)));
  // thin resin folds in more air; degassing pulls it out; bubbles rise out while resin rests
  let por = 0.3 * Math.exp(0.105 * (c.dil - 15));
  if (c.mixer2) por *= 2.2;
  if (c.degas >= 10) por *= 0.12;
  else if (c.degas > 0) por *= 0.25;
  por *= Math.exp(-c.restH / 5.5);
  if (c.prewarm) por *= 0.3;
  por *= Math.exp(0.12 * gauss(r));
  const porosity = Math.max(0.05, r2(por));
  // brittle materials are flaw-sensitive: bubbles cost more strength at high diluent
  const pen = porosity * (1 + 0.15 * Math.max(0, c.dil - 20));
  const uts = r1(55 - 0.3 * (c.dil - 15) + 2 * (c.pi - 1) - pen - (c.postcure < 45 ? 3 : 0) + 1.2 * gauss(r));
  const elong = r1(Math.max(1.2, 6.2 - 0.09 * (c.dil - 15) - 0.3 * porosity + 0.3 * gauss(r)));
  const fracture: TrialOutputs["fracture"] = c.dil >= 28 || porosity > 1.5 ? "brittle" : "ductile";
  const flex = r1(1.62 * uts + 1.5 * gauss(r));
  const modulus = Math.round(2250 + 12 * (c.dil - 15) - 40 * porosity + 40 * gauss(r));
  const viability = r1(Math.min(97, 94 - 70 * Math.max(0, c.pi - 2.05) - 0.3 * Math.max(0, c.dil - 40) + 2 * gauss(r)));
  return {
    viscosity_pa_s: visc,
    porosity_pct: porosity,
    uts_mpa: uts,
    elongation_pct: elong,
    fracture,
    flex_strength_mpa: flex,
    flex_modulus_mpa: modulus,
    viability_pct: viability,
  };
}

function guardrailsOf(o: TrialOutputs): Record<GuardrailId, boolean> {
  return {
    tensile: o.uts_mpa >= 40,
    bend: o.flex_strength_mpa >= 65 && o.flex_modulus_mpa >= 2000,
    porosity: o.porosity_pct <= 1.0,
    cytotox: o.viability_pct >= 70,
  };
}

// ---------- one notebook ----------

interface Draft {
  day: number;
  start: number; // minutes
  owner: string;
  campaign: string;
  id: string;
  parent: string | null;
  dil: number;
  pi: number;
  degas: number;
  restMin: number;
  postcureDelayMin: number;
  postcure: number;
  prewarm: boolean;
  mixer2: boolean;
  restart: boolean;
  excluded: boolean;
  excludedReason?: string;
}

const EXCLUDE_REASONS = [
  "Balance drifted during weighing; recipe not trusted.",
  "Two dogbones slipped in the grips; tensile not trusted.",
  "Plate reader run flagged for contamination; repeat planned.",
  "Printed on a scratched vat film; parts not representative.",
];

export function generate(size: number, seed: number): { nb: Notebook; plants: Plants } {
  const r = mulberry32(seed * 7919 + size);

  // 1. dates (weekdays), sorted
  const days: number[] = [];
  for (let i = 0; i < size; i++) {
    let d = startOfDay(Math.floor(uni(r, FIRST_DAY, LAST_DAY)));
    const dow = new Date(EPOCH + d * 60000).getUTCDay();
    if (dow === 6) d += 2 * 1440;
    if (dow === 0) d += 1440;
    days.push(Math.min(d, LAST_DAY));
  }
  days.sort((a, b) => a - b);

  // 2. owners: anyone active that day, equal weight
  const drafts: Draft[] = days.map((day) => {
    const act = PEOPLE.filter((p) => active(p, day));
    const owner = pick(r, act).id;
    return {
      day, start: day + 9 * 60 + randint(r, 0, 300), owner, campaign: "", id: "", parent: null,
      dil: 0, pi: 0, degas: 0, restMin: 0, postcureDelayMin: 0, postcure: 45, prewarm: false, mixer2: false, restart: false, excluded: false,
    };
  });

  // 3. make sure every planted situation has the trials it needs (reassign owners within the person's window)
  const ensure = (owner: string, n: number, from: number, to: number, avoid: string[] = []) => {
    const have = drafts.filter((d) => d.owner === owner && d.day >= from && d.day <= to).length;
    let need = n - have;
    const p = spec(owner);
    const cands = drafts.filter((d) => d.day >= from && d.day <= to && active(p, d.day) && d.owner !== owner && !avoid.includes(d.owner));
    // take from the most common owner in the window first so nobody is emptied
    while (need > 0 && cands.length) {
      const counts = new Map<string, number>();
      for (const d of drafts) counts.set(d.owner, (counts.get(d.owner) ?? 0) + 1);
      cands.sort((a, b) => (counts.get(b.owner) ?? 0) - (counts.get(a.owner) ?? 0));
      const c = cands.shift()!;
      if ((counts.get(c.owner) ?? 0) <= 3) continue;
      c.owner = owner;
      need--;
    }
    if (need > 0) throw new Error(`size ${size}: can't give ${owner} ${n} trials in window`);
  };
  ensure("ravi", 2, PAIR_FROM, PAIR_TO, ["lucia"]);
  ensure("lucia", 2, PAIR_FROM, PAIR_TO, ["ravi"]);
  ensure("ines", 4, dayOf("2025-09-15"), LAST_DAY);
  ensure("dana_whitford", 4, dayOf("2025-02-10"), LAST_DAY);
  ensure("greeshma", 2, dayOf("2026-07-06"), LAST_DAY);
  ensure("cooper", 3, dayOf("2024-09-16"), dayOf("2025-06-27"));
  ensure("tomas", 3, FIRST_DAY, POSTCURE30_BEFORE - 1);
  ensure("tomas", 3, dayOf("2024-11-15"), dayOf("2025-09-26"));
  ensure("dana_whitfield", 3, FIRST_DAY, LAST_DAY);

  // 4. ids in date order, then campaigns and parents
  drafts.sort((a, b) => a.start - b.start);
  drafts.forEach((d, i) => (d.id = `T${String(i + 1).padStart(2, "0")}`));
  for (const p of PEOPLE) {
    const mine = drafts.filter((d) => d.owner === p.id);
    const from = dayOf(p.joined);
    const to = p.left ? dayOf(p.left) : LAST_DAY;
    let prevByCampaign = new Map<string, string>();
    for (const d of mine) {
      const k = Math.min(p.campaigns.length - 1, Math.floor(((d.day - from) / Math.max(1, to - from)) * p.campaigns.length));
      const c = p.campaigns[k];
      d.campaign = c.code;
      d.parent = prevByCampaign.get(c.code) ?? null;
      prevByCampaign.set(c.code, d.id);
      d.dil = randint(r, c.dil[0], c.dil[1]);
      d.pi = r1(uni(r, c.pi[0], c.pi[1]));
      d.degas = p.degas;
      d.prewarm = !!p.prewarm;
      d.postcure = p.id === "tomas" && d.day < POSTCURE30_BEFORE ? 30 : 45;
    }
    prevByCampaign = new Map();
  }
  for (const d of drafts) {
    d.mixer2 = d.start >= MIXER2_FROM && d.start <= MIXER2_TO;
    d.restMin = d.degas > 0 ? randint(r, 28, 45) : randint(r, 18, 42);
    d.postcureDelayMin = randint(r, 10, 20);
  }

  // 5. distractors: lunch-break rests (2–5.5 h), slow post-cures (1.5–4 h) and a couple of overnight post-cures (14–18 h)
  const taken = new Set<string>();
  const freeDrafts = (pred: (d: Draft) => boolean) => drafts.filter((d) => !taken.has(d.id) && pred(d));
  const nLunch = Math.max(2, Math.round(size * 0.025));
  for (let i = 0; i < nLunch; i++) {
    const d = pick(r, freeDrafts(() => true));
    d.restMin = randint(r, 120, 330);
  }
  const nSlow = Math.max(2, Math.round(size * 0.02));
  for (let i = 0; i < nSlow; i++) pick(r, freeDrafts(() => true)).postcureDelayMin = randint(r, 90, 240);
  for (let i = 0; i < 2; i++) pick(r, freeDrafts((d) => d.postcureDelayMin < 60)).postcureDelayMin = randint(r, 840, 1080);

  // 6. plants
  const claim = (pred: (d: Draft) => boolean, what: string): Draft => {
    const cands = freeDrafts(pred);
    if (!cands.length) throw new Error(`size ${size}: no candidate for ${what}`);
    const d = pick(r, cands);
    taken.add(d.id);
    return d;
  };
  const plain = (d: Draft) => d.restMin < 60 && d.postcureDelayMin < 60;

  // near-duplicate recipe: Ravi and Lucia, same inputs, both on mixer #1
  const ravi = claim((d) => d.owner === "ravi" && d.day >= PAIR_FROM && d.day <= PAIR_TO && plain(d), "near-dup ravi");
  const lucia = claim((d) => d.owner === "lucia" && d.day >= PAIR_FROM && d.day <= PAIR_TO && plain(d), "near-dup lucia");
  ravi.dil = 34;
  ravi.pi = 1.4;
  Object.assign(lucia, { dil: ravi.dil, pi: ravi.pi, degas: 0, restMin: ravi.restMin, postcure: ravi.postcure });
  const prewarmNotes = [lucia.id];
  for (const d of freeDrafts((x) => x.owner === "lucia").slice(0, 2)) prewarmNotes.push(d.id);

  // T09-like overnight rest, undegassed high diluent, excluded as a lucky specimen
  const overnight = claim((d) => d.degas === 0 && !d.prewarm && !d.mixer2 && d.dil >= 33 && plain(d), "overnight rest");
  overnight.restMin = 1164 + randint(r, 0, 20); // ~19.4 h
  // keep its start late in the afternoon so mixing ends ~16:40 and printing starts next day
  overnight.start = overnight.day + 16 * 60 + 10;
  overnight.excluded = true;
  overnight.excludedReason = "Anomalously strong for its recipe; probably a lucky specimen.";

  const postcureDelay = claim((d) => plain(d), "post-cure delay");
  postcureDelay.postcureDelayMin = 1872; // 31.2 h
  const restart = claim((d) => plain(d) && d.parent !== null, "print restart");
  restart.restart = true;

  // contradictions: chosen after outputs exist (below)

  // Whitford at exactly 44% diluent (Whitfield never goes above 34%)
  const w44 = claim((d) => d.owner === "dana_whitford" && plain(d), "whitford 44");
  w44.dil = 44;
  // someone at exactly 2.4% PI (nobody at 2.5%)
  const pi24 = claim((d) => d.owner === "tomas" && d.campaign === "N" && plain(d), "pi 2.4");
  pi24.pi = 2.4;
  // Ines trial that will read thick (her note will claim otherwise)
  const inesThick = claim((d) => d.owner === "ines" && plain(d) && !d.mixer2, "ines thick");
  inesThick.dil = 28;
  inesThick.pi = 1.4;

  // random exclusions (~2%)
  const nEx = Math.max(1, Math.round(size * 0.02));
  for (let i = 0; i < nEx; i++) {
    const d = pick(r, freeDrafts((x) => !x.excluded));
    d.excluded = true;
    d.excludedReason = pick(r, EXCLUDE_REASONS);
  }

  // 7. build trials
  const trials: Trial[] = [];
  for (const d of drafts) {
    const restH = d.restMin / 60;
    const out = physics(r, { dil: d.dil, pi: d.pi, degas: d.degas, restH, mixer2: d.mixer2, prewarm: d.prewarm, postcure: d.postcure });
    trials.push(buildTrial(r, d, out));
  }
  const byId = new Map(trials.map((t) => [t.id, t]));

  // contradictions: pick by measured outputs
  const pickTrial = (pred: (t: Trial) => boolean, what: string): Trial => {
    const cands = trials.filter((t) => !taken.has(t.id) && pred(t));
    if (!cands.length) throw new Error(`size ${size}: no candidate for ${what}`);
    const t = pick(r, cands);
    taken.add(t.id);
    return t;
  };
  const cTensile = pickTrial((t) => t.outputs.uts_mpa >= 32 && t.outputs.uts_mpa < 38.5 && !t.excluded, "tensile contradiction");
  addNote(cTensile, "test", "Tensile looked solid, comfortably over the 40 MPa floor.");
  const cVisc = byId.get(inesThick.id)!;
  if (cVisc.outputs.viscosity_pa_s < 1.6) throw new Error(`size ${size}: Ines thick trial too thin (${cVisc.outputs.viscosity_pa_s})`);
  addNote(cVisc, "viscosity", "Viscometer read about 1.3 Pa·s, finally under target!");
  const cPor = pickTrial((t) => t.outputs.porosity_pct >= 1.5 && !t.excluded, "porosity contradiction");
  addNote(cPor, "test", "No bubbles visible in the cross-section; porosity basically zero.");
  for (const id of prewarmNotes) addNote(byId.get(id)!, "print", "Warmed the resin to 40 °C in the oven for 20 min before loading the vat, as I always do.");

  // 8. ledger
  const ledger = buildLedger(trials, { superseded: true });
  const supOld = ledger.find((l) => l.text.startsWith("Post-cure for 30 min"))!;
  const supNew = ledger.find((l) => l.text.startsWith(`Corrects ${supOld.id}`))!;

  // 9. assemble
  const people: Person[] = PEOPLE.map((p) => ({
    id: p.id as PersonId,
    name: p.name,
    initials: p.initials,
    role: p.role,
    color: p.color,
    joined: p.joined,
    ...(p.left ? { left: p.left } : {}),
    status: p.left ? "former" : "current",
  }));
  const project = structuredClone(demo.project);
  project.now = NOW;
  project.synthetic_label = `Synthetic data · stress haystack (${size} trials, eval only)`;
  project.team = people.filter((p) => p.status === "current").map((p) => p.id);
  const landscape = structuredClone(demo.landscape);
  for (const lens of Object.values(landscape.lenses)) {
    lens.trials_used = [];
    lens.boundary = [];
    lens.description = "Not fitted for the stress haystack.";
  }
  const nb: Notebook = {
    meta: { generator: "evals/stress/generate-haystack.ts", seed, generated_at: NOW, synthetic: true },
    project,
    people,
    trials,
    ledger,
    landscape,
  };
  const plants: Plants = {
    size,
    overnight_rest: overnight.id,
    postcure_delay: postcureDelay.id,
    print_restart: restart.id,
    near_dup: { ravi: ravi.id, lucia: lucia.id },
    prewarm_notes: prewarmNotes,
    contradictions: { tensile: cTensile.id, viscosity: cVisc.id, porosity: cPor.id },
    whitford_44: w44.id,
    pi_24: pi24.id,
    superseded: { old: supOld.id, new: supNew.id },
    mixer2_window: [dateOf(MIXER2_FROM), dateOf(MIXER2_TO)],
  };
  return { nb, plants };
}

// ---------- trial: log, notes, curves ----------

function addNote(t: Trial, step: StepId, text: string) {
  const at = t.log.filter((e) => e.step === step).at(-1) ?? t.log.at(-1)!;
  const m = (Date.parse(`${at.t}Z`) - EPOCH) / 60000 + 4;
  t.notes.push({ id: `${t.id}-N${t.notes.length + 1}`, step, t: fmt(m), text });
  t.notes.sort((a, b) => a.t.localeCompare(b.t));
  t.notes.forEach((n, i) => (n.id = `${t.id}-N${i + 1}`));
}

function buildTrial(r: Rng, d: Draft, out: TrialOutputs): Trial {
  const g = guardrailsOf(out);
  const pass = g.tensile && g.bend && g.porosity && g.cytotox;
  const log: LogEntry[] = [];
  const backfilled = d.start < BACKFILL_BEFORE;
  const add = (m: number, step: StepId, device: string, source: LogSource, event: string, value?: number, unit?: string) => {
    log.push({
      id: `${d.id}-L${String(log.length + 1).padStart(2, "0")}`,
      t: fmt(m),
      step,
      device,
      source,
      actor: d.owner as PersonId,
      event,
      ...(value !== undefined ? { value } : {}),
      ...(unit ? { unit } : {}),
      ...(backfilled && source !== "manual" ? { backfilled: true } : {}),
    });
  };
  const s = d.start;
  const batch = 50;
  const dilG = r2((batch * d.dil) / 100);
  const piG = r2((batch * d.pi) / 100);
  add(s, "weigh", "Balance", "mhs", "Weighed base monomer", r2(batch - dilG - piG), "g");
  add(s + 3, "weigh", "Balance", "mhs", `Added diluent (${d.dil}%)`, dilG, "g");
  add(s + 6, "weigh", "Balance", "mhs", `Added photoinitiator (${d.pi}%)`, piG, "g");
  const mixer = d.mixer2 ? "Planetary mixer #2" : "Planetary mixer";
  const mixStart = s + 18;
  const mixEnd = mixStart + 2;
  add(mixStart, "mix", mixer, "mhs", d.mixer2 ? "Mix started (loaner unit)" : "Mix started", 3000, "rpm");
  add(mixEnd, "mix", mixer, "mhs", "Mix ended", 2, "min");
  if (d.degas > 0) add(mixEnd + 3, "degas", "Vacuum degasser", "manual", `Vacuum degas, ${d.degas} min (from worksheet)`, d.degas, "min");
  const viscAt = mixEnd + Math.min(d.restMin - 4, d.degas > 0 ? 16 : 12);
  add(viscAt, "viscosity", "Viscometer", "mhs", "Viscosity at 25 °C", out.viscosity_pa_s, "Pa·s");
  const printStart = mixEnd + d.restMin;
  add(printStart, "print", "DLP printer", "mhs", "Print job started: 6 dogbones + 3 bend bars");
  let printEnd = printStart + randint(r, 80, 95);
  if (d.restart) {
    add(printStart + 41, "print", "DLP printer", "mhs", "Print job aborted at layer 212: vat film torn");
    add(printStart + 72, "print", "DLP printer", "mhs", "Print job restarted after replacing the vat film");
    printEnd = printStart + 72 + randint(r, 80, 95);
  }
  add(printEnd, "print", "DLP printer", "mhs", "Print job finished", printEnd - printStart, "min");
  const cureAt = printEnd + d.postcureDelayMin;
  add(cureAt, "postcure", "UV oven", "manual", "Post-cure at 60 °C", d.postcure, "min");
  const testDay = startOfDay(cureAt + d.postcure) + 1440;
  const t0 = testDay + 9 * 60 + 30 + randint(r, 0, 90);
  add(t0, "test", "Test frame", "mhs", "Tensile: ultimate strength", out.uts_mpa, "MPa");
  add(t0 + 1, "test", "Test frame", "mhs", `Tensile: elongation at break (${out.fracture})`, out.elongation_pct, "%");
  add(t0 + 35, "test", "Test frame", "mhs", "3-pt bend: flexural strength", out.flex_strength_mpa, "MPa");
  add(t0 + 36, "test", "Test frame", "mhs", "3-pt bend: flexural modulus", out.flex_modulus_mpa, "MPa");
  add(t0 + 70, "test", "Cross-section imaging", "camera", "Cross-section porosity", out.porosity_pct, "%");
  add(testDay + randint(r, 2, 3) * 1440 + 14 * 60 + randint(r, 0, 90), "test", "Plate reader", "mhs", "Cell viability (extract test)", out.viability_pct, "%");

  // curves (short) and pores
  const curve: [number, number][] = [];
  for (let i = 0; i <= 7; i++) {
    const x = (out.elongation_pct * i) / 7;
    const y = out.uts_mpa * Math.min(1, Math.sin((Math.PI / 2) * Math.min(1, (i / 7) * 1.15)));
    curve.push([r2(x), r1(y)]);
  }
  const fmax = r1((out.flex_strength_mpa * 2 * 10 * 4 * 4) / (3 * 64)); // load (N) at peak for a 64 mm span, 10x4 mm bar
  const flex_curve: [number, number][] = [];
  for (let i = 0; i <= 5; i++) flex_curve.push([r2((i / 5) * 3.2), r1(fmax * Math.min(1, (i / 5) * 1.05))]);
  const pores: Pore[] = [];
  const nPores = Math.min(4, Math.round(out.porosity_pct * 1.5));
  for (let i = 0; i < nPores; i++) pores.push({ x: r2(uni(r, 0.1, 0.9)), y: r2(uni(r, 0.1, 0.9)), r: r2(uni(r, 0.01, 0.04)) });

  const t: Trial = {
    id: d.id,
    date: dateOf(d.start),
    owners: [d.owner as PersonId],
    campaign: d.campaign as Campaign,
    parent: d.parent,
    sop_version: "v1",
    inputs: {
      diluent_wt: d.dil,
      photoinit_wt: d.pi,
      degas_min: d.degas,
      rest_h: r1(d.restMin / 60),
      mix_rpm: 3000,
      mix_min: 2,
      postcure_min: d.postcure,
    },
    outputs: out,
    guardrails: g,
    pass_all: pass,
    meets_objective: pass && out.viscosity_pa_s <= 1.5,
    excluded: d.excluded,
    ...(d.excludedReason ? { excluded_reason: d.excludedReason } : {}),
    notes: [],
    curve,
    flex_curve,
    pores,
    log,
  };

  // ordinary notes, accurate to the measurements
  const parentNote = d.parent ? `Same as ${d.parent} but ${d.dil}% diluent, ${d.pi}% PI.` : `${d.dil}% diluent, ${d.pi}% PI. First of campaign ${d.campaign}.`;
  addNote(t, "weigh", parentNote);
  const failed = (Object.keys(g) as GuardrailId[]).filter((k) => !g[k]);
  const testNotes = [
    `${out.fracture === "brittle" ? "Brittle" : "Ductile"} fracture; UTS ${out.uts_mpa} MPa.`,
    failed.length ? `Failed ${failed.join(" and ")}.` : "Passed every guardrail.",
    `Porosity ${out.porosity_pct}% on the cross-section.`,
  ];
  addNote(t, "test", pick(r, testNotes));
  if (d.excluded && d.excludedReason) addNote(t, "test", `Excluding this one. ${d.excludedReason}`);
  return t;
}

// ---------- ledger ----------

function buildLedger(trials: Trial[], _opts: { superseded: boolean }): LedgerItem[] {
  type Raw = Omit<LedgerItem, "id"> & { key: string; supersedes?: string };
  const items: Raw[] = [];
  const byCampaign = new Map<string, Trial[]>();
  for (const t of trials) byCampaign.set(`${t.owners[0]}|${t.campaign}`, [...(byCampaign.get(`${t.owners[0]}|${t.campaign}`) ?? []), t]);
  const sample = (ts: Trial[], n: number) => (ts.length <= n ? ts : ts.filter((_, i) => i % Math.ceil(ts.length / n) === 0)).map((t) => t.id);
  const plus7 = (date: string) => dateOf(dayOf(date) + 7 * 1440);

  for (const [key, ts] of byCampaign) {
    if (ts.length < 2) continue;
    const [owner, code] = key.split("|");
    const last = ts.at(-1)!;
    if (dayOf(last.date) + 7 * 1440 > dayOf(NOW)) continue; // campaign still running
    const v = ts.map((t) => t.outputs.viscosity_pa_s);
    const dl = ts.map((t) => t.inputs.diluent_wt);
    const k = ts.filter((t) => t.pass_all).length;
    items.push({
      key: `finding-${code}`,
      kind: "finding",
      owner: owner as PersonId,
      status: "accepted",
      recorded_at: plus7(last.date),
      text: `Campaign ${code} (${spec(owner).name}): ${ts.length} trials at ${Math.min(...dl)}–${Math.max(...dl)}% diluent; ${k} passed every guardrail; viscosity ${Math.min(...v)}–${Math.max(...v)} Pa·s.`,
      evidence: sample(ts, 6),
    });
  }

  // Cooper's dead end on high diluent (campaign B)
  const coopB = trials.filter((t) => (t.owners[0] as string) === "cooper" && (t.campaign as string) === "B");
  if (coopB.length) {
    const fails = coopB.filter((t) => !t.pass_all && !t.excluded);
    items.push({
      key: "deadend-cooper",
      kind: "dead_end",
      owner: "cooper" as PersonId,
      status: "active",
      recorded_at: "2025-06-10",
      text: "Dead end: high diluent (> 30%) too brittle.",
      status_note: `Porous with brittle fracture in ${fails.length} of ${coopB.filter((t) => !t.excluded).length} included campaign-B trials.`,
      evidence: (fails.length ? fails : coopB).slice(0, 6).map((t) => t.id),
      region: { diluent: [30, 45], photoinit: [0.5, 1.3] },
    });
  }

  // superseded pair: post-cure time
  const t30 = trials.filter((t) => t.inputs.postcure_min === 30);
  const t45tomas = trials.filter((t) => (t.owners[0] as string) === "tomas" && t.inputs.postcure_min === 45);
  items.push({
    key: "postcure-old",
    kind: "finding",
    owner: "tomas" as PersonId,
    status: "accepted",
    recorded_at: "2024-07-15",
    text: "Post-cure for 30 min reaches full strength; going to 45 min adds nothing.",
    evidence: t30.slice(0, 4).map((t) => t.id),
  });
  items.push({
    key: "postcure-new",
    kind: "finding",
    owner: "dana_whitfield" as PersonId,
    status: "accepted",
    recorded_at: "2025-01-20",
    text: "Corrects {postcure-old}: matched recipes post-cured 45 min are stronger in tension than at 30 min. Use 45 min, as in SOP v1.",
    evidence: [...t30.slice(0, 2), ...t45tomas.slice(0, 2)].map((t) => t.id),
    supersedes: "postcure-old",
  });

  // an open question about the winter porosity jump (evidence = some loaner-mixer trials, no answer)
  const winter = trials.filter((t) => t.log.some((e) => e.device === "Planetary mixer #2"));
  if (winter.length >= 2) {
    items.push({
      key: "question-winter",
      kind: "question",
      owner: "ravi" as PersonId,
      status: "open",
      recorded_at: "2026-02-20",
      text: "Why did porosity jump this winter? Same recipes as the autumn.",
      evidence: winter.slice(0, 3).map((t) => t.id),
    });
  }
  items.push({
    key: "question-greeshma",
    kind: "question",
    owner: "greeshma" as PersonId,
    status: "open",
    recorded_at: "2026-09-24",
    text: "Can we reach 1.5 Pa·s without new materials?",
    evidence: trials.filter((t) => t.owners[0] === "greeshma").slice(-1).map((t) => t.id),
  });

  items.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at) || a.key.localeCompare(b.key));
  const idOf = new Map(items.map((it, i) => [it.key, `L${i + 1}`]));
  return items.map(({ key, supersedes, ...it }) => {
    const id = idOf.get(key)!;
    const text = it.text.replace(/\{([a-z-]+)\}/g, (_m, k: string) => idOf.get(k) ?? k);
    const item: LedgerItem = { id, ...it, text };
    if (key === "postcure-old") {
      const newer = idOf.get("postcure-new")!;
      item.status_note = `Superseded by ${newer} (2025-01-20).`;
      item.history = [{ at: "2025-01-20", by: "dana_whitfield" as PersonId, change: `superseded by ${newer}` }];
    }
    if (supersedes) item.history = [{ at: it.recorded_at, by: it.owner, change: `supersedes ${idOf.get(supersedes)}` }];
    return item;
  });
}

// ---------- main ----------

function main() {
  const sizes = (arg("sizes") ?? "50,250,1000").split(",").map(Number);
  const seed = Number(arg("seed") ?? 11);
  mkdirSync(join(here, "data"), { recursive: true });
  for (const size of sizes) {
    const { nb, plants } = generate(size, seed);
    const nbPath = join(here, "data", `notebook-${size}.json`);
    writeFileSync(nbPath, JSON.stringify(nb));
    writeFileSync(join(here, "data", `plants-${size}.json`), JSON.stringify(plants, null, 2) + "\n");
    const qs = buildQuestions(nb, plants);
    writeFileSync(join(here, `questions-${size}.json`), JSON.stringify({ size, generated_from: `evals/stress/data/notebook-${size}.json`, questions: qs }, null, 2) + "\n");
    const logs = nb.trials.reduce((s, t) => s + t.log.length, 0);
    const ctxChars = JSON.stringify({ meta: nb.meta, project: nb.project, people: nb.people, trials: nb.trials, ledger: nb.ledger }).length;
    const owners = new Map<string, number>();
    for (const t of nb.trials) owners.set(t.owners[0], (owners.get(t.owners[0]) ?? 0) + 1);
    console.log(
      `size ${size}: ${nb.trials.length} trials, ${logs} log entries, ${nb.ledger.length} ledger items, ${qs.length} questions, ` +
        `context ${(ctxChars / 1000).toFixed(0)}K chars · ${[...owners].map(([k, v]) => `${k} ${v}`).join(", ")}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
