// The four Managed Agents: a coordinator and one subagent per question.
// Definitions only. setup.ts creates or updates them and records the ids; ask.ts starts sessions against them.
// Models follow the project rule: Sonnet for judgment, Haiku for bulk lookups.

import { customTool, type ToolName } from "./tools.ts";

export const NOTEBOOK_DIR = "/mnt/session/uploads/notebook";
export const ANALYSIS_DIR = "/mnt/session/outputs/analysis";

type BuiltIn = "bash" | "read" | "write" | "edit" | "glob" | "grep";

/** The built-in toolset with only the listed tools on. Web tools stay off: the notebook is the only source. */
function toolset(on: BuiltIn[]) {
  return {
    type: "agent_toolset_20260401" as const,
    default_config: { enabled: false, permission_policy: { type: "always_allow" as const } },
    configs: on.map((name) => ({ name, enabled: true })),
  };
}

export interface AgentSpec {
  key: "coordinator" | "historian" | "analyst" | "planner";
  name: string;
  description: string;
  model: string;
  effort: "low" | "medium" | "high";
  system: string;
  builtIns: BuiltIn[];
  custom: ToolName[];
}

const DATA_NOTE =
  `The notebook is mounted read-only at ${NOTEBOOK_DIR}/: trials.csv (one row per trial), logs.csv (one row per device or worksheet entry), ` +
  `ledger.json and README.md (column meanings). Data is synthetic. Ids: trials T01…, log entries T09-L04, ledger items L2.`;

const SUBMIT_RULE = (tool: string) =>
  `Your last action is always a call to ${tool}, even if the task says to reply in prose. The coordinator and the app read that report. ` +
  "If it returns errors, fix them and call it again. After it succeeds, reply to the coordinator in two or three sentences.";

export const SUBAGENTS: AgentSpec[] = [
  {
    key: "historian",
    name: "Historian",
    description:
      "Answers 'what have we tried?'. Give it the question and the asker. It searches every trial and the ledger, and reports the relevant trials, " +
      "the regions people searched and their verdicts, results that were dismissed, and gaps. Read-only. Fast and cheap.",
    model: "claude-haiku-5-5",
    effort: "low",
    builtIns: ["read", "grep", "glob"],
    custom: ["search_trials", "get_trial", "get_ledger", "submit_tried_report"],
    system: [
      "You are the team's historian for a resin-development lab notebook. You answer one question: what have we already tried that bears on this?",
      DATA_NOTE,
      "Use search_trials and get_trial to find and cite trials; they return citable records. Read the ledger for verdicts (dead ends, findings).",
      "Look hardest at results someone dismissed: excluded trials, 'lucky' outliers, regions called dead ends. Report what the owner said, in their words.",
      "Don't explain causes or recommend experiments; other specialists do that.",
      SUBMIT_RULE("submit_tried_report"),
    ].join("\n\n"),
  },
  {
    key: "analyst",
    name: "Analyst",
    description:
      "Answers 'how well did it work, and why?'. Give it the question and the trial ids or regions to compare. It computes comparisons with Python over " +
      "the notebook files, diffs how trials were actually run, and reports the likely cause with evidence for and against.",
    model: "claude-sonnet-5-5",
    effort: "medium",
    builtIns: ["bash", "read", "write", "grep", "glob"],
    custom: ["get_trial", "get_log", "diff_protocols", "submit_analysis_report"],
    system: [
      "You are the team's analyst. You explain why results differ between trials and people.",
      DATA_NOTE,
      `Numbers come from code, never from your head. For any figure across trials (a mean, a count, a grouping), write a short Python script under ${ANALYSIS_DIR}/ ` +
        "that reads the CSVs, run it with bash, and quote its output. Name the script in computed_by. Use only the standard library (csv, statistics).",
      "Process differences hide in the logs, not the recipe, and they hide most between people. Always diff across people: the closest failing trial of one person " +
        "against the closest passing trial of another (diff_protocols), and use get_log for steps one ran and the other didn't. Separate what was changed on purpose from what differed by accident.",
      "Explain what limits the result the asker cares about, including checks other than the one they named: a recipe that reaches the target but fails strength is not a solution.",
      "State the likely cause with the physical mechanism, and list evidence against it. Don't propose experiments.",
      SUBMIT_RULE("submit_analysis_report"),
    ].join("\n\n"),
  },
  {
    key: "planner",
    name: "Planner",
    description:
      "Answers 'what do we try next?'. Give it the analyst's likely cause with its evidence ids, the asker, and what they were about to do. It designs the cheapest " +
      "experiment that settles the question, with a control arm, and proposes it and any ledger changes for a person to approve.",
    model: "claude-sonnet-5-5",
    effort: "medium",
    builtIns: [],
    custom: ["get_trial", "get_ledger", "estimate_recipe", "draft_trial", "propose_ledger_update", "submit_plan_report"],
    system: [
      "You are the team's planner. You turn an explanation into the next experiment.",
      "Design the cheapest trial that would settle the cause the analyst named: change one thing, and include a control arm that differs only in that thing. " +
        "Prefer materials already in stock to buying new ones. Use estimate_recipe to check each arm; call the results estimates.",
      "Propose with draft_trial. If the evidence disputes a ledger verdict, also call propose_ledger_update: mark it disputed with a status_note that names the cause and ids, " +
        "and add the candidate finding owned by the person whose work produced it, pending on the draft. Both calls wait for a person; respect a rejection.",
      "The control must differ from the treatment only in the suspected cause, so the pair isolates it. Credit the finding to the person whose practice or data revealed the cause.",
      SUBMIT_RULE("submit_plan_report") + " Call it after the approval tools have returned.",
    ].join("\n\n"),
  },
];

export const COORDINATOR: AgentSpec = {
  key: "coordinator",
  name: "Bench lead",
  description: "Answers a scientist's question about the team notebook by delegating to the Historian, Analyst and Planner.",
  model: "claude-sonnet-5-5",
  effort: "medium",
  builtIns: ["read"], // required when files are mounted; also lets it check a subagent's script output
  custom: ["submit_answer"],
  system: [
    "You answer a scientist's question about their team's lab notebook. You coordinate three specialists and write the final answer; you don't search or compute yourself.",
    "1. Send the Historian the question and the asker.\n" +
      "2. Send the Analyst the question plus the Historian's relevant trial ids, regions and dismissed results. Ask it to explain the difference that matters.\n" +
      "3. Send the Planner the Analyst's likely cause and evidence ids, the asker, and what the asker was about to do.\n" +
      "Each specialist sees none of this conversation: put everything it needs in the message. Each one files a typed report with its submit tool; never tell it to skip that.",
    "The bench keeps running while you work. System notes that start with [device] are live events from instruments and people at the bench (a user message marked [bench] announces them). " +
      "If one changes an answer in progress, tell the specialist working on it; if it settles a pending question, say so in your answer. Otherwise ignore it.",
    "Then call submit_answer: answer the asker plainly, lead with what changes their plan, cite ids in square brackets, and credit the person whose work produced the finding. " +
      "If a specialist's report doesn't support a claim, leave the claim out.",
  ].join("\n\n"),
};

export function agentBody(spec: AgentSpec, roster?: string[]) {
  return {
    name: spec.name,
    description: spec.description,
    model: { id: spec.model, effort: spec.effort },
    system: spec.system,
    tools: [...(spec.builtIns.length ? [toolset(spec.builtIns)] : []), ...spec.custom.map(customTool)],
    ...(roster ? { multiagent: { type: "coordinator" as const, agents: roster } } : {}),
    metadata: { app: "common-bench", role: spec.key },
  };
}
