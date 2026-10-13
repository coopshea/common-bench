// The offline replay of the hero question. Same AskEvent shape as Core's /api/ask stream.
// Every number is computed from notebook.json and src/shared/surrogate.ts. None is typed in.
import type {
  AskEvent,
  Citation,
  DiffRow,
  DraftArm,
  DraftTrial,
  LedgerChange,
  LedgerItem,
  ProtocolDiff,
  Proposal,
  StepId,
  Trial,
  TraceStep,
} from "../shared/types.ts";
import { estimateRecipe } from "../shared/surrogate.ts";
import { landscape, notebook, personById, project, trialById, trials, logById } from "../data/notebook.ts";
import { fmtMonth, fmtTime, monthsBetween, trim } from "../lib/format.ts";
import { restGap } from "../lib/derive.ts";
import { citationKind } from "../lib/citations.ts";

// The cast of the hero answer (ids, not numbers): Cooper's T08, its replicate T09, Greeshma's T13.
const A_ID = "T08";
const B_ID = "T13";
const OUTLIER_ID = "T09";
export const LEDGER_PROPOSAL_ID = "mock-ledger-1";
export const DRAFT_PROPOSAL_ID = "mock-draft-1";

export type ScriptItem =
  | { kind: "event"; wait: number; event: AskEvent }
  | { kind: "gate"; ids: string[]; after: (decisions: Record<string, "approve" | "reject">) => AskEvent[] };

const range = (xs: number[], digits = 2) => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return lo === hi ? trim(lo, digits) : `${trim(lo, digits)}–${trim(hi, digits)}`;
};
const ids = (ts: Trial[]) => ts.map((t) => t.id);
const must = (id: string) => {
  const t = trialById(id);
  if (!t) throw new Error(`fixture: missing ${id}`);
  return t;
};
const logOf = (t: Trial, step: StepId, match?: RegExp) =>
  t.log.filter((e) => e.step === step && (!match || match.test(e.event))).map((e) => e.id);

// ---------- Protocol diff, built from inputs and logs ----------

