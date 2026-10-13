# common-bench: the team notebook as a Claude Code plugin

The same notebook tools and Skill the web app's agent uses, packaged so the question can be asked where scientists already work.

- **MCP server** `notebook` (stdio): `app/server/mcp-stdio.ts`, the same tool code as the app's in-process server.
  - Read tools: `search_trials`, `get_trial`, `get_log`, `diff_protocols`, `compare_groups`, `correlate`, `get_ledger`.
  - Write tools: `propose_ledger_update`, `draft_trial`.
- **Skill** `lab-notebook-analyst`: a copy of `app/skills/lab-notebook-analyst/SKILL.md`, kept identical by `server/scripts/sync-plugin.ts`.

All data is synthetic (`app/data/notebook.json`). The plugin never writes that file.

## Requirements

- Claude Code (tested with 2.1.296).
- The app folder with dependencies installed:
  ```bash
  cd <path-to>/common-bench/app
  npm install
  ```
- `node` on your `PATH`.

The launcher `scripts/notebook-mcp.sh` finds the app in this order:
1. `$NOTEBOOK_APP_DIR`
2. the folder that contains this plugin
3. the absolute path above

## Install (local, per session)

```bash
cd <path-to>/common-bench/app
claude --plugin-dir ./plugin
```

Check that it loaded:

- `/mcp` lists **plugin:common-bench:notebook** as connected, with 9 tools.
- `/common-bench:lab-notebook-analyst` is available as a command. Claude also loads the Skill on its own when a question fits its description.

Validate the manifest and `.mcp.json`:

```bash
claude plugin validate ./plugin
```

## Ask

Paste the demo question:

```
Using the resin notebook: My best is 1.55 Pa·s. I want to order DiluentX ($1,800, 6 weeks) to get under 1.5. Has anyone tried something like this?
```

Claude searches the trials and reads the ledger. It diffs T08 against T13, compares strength by degassing above 30% diluent, and pulls T09's log (the 18.2 h rest). Then it answers with bracketed citations such as [T08], [T09-L07] and [L2], and proposes T15a and T15b (the control).

**Writes always ask a person.** The write tools carry `_meta["anthropic/requiresUserInteraction"]`. Claude Code shows a permission prompt for `propose_ledger_update` and `draft_trial` even under allow rules or auto mode, and that prompt is the approval card. After you approve, the change applies to this session's in-memory ledger, so `get_ledger` shows it. Restart the session to reset the ledger.

To approve as Cooper instead of Greeshma, launch with `NOTEBOOK_USER=cooper` in the environment.

## Headless (one shot)

Pre-approve only the read tools. In print mode nobody can answer a permission prompt, so the write tools are denied:

```bash
claude -p --plugin-dir ./plugin --model claude-sonnet-5-5 \
  --allowedTools "mcp__plugin_common-bench_notebook__search_trials,mcp__plugin_common-bench_notebook__get_trial,mcp__plugin_common-bench_notebook__get_log,mcp__plugin_common-bench_notebook__diff_protocols,mcp__plugin_common-bench_notebook__compare_groups,mcp__plugin_common-bench_notebook__correlate,mcp__plugin_common-bench_notebook__get_ledger" \
  "Using the resin notebook: My best is 1.55 Pa·s. I want to order DiluentX (\$1,800, 6 weeks) to get under 1.5. Has anyone tried something like this?"
```

In Claude Code, tool names follow the pattern `mcp__plugin_common-bench_notebook__<tool>`.

## Measured (2026-10-13, one run each)

| Run | Time | Cost | Result |
|---|---|---|---|
| Claude Code with this plugin, Sonnet 5.5, the question above | 25 s | $0.10 | Same evidence and proposal as the web app |
| Web app agent (Agent SDK, Sonnet 5.5) | 19–27 s | $0.054–0.082 | Same evidence and proposal |

The plugin run costs more because Claude Code's own system prompt is larger.

## Check the server without Claude Code

```bash
node_modules/.bin/tsx server/scripts/mcp-list.ts
```

This connects as a real MCP client, lists the 9 tools, and calls `get_log`, `diff_protocols` and `draft_trial`.
