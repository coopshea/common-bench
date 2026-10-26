# Common Bench

A team lab notebook where the SOP is the interface: plan a trial on screen or on paper, run it hands-free at the bench, and let Claude reason across everyone's trials. A concept for a project layer for Claude Science (unofficial).

> Lab science is a search run by a team, and nobody can see the whole search.

**Synthetic data.** Two real first names on purpose: Cooper (a former member) and Greeshma (current). The lab is fictional and unnamed.

## The user and the problem

A small materials team developing a 3D-printable denture resin: thin enough to print fast (viscosity ≤ 1.5 Pa·s) while still passing four checks (tensile, 3-point bend, bubbles, cell viability). Research is a search over recipes, run by people over years. Two things break it.

**1. Capture.** The work happens with gloves on, away from a screen. Values go onto paper or into memory, and the variables that matter most are the ones nobody writes down: how long something degassed, how long the resin rested before printing.

**2. Coordination.** Each person searches carefully on their own, but nobody sees the team's whole search:

| Failure | In this story |
|---|---|
| A region abandoned for the wrong reason | Cooper's high-diluent "dead end: too brittle" (June 2025) |
| A dismissed outlier that held the answer | T09 rested 18 h before printing, passed every check at 1.28 Pa·s, and was excluded as "a lucky specimen" |
| Know-how that never moves between people | Greeshma degasses for 10 minutes out of habit. It isn't in the SOP, and she doesn't know it matters |
| "The same protocol" run differently | Degassed vs. not, so their results were never comparable |

The physics is real, kept simple: more diluent makes a thinner but more brittle part, brittle parts are flaw-sensitive, and bubbles are flaws. The "barrier" at ~30% diluent was a processing artifact. The two problems are linked: the decisive variable (degassing) was lost at capture, so the analysis could never find it.

## What it does

Four tabs, built on three primitives (`PRIMITIVES.md`): a **protocol** whose amounts are formulas, a **trial** that records planned against actual, and a **registry** of instruments and consumables.

1. **SOPs:** the protocol as a programmable document.
   - The trial's settings sit at the top (batch 50 g, diluent 38%…). Every amount below is typeset math, worked with this trial's numbers, and updates as you type.
   - **Edit SOP** is a block editor (Step, Amount and Setting blocks). Its Ask box takes "Set batch to 100" or "Add step Preheat oven before step 1" and shows the change on an approval card. Every change becomes a version with its author: Claude, plus the person who approved it.
   - **Print SOP** prints a fill-in-the-blank copy: the computed targets printed faintly in their blanks, and every blank labelled with its variable, so it can be solved by hand and read back by OCR.
2. **Start trial:** the bench view, half lab twin and half steps.
   - The 3D lab lights the instrument for the current step and shows which consumables to fetch and where to put them back.
   - Values go in by voice or by typing. One overshoot rescales every amount after it, and values far off target are flagged.
   - Built for stepping away: the screen stays awake, unattended steps have timers that chime and notify, every value is timestamped, a trial is locked to the SOP version it started on, and it survives a reload.
3. **Lab:** the room in 3D, with a token on each instrument for whoever is using it now, and a day calendar per instrument (in use, booked, booked-but-idle, free). Drag across free time to book it; clashes are flagged on the approval card.
4. **Projects:** the analysis across trials.
   - **One chart and a scorecard**, linked, showing both people's paths toward the goal. T09 sits in the goal zone, excluded.
   - **Protocol Diff** separates **intended** differences (what was being studied) from **unintended** ones (degassed 10 min vs. not).
   - **Critic and Proposer** (the agent) answers "has anyone tried this?" with citations, disputes the dead end, and drafts **T15**: a two-arm crossover with a control and nothing to order. Both writes are approval cards.

**How they connect:** the bench view asks "how long?" at the degas step, so the variable that decided this story is captured as a byproduct of doing the work. The agent can then find it, and credit goes to the person whose run produced it.

## Run it

```bash
cd app
npm install          # once
npm run dev          # web on :5173, agent API on :8787
```

