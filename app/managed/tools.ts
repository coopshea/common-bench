// Custom (client-executed) tools for the Managed Agents path.
// Lookups return search_result blocks, one per trial or log, so the agent cites notebook records the way it
// cites web results. Arithmetic over many trials happens in the sandbox (Python over the mounted files), not here.

import type { BetaManagedAgentsSearchResultBlock, BetaManagedAgentsTextBlock } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { z } from "zod";
import { FilterSchema, ToolInputError, diffProtocols, getLog, getTrial, readLedger, searchTrials, toolText, type Filter } from "../server/tools.ts";
import { notebook } from "../server/notebook.ts";
import { estimateRecipe } from "../src/shared/surrogate.ts";
import { AnalysisReport, DraftPlan, FinalAnswer, LedgerChanges, PlanReport, TriedReport, inputSchema } from "./schemas.ts";

export type Block = BetaManagedAgentsTextBlock | BetaManagedAgentsSearchResultBlock;

const PAGE = 8;

function trialResult(id: string): BetaManagedAgentsSearchResultBlock {
  const r = getTrial(id);
  return {
    type: "search_result",
    source: `notebook://trials/${id}`,
    title: r.summary.split(" → ")[0],
    content: [{ type: "text", text: r.summary }, { type: "text", text: toolText(r) }],
    citations: { enabled: true },
  };
}

const text = (t: string): BetaManagedAgentsTextBlock => ({ type: "text", text: t });

// ---------- tool definitions (the agent sees these) ----------

const SearchInput = z.object({
  filter: FilterSchema.optional(),
  page: z.number().int().min(1).optional().describe(`1-based page of ${PAGE} trials; default 1`),
});
const IdInput = z.object({ id: z.string().describe('Trial id, e.g. "T09"') });
const LogInput = z.object({
  trial_id: z.string().describe('Trial id, e.g. "T09"'),
  step: z.enum(["weigh", "mix", "degas", "viscosity", "print", "postcure", "test"]).optional(),
});
const DiffInput = z.object({
  a: z.string().describe('First trial id, e.g. "T08"'),
  b: z.string().describe('Second trial id, e.g. "T14"'),
  study_vars: z.array(z.string()).optional().describe('Fields varied on purpose. Default ["diluent_wt","photoinit_wt"]'),
});
const EstimateInput = z.object({
  diluent_wt: z.number(),
  photoinit_wt: z.number(),
  degas_min: z.number().describe("0 = not degassed"),
  rest_h: z.number().optional().describe("Rest between mixing and printing; default 0.5 h"),
});

type Def = { name: string; description: string; input: z.ZodObject };

export const TOOL_DEFS = {
  search_trials: {
    name: "search_trials",
    input: SearchInput,
    description:
      `Find trials matching a filter. Returns one citable record per trial (recipe, results, failed checks, owner, exclusion), ${PAGE} per page, ` +
      "plus a summary line with the total and the next page. Use it to answer 'has anyone tried X?' and to cite trials. " +
      "For arithmetic across many trials (means, groupings), don't page through everything: ask for the files under /mnt/session/uploads/notebook/ instead.",
  },
  get_trial: {
    name: "get_trial",
    input: IdInput,
    description: "One trial in full as a citable record: inputs, outputs, guardrails, the owner's notes in their own words, exclusion reason, ledger references.",
  },
  get_log: {
    name: "get_log",
    input: LogInput,
    description:
      "A trial's step-by-step device and worksheet log with computed gaps between steps, the rest time between mixing and printing, " +
      "and steps that were never logged (e.g. no degas). Use it to find process differences that aren't in the recipe.",
  },
  diff_protocols: {
    name: "diff_protocols",
    input: DiffInput,
    description:
      "Compare how two trials were actually run, step by step from their logs. Labels each difference intended (a study variable) or " +
      "unintended (a step present in one and missing in the other, a very different rest time), and lists other trials with the same recipe but a different process.",
  },
  get_ledger: {
    name: "get_ledger",
    input: z.object({}),
    description: "The team's findings ledger: findings, dead ends and open questions, each with owner, evidence ids, status and history.",
  },
  estimate_recipe: {
    name: "estimate_recipe",
    input: EstimateInput,
    description:
      "Estimate a recipe that hasn't been run, from models fitted to the trials: viscosity, porosity, tensile and bend strength, cell viability, " +
      "and the probability it passes every check. Always an estimate; say so.",
  },
  draft_trial: {
    name: "draft_trial",
    input: DraftPlan,
    description:
      "Propose the next experiment as an approval card: arms (treatment first, then a control). The notebook assigns the id, estimates each arm, " +
      "writes the steps and checks stock. The call waits for a person to approve or reject, then returns which.",
  },
  propose_ledger_update: {
    name: "propose_ledger_update",
    input: LedgerChanges,
    description:
      "Propose ledger changes as one approval card: update an item (e.g. mark a dead end disputed, with a status_note) and/or add a finding " +
      "owned by the person whose work produced it. Waits for a person to approve or reject.",
  },
  submit_tried_report: {
    name: "submit_tried_report",
    input: TriedReport,
    description: "Your final output as the historian. Call it once, after your searches. If it returns errors, fix them and call again.",
  },
  submit_analysis_report: {
    name: "submit_analysis_report",
    input: AnalysisReport,
    description: "Your final output as the analyst. Call it once, after your analysis. If it returns errors, fix them and call again.",
  },
  submit_plan_report: {
    name: "submit_plan_report",
    input: PlanReport,
    description: "Your final output as the planner, after the approval tools have returned. If it returns errors, fix them and call again.",
  },
  submit_answer: {
    name: "submit_answer",
    input: FinalAnswer,
    description: "The answer the asker sees. Call it last, once, after the subagents have reported. If it returns errors, fix them and call again.",
  },
} satisfies Record<string, Def>;

