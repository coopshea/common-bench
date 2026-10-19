# Common Bench on Managed Agents

A second backend for the same notebook. The Agent SDK path in `server/` still drives the demo and its offline replay. This one runs on Managed Agents: Anthropic hosts the agent loop and a sandbox, and sessions keep running while the bench changes.

## Shape

```
Bench lead (Sonnet 5.5, coordinator)
├── Historian (Haiku 5.5)   "What have we tried?"          → submit_tried_report    (TriedReport)
├── Analyst   (Sonnet 5.5)  "How well did it work, and why?" → submit_analysis_report (AnalysisReport)
└── Planner   (Sonnet 5.5)  "What do we try next?"          → submit_plan_report     (PlanReport)
                                                  Bench lead → submit_answer          (FinalAnswer)
```

- **Typed handoffs.** Each agent ends by calling its `submit_*` custom tool. The client validates the input against the zod schema in `schemas.ts` and sends the errors back if it doesn't match, so every report is schema-valid.
- **Citable records.** `search_trials`, `get_trial` and `get_log` return `search_result` blocks (`source: notebook://trials/T09`), so the agents cite trials the way they cite web results.
- **Numbers from code.** The notebook is mounted at `/mnt/session/uploads/notebook/` (`trials.csv`, `logs.csv`, `ledger.json`, `README.md`). The Analyst writes Python under `/mnt/session/outputs/analysis/` and quotes what it prints. This is the Managed Agents version of programmatic tool calling: the arithmetic runs in the sandbox and only the results reach the context.
- **Approval-gated writes.** `draft_trial` and `propose_ledger_update` are custom tools. The client holds the result until a person approves, so the session waits.
- **A live bench.** `SessionControl` reaches into a running session:
  - `device(text)` sends an instrument or worksheet event as a system note. While a tool call is pending, the note waits and rides behind the next tool result.
  - `steer(text)` sends a user message.
  - `interrupt(agent?)` stops one specialist, or all of them.

## Run

```bash
npm run managed:setup                      # environment, 4 agents, notebook files; updates in place, ids in .state.json
npm run managed:ask -- --approve --live    # hero question, auto-approve, inject one bench event mid-run
npm run managed:ask -- "your question"     # interactive: y/n approves, /device <text>, /stop [agent], other text steers
```

Each run writes a transcript to `managed/runs/`. A hero run takes about 2 minutes. The session usage block reports `list_cost.amount` as 25–31 (USD), unit unconfirmed (likely cents).

## API behavior found by running it (not in the docs we read)

- File resources need the `read` tool enabled on the session's agent (the coordinator).
- A tool result with any `search_result` block must contain only `search_result` blocks.
- `search_result.citations.enabled: false` is rejected; use `true`.
- A `system.message` can't be sent alone. It must follow a `user.message` or a tool result in the same request.
- Built-in tool calls on a subagent's thread appear only on that thread's stream, so `ask.ts` opens one per thread.
