# Roadmap: from POC to design-partner pilot in three weeks

A pilot with design-partner labs: the fictional Meridian Dental Materials, plus 2 more resin or materials teams.

Each week ships something, then puts it in front of users. **Every interview question is built to produce a number, and every number has a decision rule attached.** The targets below are starting hypotheses that the interviews are designed to confirm or overturn. They are not claims.

## How the interviews work

- **Ask about the last real instance, not hypotheticals.** "The last time you…" gets better data than "Would you…". Quantify that instance: hours, dollars, count.
- **Use forced choices and rankings, not "would you use this?"** People say yes to everything.
- **Show the real thing.** Users react to actual agent answers and drafts from *their* data. A demo with fake data only tests whether they like demos.
- **Pair what people say with what the product measures.** From week 2 on, every interview is checked against usage logs.
- **Synthesis is fast:** recordings are clipped and indexed by theme. Cooper has built this tool before.
- **Each round ends with a one-page steering memo:** the numbers, the decisions they triggered, and what changes next week.

## Where it breaks today (stress eval, 2026-10-13)

A seeded haystack eval (`app/evals/stress/`, $8.96) plants needles, near-duplicates, multi-hop chains and abstention traps in notebooks of 50, 250 and 1,000 trials. Scores are on the same 15 core questions (n = 1):

| Trials | Whole notebook in context · Sonnet | Agent + tools · Sonnet | Agent + tools · Haiku |
|---|---|---|---|
| 50 | 15/15 · $0.03/q | 13/15 · $0.05/q | 15/15 · $0.006/q |
| 250 | 15/15 · $0.11/q + $1.22 per cache write | 7/15 | 8/15 |
| 1,000 | doesn't fit (1.94M tokens) | 6/7 run | 7/15 |

What broke, and why:
- **The tool surface limits accuracy more than the model does.** With the same tools, Sonnet did no better than Haiku at 250 trials (7 vs 8 of 15) at 6× the cost. Causes:
  - search results too large to return
  - filters frozen to the demo's two people
  - a person grouping that merges lookalike names
  - log needles that need one call per trial, so the agent samples and gives up
- **Long context is strong right up to the window.** Whole notebook in context was perfect at 488K tokens, including exact sums over 250 rows. Its limits are the window and the cost.
- **The agents fail safely:** 31 of 34 failures said they couldn't answer and why. The 3 confident errors were all Haiku. No configuration cited a nonexistent id.

**Week 1 additions, from this finding:**
- **Exhaustive, data-shaped tools.**
  - Paginated, projected search: return only the fields asked for, a page at a time.
  - Filter values (enums) built from the data, not the demo.
  - `scan_logs(predicate)` across every trial.
  - An ungrouped `aggregate(metric, filter)` that returns the exact statistic and the ids used.
  - `find_duplicates(recipe)`.
- **Grading the method:** fail confident answers built from a partial read.
- **A scale gate:** tools must match whole-notebook-in-context at 250 trials and stay affordable past 1M tokens. Re-run the stress eval weekly as partner data grows.

**Product feedback for Anthropic:**
- **The Agent SDK's oversized-result fallback fails silently.** Claude Code saves a large result to a file and says "use Read". An agent locked down with `tools: []`, as the SDK recommends, can't read it. This happened 37 times. The SDK should warn about it, or return a truncated preview plus a paging hint.
- **Agent templates for scientific records** should ship exhaustive scan, aggregate and dedupe primitives, with a record of which rows each answer came from.
- **The case for tools over long context** is data past 1M tokens, live logs and cost per question, not accuracy at a few hundred records.

## Week 1: Trust (can scientists rely on the answers?)

**Ship:**
- The connector, agent and Skill, hardened.
- The eval grown from 15 to about 50 questions, collected from partners' *real* past questions.
- Import of one partner's existing records (spreadsheet or lab notebook export) next to the synthetic data.

**Interview round 1 (days 2–3): 5 bench scientists across 2 labs, 30 minutes each.**

| Question | Number it produces | Decision rule |
|---|---|---|
| "The last time you repeated, or almost repeated, work someone had already done: how many hours and how much material did it cost?" | Hours and $ per incident; incidents per quarter | **< 2 h per scientist per month:** the "has anyone tried this?" pitch is weak, so lead with protocol capture. **≥ 2 h:** keep it as the headline |
| "Of your last 10 questions to a colleague about past work, how many could the written record have answered?" | Tacit fraction (0–10) | **≥ 5/10 not in the record:** passive logging is the core value, so prioritize ingestion in week 2 |
| Show 3 agent answers on their own data. "Which would you act on without checking? Which claims did you verify?" | % of answers acted on; % of citations clicked | **> 50% of citations clicked:** trust is the bottleneck, so invest in the trace and citations before new features |
| "One wrong number in an answer: does that end your use of the tool, or is it a warning?" | Tolerance for wrong numbers (forced choice) | Sets the eval release bar. Likely **0 wrong numbers** and **≥ 95% citation validity** |

**Exit criteria:** eval at or above the release bar on partners' real questions; at least one real past dead end resurfaced on partner data.

## Week 2: Capture (where does the data actually come from?)

**Ship:**
- Ingestion paths, in the order round 1 set:
  - **MHS-style logs** where devices allow it (research preview access permitting; otherwise instrument CSV exports)
  - **Quick manual entry** for devices with no interface
  - **Simple timestamp capture** for steps no device sees, like the degasser