export function buildDiff(aId: string, bId: string, studyVars: string[]): ProtocolDiff {
  const a = must(aId);
  const b = must(bId);
  const kindOf = (field: string, va: number | null, vb: number | null, same: boolean) =>
    studyVars.includes(field) ? "intended" : same && va !== null && vb !== null ? "same" : "unintended";
  const ra = restGap(a);
  const rb = restGap(b);
  const restA = ra ? Number(ra.hours.toFixed(1)) : null;
  const restB = rb ? Number(rb.hours.toFixed(1)) : null;
  const degA = a.inputs.degas_min > 0 ? a.inputs.degas_min : null;
  const degB = b.inputs.degas_min > 0 ? b.inputs.degas_min : null;
  const degasStation = project.sop.stations.find((s) => s.id === "degas");
  const degasOwner = degB !== null ? personById(b.owners[0]) : degA !== null ? personById(a.owners[0]) : null;

  const rows: DiffRow[] = [
    {
      step: "weigh", field: "diluent_wt", label: "Diluent, % by weight",
      a: a.inputs.diluent_wt, b: b.inputs.diluent_wt,
      kind: kindOf("diluent_wt", a.inputs.diluent_wt, b.inputs.diluent_wt, a.inputs.diluent_wt === b.inputs.diluent_wt),
      log_ids: [...logOf(a, "weigh", /diluent/i), ...logOf(b, "weigh", /diluent/i)],
    },
    {
      step: "weigh", field: "photoinit_wt", label: "Photoinitiator, %",
      a: a.inputs.photoinit_wt, b: b.inputs.photoinit_wt,
      kind: kindOf("photoinit_wt", a.inputs.photoinit_wt, b.inputs.photoinit_wt, a.inputs.photoinit_wt === b.inputs.photoinit_wt),
      log_ids: [...logOf(a, "weigh", /photoinit/i), ...logOf(b, "weigh", /photoinit/i)],
    },
    {
      step: "mix", field: "mix_rpm", label: "Mixer speed, rpm",
      a: a.inputs.mix_rpm, b: b.inputs.mix_rpm,
      kind: kindOf("mix_rpm", a.inputs.mix_rpm, b.inputs.mix_rpm, a.inputs.mix_rpm === b.inputs.mix_rpm),
      log_ids: [...logOf(a, "mix", /started/i), ...logOf(b, "mix", /started/i)],
    },
    {
      step: "mix", field: "mix_min", label: "Mix time, min",
      a: a.inputs.mix_min, b: b.inputs.mix_min,
      kind: kindOf("mix_min", a.inputs.mix_min, b.inputs.mix_min, a.inputs.mix_min === b.inputs.mix_min),
      log_ids: [...logOf(a, "mix", /ended/i), ...logOf(b, "mix", /ended/i)],
    },
    {
      step: "degas", field: "degas_min", label: "Degas under vacuum, min",
      a: degA, b: degB,
      kind: kindOf("degas_min", degA, degB, degA === degB),
      note:
        degA !== degB && degasStation && !degasStation.in_sop
          ? `Not in SOP ${project.sop.version}. ${degasOwner ? degasOwner.name.split(" ")[0] + " writes it on her worksheet; " : ""}the degasser has no data interface.`
          : undefined,
      log_ids: [...logOf(a, "degas"), ...logOf(b, "degas")],
    },
    {
      step: "print", field: "rest_h", label: "Rest from mixing to printing, h",
      a: restA, b: restB,
      kind: kindOf("rest_h", restA, restB, restA !== null && restB !== null && Math.abs(restA - restB) < 1),
      log_ids: [ra?.fromId, ra?.toId, rb?.fromId, rb?.toId].filter((x): x is string => !!x),
    },
    {
      step: "postcure", field: "postcure_min", label: "Post-cure, min",
      a: a.inputs.postcure_min, b: b.inputs.postcure_min,
      kind: kindOf("postcure_min", a.inputs.postcure_min, b.inputs.postcure_min, a.inputs.postcure_min === b.inputs.postcure_min),
      log_ids: [...logOf(a, "postcure"), ...logOf(b, "postcure")],
    },
  ];

  const o = must(OUTLIER_ID);
  const og = restGap(o);
  const related = og
    ? [
        {
          trial: o.id,
          text: `Same recipe as ${a.id}, but an ${og.hours.toFixed(1)} h logged rest before printing. Bubbles rose out: porosity ${trim(o.outputs.porosity_pct)}%, and it ${o.pass_all ? "passed every guardrail" : "still failed"}. Excluded at the time as anomalous.`,
          log_ids: [og.fromId, og.toId],
        },
      ]
    : [];
  return { a: a.id, b: b.id, study_vars: studyVars, rows, related };
}

// ---------- Proposals ----------

function buildLedgerProposal(): Proposal<LedgerChange[]> {
  const deadEnd = notebook.ledger.find((l) => l.kind === "dead_end" && l.status === "active")!;
  const b = must(B_ID);
  const o = must(OUTLIER_ID);
  const degassed = trials.filter((t) => t.inputs.degas_min > 0);
  const nextId = `L${notebook.ledger.length + 1}`;
  const newFinding: LedgerItem = {
    id: nextId,
    kind: "finding",
    text: "Degassing removes the strength barrier at high diluent",
    owner: b.owners[0],
    evidence: [...ids(degassed.filter((t) => t.inputs.diluent_wt >= deadEnd.region!.diluent[0])), o.id, A_ID],
    status: "candidate",
    recorded_at: project.now.slice(0, 10),
    pending_on: "T15",
    history: [{ at: project.now, by: "agent", change: "proposed from the answer to Greeshma's question" }],
  };
  return {
    id: LEDGER_PROPOSAL_ID,
    kind: "ledger",
    title: "Update the findings ledger",
    summary: `Mark ${deadEnd.id} disputed and record a new candidate finding under ${personById(b.owners[0]).name}.`,
    status: "pending",
    payload: [
      {
        op: "update",
        id: deadEnd.id,
        patch: {
          status: "disputed",
          status_note: `reason disputed: confounded by degassing (see ${o.id}, ${b.id})`,
          evidence: [...deadEnd.evidence, o.id, b.id],
        },
        reason: `Every strength failure in this region was never degassed. ${o.id}, the one trial whose bubbles had time to rise out, passed.`,
      },
      {
        op: "add",
        item: newFinding,
        reason: `${personById(b.owners[0]).name.split(" ")[0]}'s degassed trials pass every guardrail up to ${Math.max(...degassed.map((t) => t.inputs.diluent_wt))}% diluent; ${o.id} passed at ${o.inputs.diluent_wt}% once bubbles rose out. Pending a controlled test.`,
      },
    ],
  };
}

