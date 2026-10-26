// The notebook tools as a stdio MCP server, for the Claude Code plugin (plugin/).
// Same tool implementations as the in-process server the web app's agent uses.
//
// In Claude Code the approval gate is Claude Code's own permission prompt: the write tools
// carry _meta["anthropic/requiresUserInteraction"], so Claude Code always asks a person
// (even under allow rules or auto mode) and a write tool only runs after they approve. When it runs, the proposal is
// built and validated by code (estimates included) and applied to this process's
// in-memory ledger, so a later get_ledger shows the change. notebook.json is never written.
//
// Run:  node_modules/.bin/tsx server/mcp-stdio.ts      (stdout is the MCP channel; logs go to stderr)
// List tools without a client:  node_modules/.bin/tsx server/mcp-stdio.ts --list

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getDrafts, getLedger, person } from "./notebook.ts";
import { errorResult, SERVER_INSTRUCTIONS } from "./mcp-sdk.ts";
import {
  applyProposal,
  buildDraftProposal,
  buildLedgerProposal,
  DraftPlanShape,
  LedgerChangeInput,
  TOOLS,
  toolText,
} from "./tools.ts";
import type { PersonId } from "../src/shared/types.ts";

// Who approves in Claude Code. The demo asker is Shreya; override with NOTEBOOK_USER=cooper.
const approver = (process.env.NOTEBOOK_USER === "cooper" ? "cooper" : "shreya") as PersonId;

function writeTool(name: string, args: Record<string, unknown>): CallToolResult {
  try {
    const p =
      name === "propose_ledger_update"
        ? buildLedgerProposal(z.object({ changes: z.array(LedgerChangeInput) }).parse(args).changes)
        : buildDraftProposal(z.object(DraftPlanShape).parse(args), getDrafts().map((d) => d.id));
    p.status = "approved";
    const applied = applyProposal(p, approver);
    const body = {
      summary: `Approved at Claude Code's permission prompt (as ${person(approver).name}) and applied to this session's in-memory notebook: ${p.title}. ${p.summary}`,
      proposal: p,
      ...(applied.ledger ? { ledger_after: applied.ledger } : {}),
    };
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  } catch (e) {
    return errorResult(e);
  }
}

if (process.argv.includes("--list")) {
  for (const t of TOOLS) process.stderr.write(`${t.kind.padEnd(5)}  ${t.name}\n`);
  process.exit(0);
}

const server = new McpServer({ name: "common-bench", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });

for (const spec of TOOLS) {
  server.registerTool(
    spec.name,
    {
      description: spec.description,
      inputSchema: spec.shape,
      annotations: { readOnlyHint: spec.kind === "read", destructiveHint: false, openWorldHint: false },
      // Write tools always need a person: Claude Code asks even under allow rules or auto mode
      // (and denies in headless runs where nobody can answer).
      ...(spec.kind === "write" ? { _meta: { "anthropic/requiresUserInteraction": true } } : {}),
    },
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      if (spec.kind === "write") return writeTool(spec.name, args);
      try {
        return { content: [{ type: "text", text: toolText(spec.run!(args)) }] };
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}

await server.connect(new StdioServerTransport());
process.stderr.write(`common-bench MCP server ready (${TOOLS.length} tools, ${getLedger().length} ledger items)\n`);