- Open http://localhost:5173. The demo question for the agent is the suggestion under Ask in the *Mid-diluent, high photoinitiator* experiment. For the bench flow: SOPs → Resin batch → Start trial.
- Live agent answers need `ANTHROPIC_API_KEY` in `app/.env.local` (gitignored). **Without a key or a network, the demo path replays a recorded live run**, so it works offline. Speech falls back to a script built from the current targets; add `?script` to a trial's URL to force it.
- `npm run data` regenerates `data/notebook.json` from the seeded generator and re-runs the 28 story checks. `npm run tokens` regenerates the design tokens.
- `DEMO_WALKTHROUGH.md` is the 5-minute path: Projects (the map, the question, the diff, the proposal), then running T15a at the bench, the lab, and the eval.

## Architecture

```
React UI (Vite)                                         Hono server
  SOPs · Trial · Lab · Projects ──POST /api/ask (NDJSON)──▶  Claude Agent SDK (claude-sonnet-5-5)
  approval cards ─────────────────POST /api/approve/:id──▶     system prompt = lab-notebook-analyst Skill
        │                                                      canUseTool ⇢ writes wait for a person
        │ local, in the browser                                    │
        │  calc.ts       formulas → numbers, typeset as KaTeX       Notebook MCP server (in-process)
        │  sopEdit.ts    "Set batch to 100" → proposed protocol     search_trials · get_trial · get_log
        │  booking.ts    "Book the degasser 2–4 pm" → booking       diff_protocols · compare_groups · correlate
        │  benchSpeech   Web Speech API → field values              propose_ledger_update* · draft_trial* (*gated)
        │  benchRun.ts   trials and SOP versions (on device)           │
        └──────────────────────── notebook.json ◀── seeded generator (single source of truth)
```

**Where Claude runs, and where it deliberately doesn't**

| Job | What does it | Why |
|---|---|---|
| Open questions across trials ("has anyone tried this?") | Sonnet through the Agent SDK, with MCP tools and citations | Needs reading, planning and judgement |
| Lookups | Haiku can take them | The eval shows the same answers at 12–13× lower cost |
| Numbers (amounts, rescaling, log gaps, diffs, estimates) | Code: `calc.ts`, the tools, `surrogate.ts` | Exact, checkable, never invented; estimates are always labelled |
| Simple SOP edits, bookings, spoken values | Local deterministic parsers | Instant, free, offline at the bench. The agent version slots in behind the same approval card |
| Every write | A person, via approval cards | The SDK permission callback is the gate |

- **One tool implementation, two transports.** The same tools run in-process for the agent and as a stdio MCP server in a Claude Code plugin (`plugin/`), so a scientist gets the same cited answer where they already work.
- **Offline-safe.** The demo path's agent stream is recorded from a live run and replayed with its original pacing. Fonts, math and the editor are all bundled.
- **Libraries, not hand-built primitives:** BlockNote for the block editor, KaTeX for math, react-big-calendar for the day views.

## Eval

`app/evals/`: 12–15 questions generated from the notebook (lookups, aggregations, the hero question, two that must be declined, one that needs log timing). Automatic graders check that cited IDs exist, numbers are within tolerance, the hero answer names the degassing confound and T09 and proposes a control arm, and declines are correct. A light Claude-as-judge rubric sits on top. One run per question (n = 1).

| Setup | Accuracy | Citation validity | Declines correctly | Wrong numbers | Hero | Cost / question | p50 latency |
|---|---|---|---|---|---|---|---|
| A · Whole notebook in context · Sonnet | 100% | 100% | 2/2 | 0 | pass (judge 2/4) | $0.019 | 4.6 s |
| B · Agent + tools · Sonnet | 100% | 100% | 2/2 | 0 | pass (judge 4/4) | $0.018 | 7.0 s |
| C · Agent + tools · Haiku | 100% | 100% | 2/2 | 0 | pass (judge 4/4) | $0.0015 | 5.4 s |

