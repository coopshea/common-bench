// Shared contract for the notebook data, the /api/ask stream and approvals.
// data/generate.ts writes data/notebook.json in exactly this shape.
// Every number on screen traces back to that file. Never hard-code one in the UI.

// ---------- People ----------

// Two people on purpose: Cooper (former member) and Greeshma (current). No one else.
export type PersonId = "cooper" | "greeshma";

export interface Person {
  id: PersonId;
  name: string;
  initials: string;
  role: string;
  color: string; // one color per person, everywhere
  joined: string; // ISO date
  left?: string; // ISO date, former members only
  status: "current" | "former";
}

// ---------- Project, objective, guardrails, SOP ----------

export type GuardrailId = "tensile" | "bend" | "porosity" | "cytotox";

export interface GuardrailCheck {
  metric: keyof TrialOutputs;
  op: ">=" | "<=";
  threshold: number;
  unit: string;
}

export interface Guardrail {
  id: GuardrailId;
  label: string; // "Tensile", "3-pt bend", "Porosity (bubbles)", "Cytotoxicity"
  plain: string; // one plain-language line, no chemistry knowledge needed
  checks: GuardrailCheck[]; // all must hold for the guardrail to pass
  source_note: string; // where the threshold comes from (contrived / modeled on ISO ...)
}

export type StepId = "weigh" | "mix" | "degas" | "viscosity" | "print" | "postcure" | "test";
export type LogSource = "mhs" | "camera" | "manual";

export interface Station {
  id: StepId;
  label: string;
  device: string;
  source: LogSource; // badge on the SOP strip
  in_sop: boolean; // degas is false: "not in SOP v1"
  card: string; // two-sentence step card
}

export interface Project {
  id: string;
  name: string;
  customer: string; // fictional
  concept_label: string; // "Concept: project workspace for Claude Science (unofficial)"
  synthetic_label: string;
  now: string; // ISO datetime the demo is "set" at
  objective: {
    metric: "viscosity_pa_s";
    label: string;
    target: number; // 1.5
    baseline: number; // ~2.5
    unit: string;
    direction: "minimize";
    why: string;
  };
  guardrails: Guardrail[];
  sop: { version: string; stations: Station[] };
  team: PersonId[];
}

// ---------- Trials ----------

export type Campaign = "A" | "B" | "G";

export interface TrialInputs {
  diluent_wt: number; // % — map x-axis
  photoinit_wt: number; // % — map y-axis
  degas_min: number; // 0 or 10 — the hidden variable, not on the axes
  rest_h: number; // hours from end of mixing to start of printing, derived from the log
  mix_rpm: number;
  mix_min: number;
  postcure_min: number;
}

export interface TrialOutputs {
  viscosity_pa_s: number;
  porosity_pct: number;
  uts_mpa: number;
  elongation_pct: number;
  fracture: "ductile" | "brittle";
  flex_strength_mpa: number;
  flex_modulus_mpa: number;
  viability_pct: number;
}

export interface Pore {
  x: number; // 0..1 across the coupon cross-section
  y: number; // 0..1
  r: number; // radius, same normalized units
}

export interface NoteEntry {
  id: string; // "T09-N2"
  step: StepId; // the process step it was written at
  t: string; // ISO local datetime
  text: string;
}

export interface LogEntry {
  id: string; // e.g. "T09-L03"
  t: string; // ISO local datetime, no timezone ("2025-04-22T16:40:00")
  step: StepId;
  device: string;
  source: LogSource;
  actor: PersonId | "device";
  event: string;
  value?: number;
  unit?: string;
  backfilled?: boolean; // true for 2024–25 trials: imported from instrument exports, not live MHS-style drivers
}

export interface Trial {
  id: string; // "T01".."T14"
  date: string; // ISO date the trial was run
  owners: PersonId[];
  campaign: Campaign;
  parent: string | null; // previous trial in the same person's sequence
  sop_version: string;
  inputs: TrialInputs;
  outputs: TrialOutputs;
  guardrails: Record<GuardrailId, boolean>;
  pass_all: boolean; // every guardrail passes
  meets_objective: boolean; // pass_all && viscosity <= target
  excluded: boolean; // excluded by its owner from conclusions (T09)
  excluded_reason?: string;
  notes: NoteEntry[]; // lab-notebook entries in the owner's words, each tied to a process step
  curve: [number, number][]; // tensile [strain %, stress MPa]
  flex_curve: [number, number][]; // [deflection mm, load N]
  pores: Pore[];
  log: LogEntry[];
}

