# Common Bench: a collaborative lab notebook

A concept for a team project layer for Claude Science (unofficial).

> Lab science is a search run by a team, and nobody can see the whole search.

A 5-minute demo. Two scientists, two years apart, chase one objective: a denture resin thin enough to print fast (viscosity ≤ 1.5 Pa·s) that still passes four guardrails (tensile, 3-point bend, bubbles/porosity, cytotoxicity). One of them wrongly abandoned the best region. The other is closer than anyone, and doesn't know why. This prototype gives them a shared map of the search, catches the one unintended difference between them, and proposes the cheapest experiment that settles it. A person approves every write, and the finding is recorded under the person whose work produced it.

**Synthetic data, fictional company** (Meridian Dental Materials). Two real first names on purpose: Cooper (former member) and Greeshma (current).

## Run it

```bash
cd app
npm install          # once
npm run dev          # web on :5173, agent API on :8787
```

- Open http://localhost:5173. Two views, toggled at the top:
  - **Projects:** research thrusts → project (goal, what we know, open questions) → experiment (chart and trials) → trial (how it ran, step by step).
  - **Lab:** the room as a floor plan or in 3D, showing how each instrument is logged and who is using it.
  - Every screen has one right panel that follows your selection and ends in an Ask box scoped to it. The demo question is the suggestion under Ask in the *Mid-diluent, high photoinitiator* experiment.
- `DEMO_WALKTHROUGH.md` and the Guide describe the previous single-screen layout. They haven't been rewritten for this one yet.
- Live agent answers need `ANTHROPIC_API_KEY` in `app/.env.local` (gitignored). **Without a key or a network, the demo path replays a recorded live run**, so it works offline.
- `npm run data` regenerates `data/notebook.json` from the seeded generator and re-runs the 26 story checks. `npm run tokens` regenerates `src/ds/tokens.css` from the design system's `src/ds/tokens.json`.

## The user and the problem

A materials team (12 people) developing 3D-printing resin. Research is a search over recipes. Each person does a careful local search, but nobody can see the team's whole search over years and people. That causes four coordination failures:

| Failure | In this story |
|---|---|
| A region abandoned for the wrong reason | Cooper's high-diluent "dead end: too brittle" (June 2025) |
| A dismissed outlier that held the answer | T09: the one trial that rested 18 h before printing passed every guardrail at 1.28 Pa·s, and was excluded as "a lucky specimen" |
| Know-how that never moves between people | Greeshma degasses for 10 minutes out of habit from her last lab. It isn't in the SOP, and she doesn't know it matters |
| "The same protocol" run differently | Degassed vs. not, so their results were never comparable |

The mechanism is real physics, kept simple. More diluent gives thinner resin but a more brittle part. Brittle materials are flaw-sensitive, and bubbles are flaws. Without degassing, bubbles pushed high-diluent strength below the floor. The barrier at ~30% diluent was a processing artifact.

## What it does

1. **One chart and a scorecard**, linked, with replay.
   - The chart shows one check at a time (tabs: viscosity, tensile, bend, bubbles, cells alive), by trial order or by diluent. The limit is drawn once and the passing side is tinted.
   - Each trial is a status mark: ✓ goal met, ○ passes every check but still too thick, ✕ fails a check. Thin lines trace each person's path.
   - The default view (viscosity by trial) shows both people walking down toward 1.5. Cooper crosses it into ✕ (thin but weak) and calls a dead end. Greeshma approaches from above. T09 sits ✓ in the goal zone, excluded.
   - The scorecard table has a status column, and every check cell is tinted pass / not yet / fail. Clicking a check's header focuses the chart on it.
   - Hovering a trial anywhere highlights it everywhere. Clicking opens the trial: timestamped notes by process step, results, test curves and the instrument log.
