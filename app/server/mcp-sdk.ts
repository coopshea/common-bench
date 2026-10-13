// The notebook tools as an in-process MCP server for the Agent SDK.
// Read tools run directly. Write tools call back into the agent run, which gates
// them through the SDK permission callback (canUseTool) before they execute.

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, ToolInputError, toolText } from "./tools.ts";

export const SERVER_NAME = "notebook";
export const mcpToolName = (name: string) => `mcp__${SERVER_NAME}__${name}`;
export const shortToolName = (full: string) => full.replace(`mcp__${SERVER_NAME}__`, "");

export const SERVER_INSTRUCTIONS =
  "Tools over a team lab notebook (synthetic data): trials, step-by-step device logs, and a findings ledger. " +
  "Every number in a tool result is computed from the notebook; quote them, don't recompute. " +
  "Write tools only propose; a person approves each proposal.";

export function errorResult(e: unknown): CallToolResult {
  const msg = e instanceof ToolInputError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

export type WriteHandler = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

export function createNotebookSdkServer(onWrite: WriteHandler) {
  return createSdkMcpServer({
    name: SERVER_NAME,
    version: "0.1.0",
    instructions: SERVER_INSTRUCTIONS,
    alwaysLoad: true, // 9 small tools: keep them in the prompt instead of behind tool search
    tools: TOOLS.map((spec) =>
      tool(
        spec.name,
        spec.description,
        spec.shape,
        async (args: Record<string, unknown>): Promise<CallToolResult> => {
          if (spec.kind === "write") return onWrite(spec.name, args);
          try {
            return { content: [{ type: "text", text: toolText(spec.run!(args)) }] };
          } catch (e) {
            return errorResult(e);
          }
        },
        { annotations: { readOnlyHint: spec.kind === "read", destructiveHint: false, openWorldHint: false } },
      ),
    ),
  });
}