- **`draft_trial`** with approval, live for partners.
- **Paper worksheets as a capture channel.** Labs run on paper at the bench, so meet them there.
  - **Printable worksheets** are generated per trial from the current SOP version. Each carries a **code** (QR plus a short human-readable ID, e.g. `T15a · SOP v2`) that links it to the experiment and the SOP version.
  - **Scan to log:** photograph the filled sheet. Claude's vision reads the handwritten values into the trial's log as `source: "paper"`, with the scan attached as evidence.
    - **Low-confidence fields are flagged for the owner to confirm.** Nothing is entered silently.
  - **The sharpie override:** if the printed code is crossed out and a different ID is handwritten, the scan detects the strike-through, reads the new ID and asks *"Link this sheet to T16 instead of T15a?"* before filing it.
    - This handles reality: grabbing the wrong sheet, or reusing a blank one.

**Interview round 2 (days 7–8): the lab manager plus 3 scientists. Show week-1 usage logs during the interview.**

| Question | Number it produces | Decision rule |
|---|---|---|
| "List the instruments you used last week. Which export data automatically, which by hand, which not at all?" | % of protocol steps unlogged, per device | Highest-volume unlogged device gets the next driver or manual-entry form. **> 30% of steps unlogged:** argues for a camera or timestamp channel (this links to prototype 01) |
| "How many minutes did you spend writing notebook entries yesterday?" | Minutes per day (baseline) | Sets the time-saved metric for week 3 |
| Rank: has-anyone-tried · automatic logging · trial drafting · protocol walkthrough · anomaly flags | Forced ranking (Borda score) | Top 2 get week 3's build time. **Bottom 2 get cut from the roadmap** |
| "For your last experiment, what was recorded on paper, and how long did transcribing it take? Did any of it never get transcribed?" | % of data on paper; transcription minutes; % never transcribed | **≥ 20% of data on paper, or any never transcribed:** paper capture moves up to week 2's top priority. Under that, it moves to the backlog |
| "When did your protocol last change? Did everyone find out, and was the change written down?" | Days since the last SOP change; % of changes unrecorded | **Any unrecorded change in the last month:** SOP versioning ships in week 3 |
| Show 5 agent-drafted trial plans. "Approve as is, edit, or reject?" | Approval rate; edits per draft | **≥ 60% approved with minor edits:** keep drafting. **< 30%:** drafting is premature, so return to question answering |

**Exit criteria:** at least 70% of protocol steps captured for one partner workflow; a baseline for drafted-plan approval rate.

## Week 3: Distribution and value (would they keep it?)

**Ship:**
- The plugin (Skill plus connector) running where partners already work: Claude Code or Claude Science, verified first.
- **Cost per answer and latency on dashboards.** Haiku handles simple lookups if the eval holds.
- Data handling written up: where the data lives, what reaches the model, retention.
- **Versioned SOPs** (gated by round 2):
  - Every SOP edit creates a new version, with author, date and reason.
  - Each trial is pinned to the SOP version it ran under.
  - **Redline view:** changes between versions show as struck-through and highlighted text, the way a scientist would mark up paper. Future worksheets print the current version, with recent changes highlighted so nobody misses them.
  - **Protocol Diff gains a third column, "the SOP at the time,"** so the diff separates three things:
    - **deviation:** the person departed from the SOP
    - **SOP change:** the protocol itself changed between versions
    - **intended variable:** what was being studied
  - **Older experiments become re-readable:** "T07 ran under SOP v1, which had no degas step. Degassing was added in v2 after the T15 result."

**Interview round 3 (days 13–15): users after a week of real use, plus the PI or budget owner.**

| Question | Number it produces | Decision rule |
|---|---|---|
| (From logs) Questions per user per week; % of answers with a clicked citation; drafts approved | Usage | **< 3 questions/user/week:** not habit-forming, so find where it should appear (a Slack mention? the instrument PC?) |
| "If this disappeared tomorrow, how disappointed would you be: very, somewhat, not?" | % very disappointed | **≥ 40%:** expand to more labs. **< 25%:** stop and re-scope |
| To the PI: "What did your last abandoned direction cost, in weeks and dollars? What would you pay to avoid one per quarter?" | Cost of a dead end; willingness to pay | Sets the ROI case and pricing tier |
| "Who has to approve before notebook data goes to a model?" | Approval steps; requirements (VPC, Bedrock or Vertex, retention) | Defines the deployment architecture for the expansion conversation |

**Exit:** a steering memo plus a product feedback memo to Anthropic.

## Product feedback (written in week 3, with numbers attached)

Expected themes, to be confirmed by the data:

1. **A project layer for Claude Science** (the headline): objectives with pass criteria, trials owned by people, and a shared findings ledger. The numbers behind it: the undocumented-knowledge fraction and repeated-work hours from round 1.
2. **MHS as a recorder, not just a controller.** Passive, attributed logging of human-run steps. The number behind it: % of unlogged steps from round 2.
3. **An observer or manual-entry path for devices with no interface.** The degasser problem, generalized.
4. **A citation-first answer style** as the default for team scientific data.
5. **A fast, bounded-choice primitive** for high-volume classification, if the Haiku cost and latency numbers say customers need it.

## Metrics summary

| Metric | Starting target (a hypothesis) |
|---|---|
| **Main metric:** hours of repeated work avoided per scientist per month | ≥ 2 |
| Wrong numbers in answers (eval) | 0 |
| Citation validity (eval) | ≥ 95% |
| Drafted trials approved with minor edits | ≥ 60% |
| "Very disappointed" | ≥ 40% |
| Cost per answer, p50 latency | Measured in week 1; budget set after |