// ---------- Findings ledger ----------

export type LedgerKind = "finding" | "dead_end" | "question";
export type LedgerStatus =
  | "accepted" // finding
  | "candidate" // finding awaiting a test
  | "active" // dead end in force
  | "disputed" // dead end whose reason is contested
  | "open" // question
  | "answered";

export interface MapRegion {
  diluent: [number, number];
  photoinit: [number, number];
}

export interface LedgerItem {
  id: string; // "L1".."L3", new ones "L4"...
  kind: LedgerKind;
  text: string;
  owner: PersonId;
  evidence: string[]; // trial / log / ledger ids
  status: LedgerStatus;
  recorded_at: string; // ISO date
  region?: MapRegion; // dead ends: the hatched area on the map
  status_note?: string; // e.g. "reason disputed: confounded by degassing (see T09, T13)"
  pending_on?: string; // e.g. "T15"
  history?: { at: string; by: PersonId | "agent"; change: string }[];
}

// ---------- Landscape (map lenses), fitted from trials ----------

export type LensId = "team" | "degas";

export interface LandscapeGrid {
  diluent: number[]; // column centers, %
  photoinit: number[]; // row centers, %
  p_pass: number[][]; // [row][col] probability that every guardrail passes
}

export interface Lens {
  id: LensId;
  label: string; // "As the team saw it" | "Split by degassing"
  description: string; // honest one-liner on how it was computed
  trials_used: string[];
  grid: LandscapeGrid;
  // For each photoinit row: the diluent % where p_pass crosses 0.5 going right (the "wall").
  // null = no crossing inside the map (feasible to the right edge).
  boundary: { photoinit: number; diluent: number | null }[];
  // Diluent % beyond which the feasible region is extrapolated, not supported by trials.
  // Draw the boundary / region dashed past this line. null = fully supported.
  extrapolated_beyond: number | null;
}

export interface FittedModels {
  // ln(viscosity) = b0 + b1*diluent + b2*photoinit  (OLS on all trials)
  viscosity: { b0: number; b_diluent: number; b_photoinit: number; r2: number; n: number };
  // ln(porosity) = b0 + b1*diluent + b2*degassed(0/1) + b3*rest_h  (OLS on all trials)
  porosity: { b0: number; b_diluent: number; b_degassed: number; b_rest_h: number; r2: number; n: number };
  // ridge logistic on standardized features. team: [diluent]; porosity: [diluent, photoinit, ln(porosity)]
  // linear fits used for draft estimates (b in the order of features)
  uts: { b: number[]; features: string[]; r2: number; n: number };
  flex: { b: number[]; features: string[]; r2: number; n: number };
  viability: { b: number[]; features: string[]; r2: number; n: number };
  pass_team: { w: number[]; features: string[]; means: number[]; sds: number[]; lambda: number; n: number };
  pass_porosity: { w: number[]; features: string[]; means: number[]; sds: number[]; lambda: number; n: number };
}

export interface Landscape {
  axes: { diluent: [number, number]; photoinit: [number, number] };
  viscosity_target_contour: { photoinit: number; diluent: number }[]; // fitted ln-viscosity = ln(1.5)
  lenses: Record<LensId, Lens>;
  models: FittedModels;
}

// ---------- The notebook file ----------

export interface Notebook {
  meta: { generator: string; seed: number; generated_at: string; synthetic: true };
  project: Project;
  people: Person[];
  trials: Trial[];
  ledger: LedgerItem[];
  landscape: Landscape;
}

// ---------- Protocol diff (returned by diff_protocols, shown inline) ----------

export type DiffKind = "same" | "intended" | "unintended";

export interface DiffRow {
  step: StepId;
  field: string; // e.g. "diluent_wt", "degas_min", "rest_h"
  label: string; // plain words
  a: string | number | null; // value in trial a (null = step absent)
  b: string | number | null;
  kind: DiffKind;
  note?: string;
  log_ids?: string[]; // evidence
}

export interface RelatedEvidence {
  trial: string; // "T09"
  text: string;
  log_ids: string[];
}

export interface ProtocolDiff {
  a: string; // trial id
  b: string;
  study_vars: string[]; // fields treated as intended differences
  rows: DiffRow[];
  related: RelatedEvidence[];
}

// ---------- Agent proposals (write tools; nothing applies without approval) ----------

