// Connect to the stdio MCP server as a real MCP client, list its tools, and call two of them.
//   node_modules/.bin/tsx server/scripts/mcp-list.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../..", import.meta.url));
const transport = new StdioClientTransport({
  command: `${app}node_modules/.bin/tsx`,
  args: [`${app}server/mcp-stdio.ts`],
  stderr: "ignore",
});
const client = new Client({ name: "mcp-list", version: "0.0.1" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`${tools.length} tools from ${client.getServerVersion()?.name}:`);
for (const t of tools)
  console.log(`  ${t.annotations?.readOnlyHint ? "read " : "WRITE"}  ${t.name.padEnd(22)} params: ${Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).join(", ") || "—"}`);

const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0]?.text ?? "";
  console.log(`\n${name}(${JSON.stringify(args)})\n  → ${r.isError ? "ERROR " + text : JSON.parse(text).summary}`);
};
await call("get_log", { trial_id: "T09" });
await call("diff_protocols", { a: "T08", b: "T13" });
await call("draft_trial", {
  title: "Degassed high-diluent crossover",
  owner: "shreya",
  hypothesis: "Degassing removes the strength barrier at high diluent.",
  linked_trials: ["T08", "T09", "T13"],
  arms: [
    { label: "T08 recipe + 1.7% PI + degas", role: "treatment", diluent_wt: 38, photoinit_wt: 1.7, degas_min: 10 },
    { label: "same, no degas", role: "control", diluent_wt: 38, photoinit_wt: 1.7, degas_min: 0 },
  ],
});
await client.close();