2. **Protocol Diff.** Two trials aligned step by step. **Intended** differences (what was being studied) are separated from **unintended** ones (degas 10 min vs. none), and related evidence is called out (T09's 18 h rest, visible only in the instrument log).
3. **Critic and Proposer** (the agent). It answers "has anyone tried this?" with citations to trials, log entries and ledger items. It disputes the dead end and drafts **T15**, a two-arm crossover: T15a (Cooper's diluent + Greeshma's photoinitiator + her degas step) and T15b (the same, no degas: **the control**). Nothing needs ordering: an afternoon instead of a six-week, $1,800 order. Both writes are approval cards.

## Architecture

```
React UI (Vite)  ──POST /api/ask (NDJSON stream)──▶  Hono server
     ▲   approval cards ──POST /api/approve/:id──▶     │
     │                                                 ▼
     │                                   Claude Agent SDK (claude-sonnet-5-5)
     │                                     system prompt = lab-notebook-analyst Skill
     │                                     canUseTool ⇢ write tools wait for human approval
     │                                                 │
     │                                   Notebook MCP server (in-process)
     │                                     search_trials · get_trial · get_log · diff_protocols
     │                                     compare_groups · correlate
     │                                     propose_ledger_update* · draft_trial*   (*gated)
     │                                                 │
     └──────────── notebook.json ◀── seeded generator (single source of truth)
```

- **Numbers come from tools, not the model.** Arithmetic, log-gap timing, protocol diffs and draft estimates are code. The model plans, reads and explains. Draft-trial estimates come from models fitted to the trials (`src/shared/surrogate.ts`), never from the LLM, and are always labeled "estimate".
- **Why tools when 14 trials fit in context?** Exact numbers, real citations, and a design that scales to 10k trials and live device logs. The eval measures the difference (below).
- **Human in the loop by construction.** The write tools are gated by the Agent SDK's permission callback. The UI's Approve buttons are that gate.
- **One tool implementation, two transports.** The same tools run in-process for the agent and as a stdio MCP server in a Claude Code plugin (`plugin/`), so the same question gets the same cited answer where scientists already work.
- **Model choice.** Sonnet for the interactive demo; the eval shows Haiku with tools matches it on this question set at 12–13× lower cost, so lookups can route to Haiku.
- **Offline-safe.** Every demo-path stream is recorded from a live run and replayed with its original pacing if the key or network fails.

## Eval

`evals/`: 12–15 questions generated from the notebook (lookups, aggregations, the hero question, two that must be declined, one that needs log timing), with automatic graders (cited IDs exist; numbers within tolerance; the hero names the degassing confound and T09 and proposes a control arm; correct abstention) plus a light Claude-as-judge rubric.

All three setups get the same answer rules, asker and effort. One run per question (n = 1).

| Setup | Accuracy | Citation validity | Declines correctly | Wrong numbers | Hero | Cost / question | p50 latency |
|---|---|---|---|---|---|---|---|
| A · Whole notebook in context · Sonnet | 100% | 100% | 2/2 | 0 | pass (judge 2/4) | $0.019 | 4.6 s |
| B · Agent + tools · Sonnet | 100% | 100% | 2/2 | 0 | pass (judge 4/4) | $0.018 | 7.0 s |
| C · Agent + tools · Haiku | 100% | 100% | 2/2 | 0 | pass (judge 4/4) | $0.0015 | 5.4 s |

**What it says, honestly:**
- At 14 trials the whole notebook (~34K tokens) fits in context, so tools don't win on accuracy.
- Haiku with tools gets the same answers 12–13× cheaper. That's the routing case: Haiku for lookups, Sonnet when a decision is at stake.
- The case for tools is that numbers are computed in code, every citation comes from a tool result, and the design still works at 10,000 trials and live device logs.
- The judge scored the whole-notebook hero proposal 2/4 (it didn't credit Greeshma or state uncertainty). With one run each, that's a signal, not a result.
- Two grader false failures from the first pass were fixed and re-graded on stored answers: "isn't in the notebook" now counts as declining, and a ratio the answer computes from its own numbers isn't flagged.

**Stress eval** (`app/evals/stress/`, 50 / 250 / 1,000 trials with planted needles): whole-notebook-in-context stops fitting at 1,000 trials, and whole notebook in context is perfect up to its window (15/15 at 250 trials) but costs $1.22 per cache write. The tool agents drop to 7–8 of 15 at 250 trials, limited by the tool surface (oversized results, filters frozen to the demo, one call per log), not by the model. The fixes and the SDK feedback are in `ROADMAP.md`.

Re-run with `npx tsx --env-file-if-exists=.env.local evals/run.ts --config A,B,C` from `app/` (about $0.60).

## What's faked

- All data is synthetic, from one seeded generator (`data/generate.ts`, seed 5, chosen as the first seed where all 23 story checks pass). The chemistry is simplified but directionally plausible. Guardrail thresholds are partly contrived; the cytotoxicity threshold follows ISO 10993-5, and the bend values are modeled on ISO 20795-1 (verify before quoting).
- "MHS" here means **MHS-style** logging built from the public description of the Model Hardware Standard research preview. There is no access to MHS or its spec. Cooper's 2024–25 logs are marked *backfilled from instrument export*.
- Claude Science details come from third-party coverage only. This is a concept for a project layer and may overlap with things Anthropic has already built.
- The company is fictional. No real customer.

## The six-month version

See `ROADMAP.md` for the first three weeks with design-partner labs. Over six months:
- real partner data instead of synthetic
- MHS-style capture for the devices that have interfaces, and quick manual or paper-worksheet capture for the ones that don't
- versioned SOPs, so the diff separates deviation, SOP change and intended variable
- a surrogate model that suggests where to sample next, with the team still choosing
- the eval grown from partners' real questions, with a release bar of 0 wrong numbers and ≥ 95% citation validity

## One piece of product feedback for Anthropic

**Claude Science is organized around the session; labs are organized around the project.** A project layer (an objective with pass criteria, trials owned by people, a shared findings ledger, approval-gated writes) would let Claude reason across everyone's work instead of one conversation. A second note, for MHS: **a recorder, not just a controller.** Passive, attributed logging of human-run steps, plus a manual or observer path for devices with no interface (here, the degasser), is where the decisive evidence lived.