export type LedgerChange =
  | { op: "update"; id: string; patch: Partial<Pick<LedgerItem, "status" | "status_note" | "evidence" | "text">>; reason: string }
  | { op: "add"; item: LedgerItem; reason: string };

export interface DraftArm {
  id: string; // "T15a"
  label: string;
  role: "treatment" | "control";
  recipe: Pick<TrialInputs, "diluent_wt" | "photoinit_wt" | "degas_min"> & Partial<TrialInputs>;
  // Computed by code from models fitted to the trials, never by the model. Always shown as an estimate.
  estimate: {
    viscosity_pa_s: number;
    porosity_pct: number;
    p_pass: number;
    basis: string; // e.g. "fitted to 14 trials; extrapolated beyond 32% diluent for degassed resin"
  };
}

export interface DraftTrial {
  id: string; // "T15"
  title: string;
  owner: PersonId;
  linked_trials: string[]; // e.g. ["T08", "T09", "T13"]
  hypothesis: string;
  arms: DraftArm[];
  steps: string[];
  materials: { item: string; in_stock: boolean; note?: string }[];
  nothing_to_order: boolean;
  citations: string[];
}

export type ProposalStatus = "pending" | "approved" | "rejected";

export interface Proposal<T> {
  id: string; // used by POST /api/approve/:id
  kind: "ledger" | "draft";
  title: string;
  summary: string;
  payload: T;
  status: ProposalStatus;
}

// ---------- /api/ask stream (newline-delimited JSON or SSE `data:` lines) ----------

export interface Citation {
  id: string; // "T08" | "T09-L04" | "L2"
  kind: "trial" | "log" | "ledger";
  label: string;
}

export interface TraceStep {
  id: string;
  label: string; // plain words: "Searched trials that reached the viscosity target"
  tool?: string; // MCP tool name
  input?: unknown;
  summary?: string; // short result, e.g. "5 trials: T06–T10 (Cooper, campaign B)"
  status: "running" | "done" | "error";
  citations?: string[];
  ms?: number;
}

export type AskEvent =
  | { type: "trace"; step: TraceStep } // same id may arrive twice: running, then done
  | { type: "answer"; text: string; delta: boolean } // delta=true → append; citation tokens look like [T08]
  | { type: "citations"; items: Citation[] }
  | { type: "diff"; diff: ProtocolDiff }
  | { type: "ledger_proposal"; proposal: Proposal<LedgerChange[]> }
  | { type: "draft"; proposal: Proposal<DraftTrial> }
  | { type: "done"; cached: boolean; model?: string; cost_usd?: number; ms?: number }
  | { type: "error"; message: string };

export interface AskRequest {
  question: string;
  asker: PersonId; // "greeshma" in the demo
  cached?: boolean; // force replay from cache (Tour mode)
}

// POST /api/approve/:id
export interface ApproveRequest {
  decision: "approve" | "reject";
  by: PersonId;
}

export interface ApproveResponse {
  ok: boolean;
  proposal_id: string;
  status: ProposalStatus;
  ledger?: LedgerItem[]; // the ledger after applying, if a ledger proposal
  draft?: DraftTrial; // the approved draft, if a draft proposal
}

// GET /api/health
export interface HealthResponse {
  live: boolean; // API key present and the agent can run live
  model: string;
  cached_questions: string[]; // questions with a recorded stream (demo path)
}

// ---------- Eval results (evals/results.json, rendered on /evals) ----------

export interface EvalConfigResult {
  id: "A" | "B" | "C";
  label: string; // "Whole notebook in context · Sonnet" | "Agent + tools · Sonnet" | "Agent + tools · Haiku"
  model: string;
  n: number; // questions run
  accuracy: number; // 0..1
  citation_validity: number; // 0..1, share of cited ids that exist and support the claim
  abstention: number; // 0..1, share of "not in the notebook" questions correctly declined
  wrong_numbers: number; // count of numbers that don't match the data within tolerance
  hero_pass: boolean; // hero answer names the degassing confound + T09 and proposes a control arm
  cost_per_q_usd: number;
  p50_latency_s: number;
}

export interface EvalQuestionResult {
  qid: string;
  config: "A" | "B" | "C";
  correct: boolean;
  citations_valid: boolean;
  abstained: boolean;
  cost_usd: number;
  latency_s: number;
  notes?: string;
}

export interface EvalResults {
  generated_at: string;
  question_count: number;
  configs: EvalConfigResult[];
  per_question: EvalQuestionResult[];
  notes: string[]; // anything surprising, in plain words
}