- At 14 trials the whole notebook (~34K tokens) fits in context, so tools don't win on accuracy. Haiku with tools gets the same answers 12–13× cheaper: Haiku for lookups, Sonnet when a decision is at stake.
- **Stress eval** (`app/evals/stress/`, 50 / 250 / 1,000 trials with planted needles): whole-notebook-in-context is perfect up to its window but stops fitting at 1,000 trials. The tool agents drop to 7–8 of 15 at 250 trials, limited by the tool surface (oversized results, filters frozen to the demo, one call per log), not by the model. The fixes and the SDK feedback are in `ROADMAP.md`.
- **Usability:** a persona walkthrough of the bench flow (a new student, Greeshma mid-batch, a PI editing the SOP, a quick availability check) found 17 screen issues and a second set specific to stepping away from the bench. The highest-yield fixes are built and tested (timers, timestamps, version locking, off-target flags, reload safety).

Re-run with `npx tsx --env-file-if-exists=.env.local evals/run.ts --config A,B,C` from `app/` (about $0.60).

## What's faked

- **All data is synthetic**, from one seeded generator (`data/generate.ts`, seed 5). The chemistry is simplified but directionally plausible. Guardrail thresholds are partly contrived; the cytotoxicity threshold follows ISO 10993-5 and the bend values are modeled on ISO 20795-1 (verify before quoting).
- **"MHS" means MHS-style:** logging built from the public description of the Model Hardware Standard research preview. There is no access to MHS or its spec. Instruments don't actually report in; the lab's schedule and in-use state are generated.
- **Trials and SOP versions are saved only in this browser**, not on a server or across devices (#9).
- **Speech** uses the browser's recognition, which sends audio to the browser vendor's service. The offline fallback is a script built from the current targets. The photo is a drawn placeholder.
- **SOP edits through the Ask** use a local parser for a handful of edit types, not the agent.
- **Claude Science details** come from third-party coverage only. This is a concept for a project layer and may overlap with things Anthropic has already built.

## Job description mapping

| Bullet | Where it shows |
|---|---|
| Build production-ready agents, Claude Skills and solutions with the SDK and API | Agent SDK server with gated write tools; the lab-notebook-analyst Skill; MCP tools shared with a Claude Code plugin |
| Develop technical assets: code examples, architectures, integration patterns | The "tools vs. long context" pattern with its eval; approval-gated writes; local parsers with the agent behind the same card |
| Document best practices for prompting, evaluation, agentic workflows and architecture | The eval harness and stress eval, and the routing guidance (Haiku for lookups, Sonnet for decisions) |
| Create demo environments and technical POCs | This app, offline-safe, end to end |
| Run discovery; design scalable architectures and evaluation frameworks | The persona walkthroughs and the bench-switching findings; the stress eval's scale limits; the pilot plan in `ROADMAP.md` |
| Synthesize feedback into the product roadmap | The two notes below, plus the SDK feedback in `ROADMAP.md` |

## The six-month version

`ROADMAP.md` covers the first three weeks with design-partner labs. Beyond that, filed as issues:
- **Server storage with real version control and authorship** for SOPs and trials, with trials locked to the version they ran (#9).
- **Timers and values driven by MHS-style instruments**, plus what networked instruments make possible for the whole lab: live availability, idle bookings released, comparisons across trials with no data entry (#10).
- **Scheduling a trial:** book its instruments, find a time in the lab and personal calendars, send invites (#7).
- **Parallelizing a protocol** so no one stands idle during a 10-minute degas, without changing anything that affects the result (#8).
- Scanning a filled-in paper copy back in, handing a step to a phone, a surrogate model that suggests where to sample next, and the eval grown from partners' real questions.

## Product feedback for Anthropic

1. **Claude Science is organized around the session; labs are organized around the project.** A project layer (an objective with pass criteria, trials owned by people, versioned SOPs, approval-gated writes) would let Claude reason across everyone's work instead of one conversation.
2. **For MHS: a recorder, not just a controller, with a standard run event.** Passive, attributed logging of human-run steps, a manual path for devices with no interface (here, the degasser), and a standard "run started / progress / done / fault" event in the machine reference file. The decisive evidence in this story lived in exactly those gaps.