function buildDraft(): Proposal<DraftTrial> {
  const a = must(A_ID);
  const b = must(B_ID);
  const o = must(OUTLIER_ID);
  const m = landscape.models;
  const lens = landscape.lenses.degas;
  const treatment = { diluent_wt: a.inputs.diluent_wt, photoinit_wt: b.inputs.photoinit_wt, degas_min: b.inputs.degas_min };
  const control = { ...treatment, degas_min: 0 };
  const arms: DraftArm[] = [
    {
      id: "T15a",
      label: `${a.id}'s recipe, ${b.id}'s photoinitiator, degassed`,
      role: "treatment",
      recipe: treatment,
      estimate: {
        ...estimateRecipe(m, treatment),
        basis: `Fitted to ${m.porosity.n} trials. For degassed resin this is extrapolated beyond ${lens.extrapolated_beyond}% diluent.`,
      },
    },
    {
      id: "T15b",
      label: "Same recipe, not degassed (control)",
      role: "control",
      recipe: control,
      estimate: {
        ...estimateRecipe(m, control),
        basis: `Fitted to ${m.porosity.n} trials. Close to ${a.id}: same diluent, not degassed.`,
      },
    },
  ];
  const materials = [
    { item: "Base monomer", in_stock: true },
    { item: "Current diluent (not DiluentX)", in_stock: true },
    { item: "Photoinitiator", in_stock: true },
    { item: "Vacuum degasser", in_stock: true, note: `on ${personById(b.owners[0]).name.split(" ")[0]}'s bench` },
  ];
  const draft: DraftTrial = {
    id: "T15",
    title: "Degassing crossover on Cooper's high-diluent recipe",
    owner: b.owners[0],
    linked_trials: [a.id, o.id, b.id],
    hypothesis: `The strength wall at high diluent is caused by bubbles, not the recipe. Degassed, ${a.id}'s recipe should pass every guardrail while staying under ${project.objective.target} ${project.objective.unit}; the undegassed control should fail like ${a.id}.`,
    arms,
    steps: [
      `Weigh one batch: ${treatment.diluent_wt}% diluent, ${treatment.photoinit_wt}% photoinitiator.`,
      `Mix at ${a.inputs.mix_rpm} rpm for ${a.inputs.mix_min} min, per SOP ${project.sop.version}.`,
      "Split the batch in two, so both arms share one mix.",
      `T15a: degas ${b.inputs.degas_min} min under vacuum. T15b: no degas.`,
      "Print both arms straight away, so neither rests long enough for bubbles to rise.",
      `Post-cure ${a.inputs.postcure_min} min, then pull, bend, image bubbles (porosity) and run cell viability.`,
    ],
    materials,
    nothing_to_order: materials.every((x) => x.in_stock),
    citations: [a.id, o.id, b.id, ...(restGap(o) ? [restGap(o)!.fromId, restGap(o)!.toId] : []), ...logOf(b, "degas")],
  };
  return {
    id: DRAFT_PROPOSAL_ID,
    kind: "draft",
    title: "Draft trial T15 · two arms with a control",
    summary: "An afternoon with materials in stock, instead of a six-week order.",
    status: "pending",
    payload: draft,
  };
}

// ---------- The script ----------

function words(text: string, per = 3): string[] {
  const parts = text.split(/(\s+)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += per * 2) out.push(parts.slice(i, i + per * 2).join(""));
  return out;
}