export type ToolName = keyof typeof TOOL_DEFS;
export const WRITE_TOOLS: ToolName[] = ["draft_trial", "propose_ledger_update"];
export const SUBMIT_TOOLS: ToolName[] = ["submit_tried_report", "submit_analysis_report", "submit_plan_report", "submit_answer"];

export function customTool(name: ToolName) {
  const d = TOOL_DEFS[name];
  return { type: "custom" as const, name: d.name, description: d.description, input_schema: inputSchema(d.input) };
}

// ---------- read tools: run here, answer with blocks ----------

export function runReadTool(name: ToolName, raw: unknown): Block[] {
  switch (name) {
    case "search_trials": {
      const a = SearchInput.parse(raw ?? {});
      const r = searchTrials(a.filter as Filter | undefined);
      const ids = r.citations;
      const page = a.page ?? 1;
      const slice = ids.slice((page - 1) * PAGE, page * PAGE);
      const more = ids.length > page * PAGE;
      const head = `${r.summary}. Showing ${slice.length ? `${(page - 1) * PAGE + 1}–${(page - 1) * PAGE + slice.length}` : "none"} of ${ids.length}.${
        more ? ` Call again with page: ${page + 1} for more, or narrow the filter.` : ""
      }`;
      // A result that has any search_result block must be all search_result blocks, so the summary is one too.
      const summary: BetaManagedAgentsSearchResultBlock = {
        type: "search_result",
        source: `notebook://search?page=${page}`,
        title: "Search summary",
        content: [text(head)],
        citations: { enabled: true }, // the API rejects enabled: false here ("value is required")
      };
      return [summary, ...slice.map(trialResult)];
    }
    case "get_trial":
      return [trialResult(IdInput.parse(raw).id.trim().toUpperCase())];
    case "get_log": {
      const a = LogInput.parse(raw);
      const r = getLog(a.trial_id, a.step);
      return [
        {
          type: "search_result",
          source: `notebook://trials/${a.trial_id}/log${a.step ? `#${a.step}` : ""}`,
          title: `${a.trial_id} log${a.step ? ` · ${a.step}` : ""}`,
          content: [text(r.summary), text(toolText(r))],
          citations: { enabled: true },
        },
      ];
    }
    case "diff_protocols": {
      const a = DiffInput.parse(raw);
      const r = diffProtocols(a.a, a.b, a.study_vars);
      return [text(r.summary), text(toolText(r))];
    }
    case "get_ledger": {
      const r = readLedger();
      return [text(toolText(r))];
    }
    case "estimate_recipe": {
      const a = EstimateInput.parse(raw);
      const e = estimateRecipe(notebook.landscape.models, a);
      return [text(JSON.stringify({ estimate: e, basis: `fitted to ${notebook.landscape.models.viscosity.n} trials; an estimate, not a result` }))];
    }
    default:
      throw new ToolInputError(`${name} is not a read tool`);
  }
}

