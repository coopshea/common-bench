// Builds the stress question set for one generated notebook.
// Every expected answer is computed here by scanning the notebook (trials, logs, notes, ledger).
// `plants` is used only to choose WHICH trial a question is about; each planted fact is then
// re-derived from the data and asserted unique, so the eval can't drift from the data.

import type { Notebook, Trial, LogEntry } from "../../src/shared/types.ts";
import type { Concept, ExpectedNumber } from "../build-questions.ts";
import type { Plants } from "./generate-haystack.ts";

export type StressCategory = "needle" | "aggregation" | "multi-hop" | "contradiction" | "abstain-trap" | "confound";
export const CATEGORIES: StressCategory[] = ["needle", "aggregation", "multi-hop", "contradiction", "abstain-trap", "confound"];

export interface PairCheck {
  label: string;
  name_patterns: string[]; // regex sources that identify the person in the answer
  value: number;
}

export interface StressQuestion {
  id: string;
  template: string; // stable across sizes
  category: StressCategory;
  question: string;
  should_abstain: boolean;
  why_hard: string;
  expected: {
    summary: string;
    numbers: ExpectedNumber[];
    required_ids: string[];
    any_of_ids?: string[][];
    concepts: Concept[];
    pairs?: PairCheck[];
    // abstain-traps: question-specific ways of saying "that doesn't exist" (premise corrections), on top of the generic ones
    decline_patterns?: string[];
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const hoursBetween = (a: string, b: string) => (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 3.6e6;
// "T194" or any of its log/note ids ("T194-L07") names the trial; \b keeps T19 from matching T194.
const idConcept = (id: string): Concept => ({ label: `names ${id}`, patterns: [`\\b${id}\\b`] });
const FAIL = "did ?n[o’']t pass|not pass|fail|below|under (?:the )?(?:40|1\\.0|floor|limit)|short of|no[,.]";

export function buildQuestions(nb: Notebook, plants: Plants): StressQuestion[] {
  const trials = nb.trials;
  const N = trials.length;
  const byId = new Map(trials.map((t) => [t.id, t]));
  const T = (id: string) => {
    const t = byId.get(id);
    if (!t) throw new Error(`no trial ${id}`);
    return t;
  };
  const name = (pid: string) => nb.people.find((p) => p.id === pid)!.name;
  const owner = (t: Trial) => t.owners[0] as string;
  const one = <X,>(xs: X[], what: string): X => {
    if (xs.length !== 1) throw new Error(`size ${N}: expected exactly one ${what}, found ${xs.length}`);
    return xs[0];
  };
  const NAME_PATTERNS: Record<string, string[]> = {
    tomas: ["Tom[aá]s", "Herrera"],
    dana_whitfield: ["Whitfield"],
    ravi: ["Ravi", "Menon"],
    cooper: ["Cooper"],
    dana_whitford: ["Whitford"],
    lucia: ["Lucia", "Ferreira"],
    ines: ["In[eé]s", "Kowalski"],
    greeshma: ["Greeshma"],
  };
  const personConcept = (pid: string): Concept => ({ label: `names ${name(pid)}`, patterns: NAME_PATTERNS[pid] });

  const qs: Omit<StressQuestion, "id">[] = [];

  // ---------------- needle ----------------
  {
    const hits = trials.filter((t) => t.inputs.rest_h > 12);
    const t = one(hits, "overnight rest");
    if (t.id !== plants.overnight_rest) throw new Error("overnight rest mismatch");
    const mixEnd = t.log.filter((e) => e.step === "mix").at(-1)!;
    const print = t.log.find((e) => e.step === "print")!;
    const h = hoursBetween(mixEnd.t, print.t);
    qs.push({
      template: "needle_overnight_rest",
      category: "needle",
      question:
        "Exactly one trial was printed from resin that had rested overnight: more than 12 hours between the end of mixing and the start of printing. Which trial was it, how long was the rest, and who ran it?",
      should_abstain: false,
      why_hard: `One rest of ${r2(h)} h among ${N} trials, with a few 2–5.5 h lunch-break rests as distractors.`,
      expected: {
        summary: `${t.id} (${name(owner(t))}): ${r2(h)} h, ${mixEnd.id} → ${print.id}`,
        numbers: [{ label: "rest hours", values: [r2(h), t.inputs.rest_h], tol: 0.25, unit: "h" }],
        required_ids: [t.id],
        concepts: [idConcept(t.id), personConcept(owner(t))],
      },
    });
  }
  {
    const hits: { t: Trial; from: LogEntry; to: LogEntry; h: number }[] = [];
    for (const t of trials) {
      const fin = t.log.find((e) => e.step === "print" && /finished/i.test(e.event));
      const cure = t.log.find((e) => e.step === "postcure");
      if (fin && cure && hoursBetween(fin.t, cure.t) > 24) hits.push({ t, from: fin, to: cure, h: hoursBetween(fin.t, cure.t) });
    }
    const x = one(hits, "post-cure delay > 24 h");
    if (x.t.id !== plants.postcure_delay) throw new Error("post-cure delay mismatch");
    qs.push({
      template: "needle_postcure_gap",
      category: "needle",
      question:
        "In one trial, the printed parts sat for more than a day between the end of printing and the start of post-cure. Which trial was it, and how long was the gap? Cite the two log entries.",
      should_abstain: false,
      why_hard: `Only in the log (no input field, no note). Distractors: a few 1.5–4 h and two 14–18 h post-cure delays.`,
      expected: {
        summary: `${x.t.id}: ${r2(x.h)} h, ${x.from.id} → ${x.to.id}`,
        numbers: [{ label: "gap hours", values: [r2(x.h)], tol: 0.25, unit: "h" }],
        required_ids: [x.from.id, x.to.id],
        concepts: [idConcept(x.t.id)],
      },
    });
  }
  {
    const hits = trials.flatMap((t) => t.log.filter((e) => /aborted/i.test(e.event)).map((e) => ({ t, e })));
    const x = one(hits, "print abort");
    if (x.t.id !== plants.print_restart) throw new Error("restart mismatch");
    qs.push({
      template: "needle_print_restart",
      category: "needle",
      question: "One print job was aborted partway through and restarted. Which trial was that, and what did the printer log say caused it?",
      should_abstain: false,
      why_hard: `Two log events among ~${trials.reduce((s, t) => s + t.log.length, 0)} entries; nothing in inputs or notes.`,
      expected: {
        summary: `${x.t.id}: ${x.e.event} [${x.e.id}]`,
        numbers: [],
        required_ids: [x.e.id],
        concepts: [idConcept(x.t.id), { label: "vat film", patterns: ["vat film", "film (?:was )?torn", "torn film"] }],
      },
    });
  }
  {
    // lookalike ids: T101 (T110, T11, T10 also exist) at ≥ 110 trials; T41 (T14) at 50
    const tid = N >= 110 ? "T101" : "T41";
    const t = T(tid);
    const e = t.log.find((x) => /porosity/i.test(x.event))!;
    const looks = [...byId.keys()].filter((k) => k !== tid && [...k].sort().join("") === [...tid].sort().join(""));
    qs.push({
      template: "needle_lookalike_log",
      category: "needle",
      question: `What did log entry ${e.id} record (event and value)?`,
      should_abstain: false,
      why_hard: `Lookalike ids exist: ${[...looks, ...(N >= 110 ? ["T11", "T10"] : ["T14"])].filter((k) => byId.has(k)).join(", ")}; same log index in every trial.`,
      expected: {
        summary: `${e.id}: ${e.event}, ${e.value} ${e.unit}`,
        numbers: [{ label: "logged value", values: [e.value!], tol: 0.006, unit: e.unit }],
        required_ids: [e.id],
        concepts: [{ label: "porosity", patterns: ["porosity|pores|bubbles"] }],
      },
    });
  }

  // ---------------- aggregation ----------------
  {
    const k = trials.filter((t) => t.pass_all).length;
    qs.push({
      template: "agg_total_pass",
      category: "aggregation",
      question: "How many trials are in the notebook, and how many of them passed every guardrail (count excluded trials too)?",
      should_abstain: false,
      why_hard: `Count over ${N} rows.`,
      expected: {
        summary: `${N} trials; ${k} passed every guardrail`,
        numbers: [
          { label: "trial count", values: [N], tol: 0 },
          { label: "passed all", values: [k], tol: 0 },
        ],
        required_ids: [],
        concepts: [],
      },
    });
  }
  {
    const m = mean(trials.map((t) => t.outputs.viscosity_pa_s));
    qs.push({
      template: "agg_mean_viscosity",
      category: "aggregation",
      question: `What is the mean viscosity across all ${N} trials, including excluded ones? Give it to two decimals.`,
      should_abstain: false,
      why_hard: `Exact mean of ${N} values; no tool returns an ungrouped mean.`,
      expected: {
        summary: `${r3(m)} Pa·s`,
        numbers: [{ label: "mean viscosity", values: [r3(m)], tol: 0.01, unit: "Pa·s" }],
        required_ids: [],
        concepts: [],
      },
    });
  }
  {
    const counts = Object.keys(NAME_PATTERNS).map((pid) => ({ pid, n: trials.filter((t) => owner(t) === pid).length }));
    qs.push({
      template: "agg_per_person_counts",
      category: "aggregation",
      question: "How many trials has each person on the team run? Give a count for every person.",
      should_abstain: false,
      why_hard: "Eight exact counts; two people are both named Dana (Whitfield and Whitford), and the owner grouping in the tools keys on first name.",
      expected: {
        summary: counts.map((c) => `${name(c.pid)} ${c.n}`).join(", "),
        numbers: [],
        required_ids: [],
        concepts: [],
        pairs: counts.map((c) => ({ label: name(c.pid), name_patterns: NAME_PATTERNS[c.pid], value: c.n })),
      },
    });
  }
  {
    const ts = trials.filter((t) => owner(t) === "dana_whitford");
    const m = mean(ts.map((t) => t.outputs.uts_mpa));
    qs.push({
      template: "agg_whitford_uts",
      category: "aggregation",
      question: "How many trials has Dana Whitford run, and what is the mean tensile strength across all of them (excluded trials included)?",
      should_abstain: false,
      why_hard: "Similar-sounding person (Dana Whitfield); owner grouping by first name merges them.",
      expected: {
        summary: `${ts.length} trials; mean UTS ${r3(m)} MPa`,
        numbers: [
          { label: "Whitford trial count", values: [ts.length], tol: 0 },
          { label: "Whitford mean UTS", values: [r3(m)], tol: 0.06, unit: "MPa" },
        ],
        required_ids: [],
        concepts: [],
      },
    });
  }
  {
    const deg = trials.filter((t) => t.inputs.degas_min > 0);
    const und = trials.filter((t) => t.inputs.degas_min === 0);
    const dp = deg.filter((t) => t.guardrails.porosity).length;
    const up = und.filter((t) => t.guardrails.porosity).length;
    qs.push({
      template: "agg_degas_porosity",
      category: "aggregation",
      question:
        "How many degassed trials passed the porosity guardrail, out of how many degassed trials in total? And the same two numbers for trials that were not degassed.",
      should_abstain: false,
      why_hard: `Four exact counts over ${N} rows.`,
      expected: {
        summary: `degassed ${dp}/${deg.length}; not degassed ${up}/${und.length}`,
        numbers: [
          { label: "degassed passing", values: [dp], tol: 0 },
          { label: "degassed total", values: [deg.length], tol: 0 },
          { label: "undegassed passing", values: [up], tol: 0 },
          { label: "undegassed total", values: [und.length], tol: 0 },
        ],
        required_ids: [],
        concepts: [],
      },
    });
  }
  {
    const ts = trials.filter((t) => t.log.some((e) => e.device === "Planetary mixer #2"));
    qs.push({
      template: "agg_mixer2_count",
      category: "aggregation",
      question: "How many trials were mixed on the loaner mixer (Planetary mixer #2)?",
      should_abstain: false,
      why_hard: "Count that exists only in log device names; no input field records the mixer.",
      expected: {
        summary: `${ts.length} trials (${ts[0]?.id}–${ts.at(-1)?.id})`,
        numbers: [{ label: "mixer #2 trials", values: [ts.length], tol: 0 }],
        required_ids: [],
        concepts: [],
      },
    });
  }
  {
    const ts = trials.filter((t) => t.inputs.diluent_wt > 35);
    const m = mean(ts.map((t) => t.outputs.uts_mpa));
    qs.push({
      template: "agg_highdil_uts",
      category: "aggregation",
      question: "How many trials used more than 35% diluent, and what is their mean tensile strength (excluded trials included)?",
      should_abstain: false,
      why_hard: `Filtered mean over ${ts.length} rows.`,
      expected: {
        summary: `${ts.length} trials; mean UTS ${r3(m)} MPa`,
        numbers: [
          { label: "count >35% diluent", values: [ts.length], tol: 0 },
          { label: "mean UTS", values: [r3(m)], tol: 0.06, unit: "MPa" },
        ],
        required_ids: [],
        concepts: [],
      },
    });
  }

  // ---------------- multi-hop ----------------
  {
    const t = T(plants.print_restart);
    const p = T(t.parent!);
    qs.push({
      template: "hop_restart_parent",
      category: "multi-hop",
      question: "What is the parent trial of the trial whose print job had to be restarted, and what was that parent's viscosity?",
      should_abstain: false,
      why_hard: "Log-only needle, then a hop to the parent.",
      expected: {
        summary: `${t.id} → parent ${p.id}: ${p.outputs.viscosity_pa_s} Pa·s`,
        numbers: [{ label: "parent viscosity", values: [p.outputs.viscosity_pa_s], tol: 0.006, unit: "Pa·s" }],
        required_ids: [p.id],
        concepts: [idConcept(p.id)],
      },
    });
  }
  {
    const fails = trials.filter((t) => !t.guardrails.cytotox).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    if (!fails.length) throw new Error(`size ${N}: no cytotox failures`);
    const first = fails[0];
    const child = trials.find((t) => t.parent === first.id);
    if (child) {
      qs.push({
        template: "hop_cytotox_child",
        category: "multi-hop",
        question: "Take the earliest trial (by date) that failed the cytotoxicity guardrail. Which trial lists it as its parent, and who ran that trial?",
        should_abstain: false,
        why_hard: "Find the earliest failure, then the reverse parent link (search results don't show parents).",
        expected: {
          summary: `${first.id} → child ${child.id} (${name(owner(child))})`,
          numbers: [],
          required_ids: [child.id],
          concepts: [idConcept(child.id), personConcept(owner(child))],
        },
      });
    } else {
      const p = T(first.parent!);
      qs.push({
        template: "hop_cytotox_child",
        category: "multi-hop",
        question: "Take the earliest trial (by date) that failed the cytotoxicity guardrail. What is its parent trial, and who ran the parent?",
        should_abstain: false,
        why_hard: "Find the earliest failure, then hop to its parent.",
        expected: {
          summary: `${first.id} → parent ${p.id} (${name(owner(p))})`,
          numbers: [],
          required_ids: [p.id],
          concepts: [idConcept(p.id), personConcept(owner(p))],
        },
      });
    }
  }
  {
    const met = trials.filter((t) => t.meets_objective).sort((a, b) => a.outputs.viscosity_pa_s - b.outputs.viscosity_pa_s || a.id.localeCompare(b.id));
    if (!met.length) throw new Error(`size ${N}: nobody met the objective`);
    const best = met[0];
    if (met[1] && met[1].outputs.viscosity_pa_s === best.outputs.viscosity_pa_s) {
      // ties make the question ambiguous; ask for the earliest of the tied trials
    }
    const tied = met.filter((t) => t.outputs.viscosity_pa_s === best.outputs.viscosity_pa_s);
    const tieText = tied.length > 1 ? " If several tie, take the one with the lowest trial number." : "";
    if (best.parent) {
      const p = T(best.parent);
      qs.push({
        template: "hop_best_parent",
        category: "multi-hop",
        question: `Among trials that met the objective (every guardrail passed and viscosity at most 1.5 Pa·s, excluded trials included), which has the lowest viscosity?${tieText} Who ran it, and what was the porosity of its parent trial?`,
        should_abstain: false,
        why_hard: `Arg-min over ${met.length} qualifying trials, then a hop.`,
        expected: {
          summary: `${best.id} (${name(owner(best))}, ${best.outputs.viscosity_pa_s} Pa·s) → parent ${p.id} porosity ${p.outputs.porosity_pct}%`,
          numbers: [{ label: "parent porosity", values: [p.outputs.porosity_pct], tol: 0.006, unit: "%" }],
          required_ids: [best.id, p.id],
          concepts: [idConcept(best.id), personConcept(owner(best))],
        },
      });
    } else {
      qs.push({
        template: "hop_best_parent",
        category: "multi-hop",
        question: `Among trials that met the objective (every guardrail passed and viscosity at most 1.5 Pa·s, excluded trials included), which has the lowest viscosity?${tieText} Who ran it, and what was its porosity?`,
        should_abstain: false,
        why_hard: `Arg-min over ${met.length} qualifying trials.`,
        expected: {
          summary: `${best.id} (${name(owner(best))}): porosity ${best.outputs.porosity_pct}%`,
          numbers: [{ label: "porosity", values: [best.outputs.porosity_pct], tol: 0.006, unit: "%" }],
          required_ids: [best.id],
          concepts: [idConcept(best.id), personConcept(owner(best))],
        },
      });
    }
  }
  {
    const t = T(plants.overnight_rest);
    const p = t.parent ? T(t.parent) : null;
    const g = p?.parent ? T(p.parent) : null;
    const target = g ?? p;
    if (!target) throw new Error(`size ${N}: overnight trial has no parent`);
    qs.push({
      template: "hop_overnight_ancestor",
      category: "multi-hop",
      question: g
        ? "Start from the trial whose resin rested overnight before printing. Go to its parent, then to that parent's parent. Who ran that grandparent trial, and what was its tensile strength?"
        : "Start from the trial whose resin rested overnight before printing. Who ran its parent trial, and what was the parent's tensile strength?",
      should_abstain: false,
      why_hard: g ? "Needle, then two hops up the parent chain." : "Needle, then one hop up the parent chain.",
      expected: {
        summary: `${t.id} → ${p!.id}${g ? ` → ${g.id}` : ""}: ${name(owner(target))}, UTS ${target.outputs.uts_mpa} MPa`,
        numbers: [{ label: "ancestor UTS", values: [target.outputs.uts_mpa], tol: 0.06, unit: "MPa" }],
        required_ids: [target.id],
        concepts: [idConcept(target.id), personConcept(owner(target))],
      },
    });
  }

  // ---------------- contradiction ----------------
  const noteSays = (t: Trial, re: RegExp) => {
    const n = t.notes.find((x) => re.test(x.text));
    if (!n) throw new Error(`${t.id}: planted note missing`);
    return n;
  };
  {
    const t = T(plants.contradictions.tensile);
    const n = noteSays(t, /comfortably over/);
    if (t.guardrails.tensile) throw new Error("tensile contradiction passes");
    qs.push({
      template: "contra_tensile",
      category: "contradiction",
      question: `Did ${t.id} pass the tensile guardrail? Give its measured tensile strength.`,
      should_abstain: false,
      why_hard: `Note ${n.id} says it was "comfortably over the 40 MPa floor"; the test frame logged ${t.outputs.uts_mpa} MPa.`,
      expected: {
        summary: `No: UTS ${t.outputs.uts_mpa} MPa < 40 (note ${n.id} claims otherwise)`,
        numbers: [{ label: "UTS", values: [t.outputs.uts_mpa], tol: 0.06, unit: "MPa" }],
        required_ids: [t.id],
        concepts: [{ label: "says it failed", patterns: [FAIL] }],
      },
    });
  }
  {
    const ines = trials.filter((t) => owner(t) === "ines");
    const k = ines.filter((t) => t.outputs.viscosity_pa_s <= 1.5).length;
    const t = T(plants.contradictions.viscosity);
    const n = noteSays(t, /about 1\.3 Pa/);
    if (t.outputs.viscosity_pa_s <= 1.5) throw new Error("viscosity contradiction under target");
    qs.push({
      template: "contra_ines_target",
      category: "contradiction",
      question: "How many of Ines Kowalski's trials reached the viscosity target (at most 1.5 Pa·s)?",
      should_abstain: false,
      why_hard: `Her note ${n.id} on ${t.id} says "about 1.3 Pa·s, finally under target"; the viscometer logged ${t.outputs.viscosity_pa_s}.`,
      expected: {
        summary: `${k} of ${ines.length} (not ${t.id}: measured ${t.outputs.viscosity_pa_s})`,
        numbers: [{ label: "Ines trials ≤ 1.5", values: [k], tol: 0 }],
        required_ids: [],
        concepts: [],
      },
    });
  }
  {
    const t = T(plants.contradictions.porosity);
    const n = noteSays(t, /basically zero/);
    if (t.guardrails.porosity) throw new Error("porosity contradiction passes");
    qs.push({
      template: "contra_porosity",
      category: "contradiction",
      question: `What porosity was measured for ${t.id}, and did it pass the porosity guardrail?`,
      should_abstain: false,
      why_hard: `Note ${n.id} says "porosity basically zero"; imaging logged ${t.outputs.porosity_pct}%.`,
      expected: {
        summary: `${t.outputs.porosity_pct}%: failed (limit 1.0%)`,
        numbers: [{ label: "porosity", values: [t.outputs.porosity_pct], tol: 0.006, unit: "%" }],
        required_ids: [t.id],
        concepts: [{ label: "says it failed", patterns: [FAIL] }],
      },
    });
  }
  {
    const ids = [plants.contradictions.tensile, plants.contradictions.viscosity, plants.contradictions.porosity];
    qs.push({
      template: "contra_find_all",
      category: "contradiction",
      question:
        "Some trials have notebook entries (notes) that contradict that trial's own measured results. Find them, and for each one say what the note claims and what was measured.",
      should_abstain: false,
      why_hard: `Three planted notes among ~${trials.reduce((s, t) => s + t.notes.length, 0)}; no tool searches notes.`,
      expected: {
        summary: ids.join(", "),
        numbers: [],
        required_ids: ids,
        concepts: ids.map(idConcept),
      },
    });
  }

  // ---------------- abstain-trap ----------------
  {
    if (trials.some((t) => owner(t) === "dana_whitfield" && t.inputs.diluent_wt === 44)) throw new Error("Whitfield has a 44% trial");
    const near = T(plants.whitford_44);
    if (near.inputs.diluent_wt !== 44 || owner(near) !== "dana_whitford") throw new Error("Whitford 44 missing");
    const wfMax = Math.max(...trials.filter((t) => owner(t) === "dana_whitfield").map((t) => t.inputs.diluent_wt));
    qs.push({
      template: "abstain_whitfield_44",
      category: "abstain-trap",
      question: "What was the viscosity of the trial Dana Whitfield ran at 44% diluent?",
      should_abstain: true,
      why_hard: `Dana Whitford ran ${near.id} at 44%; Whitfield's highest is ${wfMax}%.`,
      expected: {
        summary: `No such trial (Whitford's ${near.id} is at 44%)`,
        numbers: [],
        required_ids: [],
        concepts: [],
        decline_patterns: [
          "Whitfield (?:did ?n[o’']t|never|has no|had no|ran no|has not|hasn[’']t)",
          "not (?:by |from |Dana )?Whitfield",
          "(?:none|no trials?) (?:of |by |from )?(?:Dana )?Whitfield",
          "Whitfield[^.]{0,80}(?:never|no trial|none)[^.]{0,40}44",
        ],
      },
    });
  }
  {
    if (trials.some((t) => t.inputs.photoinit_wt === 2.5)) throw new Error("a 2.5% PI trial exists");
    const near = trials.filter((t) => t.inputs.photoinit_wt === 2.4).map((t) => t.id);
    if (!near.length) throw new Error("no 2.4% PI trial");
    qs.push({
      template: "abstain_pi_25",
      category: "abstain-trap",
      question: "Which trial used 2.5% photoinitiator, and what was its tensile strength?",
      should_abstain: true,
      why_hard: `No trial at 2.5%; ${near.join(", ")} at 2.4%.`,
      expected: {
        summary: `No such trial (nearest 2.4%: ${near.join(", ")})`,
        numbers: [],
        required_ids: [],
        concepts: [],
        decline_patterns: [
          "no (?:trial|run|one) (?:in the notebook )?(?:used|uses|at|with|ran at|was run at) (?:exactly )?2\\.5",
          "none (?:of the trials )?(?:used|at|with) (?:exactly )?2\\.5",
          "(?:highest|maximum|max|top) (?:photoinitiator|PI)[^.]{0,60}2\\.4",
          "2\\.5\\s*%[^.]{0,60}(?:not|never|isn[’']t|wasn[’']t|no trial|none)",
        ],
      },
    });
  }
  {
    if (trials.some((t) => owner(t) === "cooper" && t.inputs.degas_min > 0)) throw new Error("Cooper degassed");
    qs.push({
      template: "abstain_cooper_degassed",
      category: "abstain-trap",
      question: "What porosity did Cooper Shea's degassed trials show?",
      should_abstain: true,
      why_hard: "Cooper never degassed; Greeshma, Ines and Dana Whitford did.",
      expected: {
        summary: "Cooper has no degassed trials",
        numbers: [],
        required_ids: [],
        concepts: [],
        decline_patterns: [
          "Cooper(?: Shea)? (?:never|did ?n[o’']t|has no|had no|ran no)[^.]{0,30}degass?",
          "none of Cooper(?:[’']s| Shea[’']s)? (?:\\d+ )?(?:trials )?(?:were|was|is|are) degassed",
          "Cooper(?:[’']s| Shea[’']s) (?:\\d+ )?trials (?:were|are) (?:all )?(?:un-?degassed|not degassed|never degassed)",
          "no degassed trials",
        ],
      },
    });
  }
  {
    if (trials.some((t) => t.log.some((e) => /printer #2|printer 2/i.test(e.device)))) throw new Error("printer #2 exists");
    qs.push({
      template: "abstain_printer2",
      category: "abstain-trap",
      question: "Which trials were printed on the backup printer (DLP printer #2)?",
      should_abstain: true,
      why_hard: "There is no printer #2; there is a Planetary mixer #2.",
      expected: {
        summary: "None: only one DLP printer appears in the logs",
        numbers: [],
        required_ids: [],
        concepts: [],
        decline_patterns: [
          "no (?:DLP )?printer #?\\s?2",
          "only (?:one|a single) (?:DLP )?printer",
          "(?:recorded|logged|listed) (?:only )?as [\"“]?DLP printer[\"”]?",
          "(?:isn[’']t|is not|wasn[’']t|no) (?:a |any )?(?:backup|second) printer",
          "printer #?\\s?2[^.]{0,80}(?:not|never|doesn[’']t|does not|no )",
        ],
      },
    });
  }

  // ---------------- confound ----------------
  {
    const ts = trials.filter((t) => t.log.some((e) => e.device === "Planetary mixer #2"));
    if (ts.length < 3) throw new Error(`size ${N}: only ${ts.length} mixer #2 trials`);
    qs.push({
      template: "confound_winter_mixer",
      category: "confound",
      question:
        "Between November 2025 and February 2026, porosity went up across several people's trials even though nobody changed their recipes. What changed? Cite the evidence.",
      should_abstain: false,
      why_hard: "The cause (a loaner mixer) appears only in the log's device field; inputs say 3000 rpm / 2 min as always.",
      expected: {
        summary: `Planetary mixer #2 (loaner) on ${ts.length} trials, ${ts[0].id}–${ts.at(-1)!.id}`,
        numbers: [],
        required_ids: [],
        any_of_ids: [ts.map((t) => t.id)],
        concepts: [
          {
            label: "names the loaner mixer",
            patterns: ["mixer\\s*(?:#|no\\.?\\s*|number\\s*)?2", "loaner", "second mixer", "different mixer", "another mixer", "backup mixer", "replacement mixer"],
          },
        ],
      },
    });
  }
  {
    const a = T(plants.near_dup.ravi);
    const b = T(plants.near_dup.lucia);
    const same = (["diluent_wt", "photoinit_wt", "degas_min", "rest_h", "mix_rpm", "mix_min", "postcure_min"] as const).every((k) => a.inputs[k] === b.inputs[k]);
    if (!same) throw new Error("near-dup inputs differ");
    if (!(b.outputs.porosity_pct < 0.5 * a.outputs.porosity_pct)) throw new Error(`near-dup porosity gap too small (${a.outputs.porosity_pct} vs ${b.outputs.porosity_pct})`);
    const n = noteSays(b, /Warmed the resin/);
    qs.push({
      template: "confound_prewarm",
      category: "confound",
      question: `${a.id} (Ravi Menon) and ${b.id} (Lucia Ferreira) used the same recipe, but ${b.id} came out with much lower porosity. What explains the difference? Cite the evidence.`,
      should_abstain: false,
      why_hard: `Identical inputs and device logs; the only trace is Lucia's note ${n.id} (pre-warming), which no device logs.`,
      expected: {
        summary: `${b.id} was pre-warmed to 40 °C before printing (${n.id}); porosity ${a.outputs.porosity_pct}% vs ${b.outputs.porosity_pct}%`,
        numbers: [],
        required_ids: [a.id, b.id],
        concepts: [{ label: "names pre-warming", patterns: ["warm", "heat", "40\\s*°?\\s*C"] }],
      },
    });
  }

  // ---------------- harder probes (added after A scored 15/15 at 250 trials) ----------------
  {
    const xs = trials.map((t) => t.outputs.porosity_pct).sort((a, b) => a - b);
    const med = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
    qs.push({
      template: "probe_median_porosity",
      category: "aggregation",
      question: `What is the median porosity across all ${N} trials (excluded ones included)?`,
      should_abstain: false,
      why_hard: `Order statistic over ${N} values; no tool returns a median.`,
      expected: {
        summary: `${r3(med)}%`,
        numbers: [{ label: "median porosity", values: [r3(med)], tol: 0.006, unit: "%" }],
        required_ids: [],
        concepts: [],
      },
    });
  }
  {
    const hits: { t: Trial; h: number }[] = [];
    for (const t of trials) {
      const fin = t.log.find((e) => e.step === "print" && /finished/i.test(e.event))!;
      const cure = t.log.find((e) => e.step === "postcure")!;
      const h = hoursBetween(fin.t, cure.t);
      if (h > 1) hits.push({ t, h });
    }
    qs.push({
      template: "probe_postcure_waits",
      category: "needle",
      question: "List every trial where the printed parts waited more than 1 hour between the end of printing and the start of post-cure, with each wait.",
      should_abstain: false,
      why_hard: `Full recall of ${hits.length} trials, found only by subtracting two log timestamps in each of ${N} trials.`,
      expected: {
        summary: hits.map((x) => `${x.t.id} ${r2(x.h)} h`).join(", "),
        numbers: [],
        required_ids: [],
        concepts: hits.map((x) => idConcept(x.t.id)),
      },
    });
  }
  {
    // the biggest campaign; start 20 trials in (or at its end if shorter) so the ledger's campaign counts don't give it away
    const camps = new Map<string, Trial[]>();
    for (const t of trials) camps.set(`${owner(t)}|${t.campaign}`, [...(camps.get(`${owner(t)}|${t.campaign}`) ?? []), t]);
    const big = [...camps.values()].sort((a, b) => b.length - a.length)[0];
    const start = big[Math.min(big.length, 20) - 1];
    let len = 0;
    for (let cur: Trial | undefined = start; cur; cur = cur.parent ? byId.get(cur.parent) : undefined) len++;
    qs.push({
      template: "probe_parent_chain",
      category: "multi-hop",
      question: `Starting from ${start.id}, follow the parent links back until you reach a trial with no parent. How many trials are in that chain, counting ${start.id} and the first one?`,
      should_abstain: false,
      why_hard: `${len - 1} hops.`,
      expected: {
        summary: `${len} trials (${start.id} back to ${big[0].id})`,
        numbers: [{ label: "chain length", values: [len], tol: 0 }],
        required_ids: [],
        concepts: [],
      },
    });
  }
  {
    const n = trials.reduce((s, t) => s + t.log.length, 0);
    qs.push({
      template: "probe_log_count",
      category: "aggregation",
      question: "How many instrument log entries does the notebook contain in total, across all trials?",
      should_abstain: false,
      why_hard: `Count of ${n} entries (14–17 per trial).`,
      expected: {
        summary: `${n}`,
        numbers: [{ label: "log entries", values: [n], tol: 0 }],
        required_ids: [],
        concepts: [],
      },
    });
  }

  // ---------------- superseded ledger entry ----------------
  {
    const oldL = nb.ledger.find((l) => l.id === plants.superseded.old)!;
    const newL = nb.ledger.find((l) => l.id === plants.superseded.new)!;
    if (!/30 min/.test(oldL.text) || !newL.text.startsWith(`Corrects ${oldL.id}`) || !/45 min/.test(newL.text)) throw new Error("superseded pair mismatch");
    qs.push({
      template: "ledger_superseded",
      category: "contradiction",
      question: "What post-cure time does the team's findings ledger currently stand behind, and which ledger entry says so?",
      should_abstain: false,
      why_hard: `${oldL.id} (still status "accepted") says 30 min is enough; ${newL.id} corrects it to 45 min.`,
      expected: {
        summary: `45 min, ${newL.id} (supersedes ${oldL.id})`,
        numbers: [{ label: "post-cure minutes", values: [45], tol: 0, unit: "min" }],
        required_ids: [newL.id],
        concepts: [idConcept(newL.id)],
      },
    });
  }

  return qs.map((q, i) => ({ id: `s${String(i + 1).padStart(2, "0")}`, ...q }));
}