export function buildHeroScript(): ScriptItem[] {
  const target = project.objective.target;
  const deadEnd = notebook.ledger.find((l) => l.kind === "dead_end")!;
  const wallAt = deadEnd.region!.diluent[0];
  const a = must(A_ID);
  const b = must(B_ID);
  const o = must(OUTLIER_ID);
  const og = restGap(o)!;
  const ownerA = personById(a.owners[0]);
  const ownerB = personById(b.owners[0]);

  const reached = trials.filter((t) => t.outputs.viscosity_pa_s <= target);
  const campaign = trials.filter((t) => t.campaign === a.campaign);
  const campaignFails = campaign.filter((t) => !t.guardrails.tensile);
  const high = trials.filter((t) => t.inputs.diluent_wt >= wallAt);
  const highRaw = high.filter((t) => t.inputs.degas_min === 0);
  const highDeg = high.filter((t) => t.inputs.degas_min > 0);
  const tensileFloor = project.guardrails.find((g) => g.id === "tensile")!.checks[0];
  const highRawPass = highRaw.filter((t) => t.guardrails.tensile);
  const diff = buildDiff(a.id, b.id, ["diluent_wt", "photoinit_wt"]);
  const unintended = diff.rows.filter((r) => r.kind === "unintended");
  const intended = diff.rows.filter((r) => r.kind === "intended");
  const degassedAll = trials.filter((t) => t.inputs.degas_min > 0);
  const maxDeg = Math.max(...degassedAll.map((t) => t.inputs.diluent_wt));
  const nextDay = og.hours > 12 ? " the next day" : "";
  const degasLog = logOf(b, "degas")[0];
  const fromEntry = logById(og.fromId)!.entry;
  const toEntry = logById(og.toId)!.entry;

  const steps: TraceStep[] = [
    {
      id: "s1", label: "Searched trials that reached the viscosity target", tool: "search_trials",
      input: { viscosity_pa_s: { lte: target } }, status: "done",
      summary: `${reached.length} trials: ${reached[0].id}–${reached[reached.length - 1].id}, all ${ownerA.name.split(" ")[0]}'s campaign ${a.campaign}`,
      citations: ids(reached),
    },
    {
      id: "s2", label: `Found ${ownerA.name.split(" ")[0]}'s campaign ${a.campaign} and his dead-end entry`, tool: "get_trial",
      input: { ids: ids(campaign) }, status: "done",
      summary: `${range(campaign.map((t) => t.outputs.viscosity_pa_s))} Pa·s at ${range(campaign.map((t) => t.inputs.diluent_wt))}% diluent; ${campaignFails.length} of ${campaign.length} failed strength; ruled out in ${deadEnd.id} (${fmtMonth(deadEnd.recorded_at)})`,
      citations: [...ids(campaign), deadEnd.id],
    },
    {
      id: "s3", label: `Diffed protocols, ${a.id} against ${b.id}`, tool: "diff_protocols",
      input: { a: a.id, b: b.id, study_vars: diff.study_vars }, status: "done",
      summary: `${intended.length} intended differences, ${unintended.length} unintended: ${unintended.map((r) => r.label.split(",")[0].toLowerCase()).join(", ")}`,
      citations: [a.id, b.id, ...(degasLog ? [degasLog] : [])],
    },
    {
      id: "s4", label: `Compared strength by degassing at ≥ ${wallAt}% diluent`, tool: "compare_groups",
      input: { metric: "uts_mpa", group_by: "degas_min", filter: { diluent_wt: { gte: wallAt } } }, status: "done",
      summary: `Not degassed (n=${highRaw.length}): ${highRaw.length - highRawPass.length} below ${tensileFloor.threshold} ${tensileFloor.unit}, only ${ids(highRawPass).join(", ")} passed. Degassed (n=${highDeg.length}): ${highDeg.filter((t) => t.guardrails.tensile).length} of ${highDeg.length} passed.`,
      citations: [...ids(highRaw), ...ids(highDeg)],
    },
    {
      id: "s5", label: `Pulled ${o.id}'s log`, tool: "get_log",
      input: { trial_id: o.id }, status: "done",
      summary: `Mix ended ${fmtTime(fromEntry.t)}, print started ${fmtTime(toEntry.t)}${nextDay}: ${og.hours.toFixed(1)} h rest, not mentioned in the notes`,
      citations: [og.fromId, og.toId],
    },
  ];

  const p08 = trim(a.outputs.porosity_pct);
  const p09 = trim(o.outputs.porosity_pct);
  const answer = [
    `Yes. ${ownerA.name.split(" ")[0]} got under ${target} ${project.objective.unit} about ${Math.round(monthsBetween(campaign[0].date, project.now) / 12)} years ago with the diluent you already have. His campaign ${a.campaign} reached ${range(campaign.map((t) => t.outputs.viscosity_pa_s))} Pa·s at ${range(campaign.map((t) => t.inputs.diluent_wt))}% diluent [${ids(campaign.filter((t) => !t.excluded)).join(", ")}], but he ruled the region out as too brittle [${deadEnd.id}].`,
    `Those failures weren't measured the same way as your trials. In ${a.id} against ${b.id} [${a.id}][${b.id}], diluent and photoinitiator differ on purpose. The unintended difference is degassing: you degas for ${b.inputs.degas_min} minutes [${degasLog}], and he never did. It isn't in SOP ${project.sop.version}, so nobody compared it.`,
    `Every strength failure at ${wallAt}% diluent and above was never degassed. The one exception is ${o.id} [${o.id}], the same recipe as ${a.id}. It sat ${og.hours.toFixed(1)} hours between mixing [${og.fromId}] and printing [${og.toId}], so bubbles had time to rise out: porosity ${p09}% against ${p08}% for ${a.id}. It passed every guardrail at ${trim(o.outputs.viscosity_pa_s)} Pa·s and was excluded as a lucky specimen.`,
    `Why it matters: more diluent makes the cured resin more brittle, and brittle materials are sensitive to flaws. Bubbles are flaws. The wall at about ${wallAt}% looks like a bubble problem, not a chemistry problem.`,
    `What's uncertain: only ${highDeg.length} degassed trials sit at ${wallAt}% or above, none past ${maxDeg}%, and beyond that only ${o.id} supports it. So before ordering DiluentX, I'd run T15: ${a.id}'s recipe with your photoinitiator level and your degas step [T15a], plus the same recipe without degassing as a control [T15b]. Everything is in stock. The estimates on the card come from models fitted to the trials, not from me.`,
  ].join("\n\n");

  const citeIds = new Set<string>();
  for (const s of steps) for (const c of s.citations ?? []) citeIds.add(c);
  for (const m of answer.matchAll(/\[([^\]]+)\]/g)) for (const id of m[1].split(",")) citeIds.add(id.trim());
  const citations: Citation[] = [...citeIds].map((id) => ({ id, kind: citationKind(id), label: id }));

  const ledger = buildLedgerProposal();
  const draft = buildDraft();

  const script: ScriptItem[] = [];
  const ev = (wait: number, event: AskEvent) => script.push({ kind: "event", wait, event });
  const durations = [620, 760, 900, 820, 680];
  steps.forEach((s, i) => {
    ev(i === 0 ? 350 : 160, { type: "trace", step: { ...s, status: "running", summary: undefined, citations: undefined } });
    ev(durations[i], { type: "trace", step: { ...s, ms: durations[i] } });
  });
  for (const chunk of words(answer)) ev(28, { type: "answer", text: chunk, delta: true });
  ev(120, { type: "citations", items: citations });
  ev(220, { type: "diff", diff });
  ev(420, { type: "trace", step: { id: "s6", label: "Drafted T15 with a control arm", tool: "draft_trial", status: "running", summary: `Waiting for ${ownerB.name.split(" ")[0]}'s approval` } });
  ev(260, { type: "draft", proposal: draft });
  ev(360, { type: "trace", step: { id: "s7", label: "Proposed ledger changes", tool: "propose_ledger_update", status: "running", summary: `Waiting for ${ownerB.name.split(" ")[0]}'s approval` } });
  ev(260, { type: "ledger_proposal", proposal: ledger });

  script.push({
    kind: "gate",
    ids: [DRAFT_PROPOSAL_ID, LEDGER_PROPOSAL_ID],
    after: (d) => {
      const first = ownerB.name.split(" ")[0];
      const verb = (id: string) => (d[id] === "approve" ? "approved" : "rejected");
      const out: AskEvent[] = [
        { type: "trace", step: { id: "s6", label: "Drafted T15 with a control arm", tool: "draft_trial", status: "done", summary: `${first} ${verb(DRAFT_PROPOSAL_ID)} it` } },
        { type: "trace", step: { id: "s7", label: "Proposed ledger changes", tool: "propose_ledger_update", status: "done", summary: `${first} ${verb(LEDGER_PROPOSAL_ID)} them` } },
      ];
      const both = d[DRAFT_PROPOSAL_ID] === "approve" && d[LEDGER_PROPOSAL_ID] === "approve";
      out.push({
        type: "answer",
        delta: true,
        text: both
          ? `\n\n${first} approved both. ${deadEnd.id} is now marked disputed, the new finding is recorded under her name [${ledger.payload[1].op === "add" ? ledger.payload[1].item.id : ""}], and T15 is on the map, linked to ${a.id} and ${o.id}.`
          : `\n\nNoted. Only approved changes were applied.`,
      });
      out.push({ type: "done", cached: true, model: "offline replay" });
      return out;
    },
  });
  return script;
}
