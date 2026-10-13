# Stress eval results

Generated 2026-10-13T18:26:29.526Z · sizes 50, 250, 1000 trials · 30 questions per size (`evals/stress/questions-<size>.json`, built by `evals/stress/generate-haystack.ts` from seeded synthetic notebooks) · n = 1 per question per config · total API spend on record $8.96.

## Findings

- **At 50 trials (102K tokens) every setup is near-perfect** even with the traps: A 26/26, B 24/26, C 30/30. The original eval's "100% everywhere" still holds at this size, so on its own it says nothing about scale.
- **A (whole notebook in context) never broke while the notebook fit.** At 250 trials (488K tokens) it scored 15/15 on the core set and 4/4 on harder probes: a median over 250 values, all 8 print-to-post-cure waits found by subtracting log timestamps, a 20-hop parent chain, and a count of 3,813 log entries. Caveats: n = 1, and the synthetic logs are perfectly regular. A counted log entries from the structure (250 × 15, plus 61 degas entries, plus 2 for the restart), which a messier real notebook wouldn't allow.
- **A breaks on the context window and the cost, not on reasoning.** At 1,000 trials the notebook is 1,939,730 tokens, about twice Sonnet 5.5's 1M window, so it can't run. At 250 trials each cache write cost $1.22–1.27, a cached question about $0.11, and p50 latency was 14 s (versus about $0.03 and 5 s at 50 trials).
- **The tool agents broke at 250 trials: B (Sonnet) got 7/15 of the core set and C (Haiku) 8/15. C stayed at 7/15 at 1,000.** The traces show four tool-design causes:
- (1) **Unbounded output.** `search_trials` with no filter returns 152K characters at 250 trials. Claude Code saves oversized results to a file and tells the agent to read it, but this agent has no file tool (`tools: []`), so it's a dead end. This happened 37 times across 31 runs.
- (2) **Schemas frozen to the demo.** The owner filter only accepts `cooper` or `greeshma` (B: "The trial filters only accept Cooper or Greeshma as owner, not Ines"). `compare_groups` groups owners by first name, which merges Dana Whitfield and Dana Whitford into one "Dana".
- (3) **No search across logs or notes.** Log-only needles (an aborted print, a 31 h post-cure wait, which trials used the loaner mixer) need one `get_log` call per trial. At 50 trials both agents brute-forced it (51 calls, $0.19 for Sonnet). At 250 and 1,000 they sampled a few logs and gave up. One exception: at 250, B found all 30 loaner-mixer trials by reading about 40 logs around the window an open ledger question pointed to. At 1,000 it gave up.
- (4) **"Quote, don't recompute" backfires.** The tool server's instructions made Sonnet refuse to pool two group means into the overall mean it was asked for ("I'm not allowed to compute one myself"), at both 50 and 250 trials. Haiku computed the weighted average.
- **The agents fail safely.** Of 34 agent failures, 31 said they couldn't find or compute the answer and explained why. 3 were confidently wrong, all from Haiku: "Dana 360" with the two Danas silently merged (1,000 trials), the parent instead of the child on a reverse hop (1,000), and a count of trials that met the objective instead of trials that reached the viscosity target (250). No config cited an id that doesn't exist, at any size; the lookalike ids never caused a mistake.
- **With these tools, Sonnet buys no accuracy over Haiku.** At 250 trials the core scores were 7/15 vs 8/15, at $0.06 vs $0.01 a question. Haiku sometimes did better by brute force: at 50 trials it pulled every trial in one call and counted the Danas correctly, and it did the arithmetic Sonnet refused.
- **Traps that didn't catch anyone:**
  - abstention traps with a tempting near-match: Whitford's 44% trial, a 2.4% PI trial, Cooper's undegassed trials, mixer #2 versus printer #2
  - the superseded ledger finding, whose status note says it's superseded
  - notes that contradict measurements, when the question names the trial
  - both confound questions, which name the trials or have an open ledger question pointing at the evidence

  Harder versions would hide the supersession and remove the hints.
- **Fixes the traces point to, cheapest first:**
  - paginate and project `search_trials` (ids plus a few fields by default, with a cursor)
  - build the filter enums from the data
  - group by person id, not first name
  - add `search_logs` (event, device, gap) and `search_notes` (text)
  - add an ungrouped stats tool (count, mean, median)
  - let the agent do simple arithmetic as long as it shows the working

  Then re-run this eval. The 0-wrong-numbers release bar from the README held for Sonnet; it didn't hold for Haiku at scale.

## Size × config

| Trials | Config | Status | Context | Core 15 | All questions run | Citation validity | Declines correctly | Confidently wrong | Gave up / hedged | Tool calls / q | Cost / q | p50 latency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | A · Whole notebook in context · Sonnet | ran | 102K tok | **15/15** | 26/26 (100%) | 100% | 4/4 | 0 | 0 | 0 | $0.0455 | 5.1 s |
| 50 | B · Agent + tools · Sonnet | ran | tools | **13/15** | 24/26 (92%) | 100% | 4/4 | 0 | 2 | 9 | $0.0504 | 7.9 s |
| 50 | C · Agent + tools · Haiku | ran | tools | **15/15** | 30/30 (100%) | 100% | 4/4 | 0 | 0 | 14.3 | $0.0059 | 10.6 s |
| 250 | A · Whole notebook in context · Sonnet | ran | 488K tok | **15/15** | 19/19 (100%) | 100% | 1/1 | 0 | 0 | 0 | $0.2326 | 14.5 s |
| 250 | B · Agent + tools · Sonnet | ran | tools | **7/15** | 8/16 (50%) | 75% | 1/1 | 0 | 8 | 7.4 | $0.0615 | 12.2 s |
| 250 | C · Agent + tools · Haiku | ran | tools | **8/15** | 19/30 (63%) | 90% | 3/4 | 1 | 10 | 6.2 | $0.0097 | 9.6 s |
| 1000 | A · Whole notebook in context · Sonnet | **doesn't fit** (1,939,730 tokens > 1,000,000-token context window) | 1940K tok | – | – | – | – | – | – | – | – | – |
| 1000 | B · Agent + tools · Sonnet | ran | tools | **6/7** | 6/7 (86%) | 100% | 1/1 | 0 | 1 | 3.7 | $0.0568 | 10.6 s |
| 1000 | C · Agent + tools · Haiku | ran | tools | **7/15** | 18/30 (60%) | 83% | 4/4 | 2 | 10 | 4.1 | $0.0067 | 10.3 s |

## By category (correct / asked)

| Trials | Config | needle | aggregation | multi-hop | contradiction | abstain-trap | confound |
|---|---|---|---|---|---|---|---|
| 50 | A | 4/4 | 7/7 | 4/4 | 5/5 | 4/4 | 2/2 |
| 50 | B | 4/4 | 5/7 | 4/4 | 5/5 | 4/4 | 2/2 |
| 50 | C | 5/5 | 9/9 | 5/5 | 5/5 | 4/4 | 2/2 |
| 250 | A | 4/4 | 7/7 | 3/3 | 2/2 | 1/1 | 2/2 |
| 250 | B | 1/3 | 2/5 | 1/2 | 1/3 | 1/1 | 2/2 |
| 250 | C | 2/5 | 4/9 | 4/5 | 4/5 | 3/4 | 2/2 |
| 1000 | B | 1/1 | 1/2 | 1/1 | – | 1/1 | 2/2 |
| 1000 | C | 2/5 | 3/9 | 3/5 | 4/5 | 4/4 | 2/2 |

## Per question

| Q | Template | Category | 50·A | 50·B | 50·C | 250·A | 250·B | 250·C | 1000·B | 1000·C |
|---|---|---|---|---|---|---|---|---|---|---|
| s01 | ● needle_overnight_rest | needle | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s02 | ● needle_postcure_gap | needle | ✓ | ✓ | ✓ | ✓ | –✗ c✗ | –✗ c✗ | – | –✗ c✗ |
| s03 | ● needle_print_restart | needle | ✓ | ✓ | ✓ | ✓ | –✗ c✗ | –✗ c✗ | – | –✗ c✗ |
| s04 | needle_lookalike_log | needle | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ |
| s05 | agg_total_pass | aggregation | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ |
| s06 | ● agg_mean_viscosity | aggregation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s07 | ● agg_per_person_counts | aggregation | ✓ | –✗ | ✓ | ✓ | –✗ | –✗ | – | ✗ |
| s08 | ● agg_whitford_uts | aggregation | ✓ | ✓ | ✓ | ✓ | –✗ | –✗ | – | –✗ |
| s09 | agg_degas_porosity | aggregation | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ |
| s10 | ● agg_mixer2_count | aggregation | ✓ | ✓ | ✓ | ✓ | ✓ | –✗ | –✗ | –✗ |
| s11 | ● agg_highdil_uts | aggregation | ✓ | –✗ | ✓ | ✓ | –✗ | ✓ | – | –✗ |
| s12 | ● hop_restart_parent | multi-hop | ✓ | ✓ | ✓ | ✓ | –✗ c✗ | –✗ c✗ | – | –✗ c✗ |
| s13 | hop_cytotox_child | multi-hop | ✓ | ✓ | ✓ | – | – | ✓ | – | ✗ c✗ |
| s14 | ● hop_best_parent | multi-hop | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s15 | hop_overnight_ancestor | multi-hop | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ |
| s16 | contra_tensile | contradiction | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ |
| s17 | ● contra_ines_target | contradiction | ✓ | ✓ | ✓ | ✓ | –✗ | ✗ | – | ✓ |
| s18 | contra_porosity | contradiction | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ |
| s19 | ● contra_find_all | contradiction | ✓ | ✓ | ✓ | ✓ | –✗ c✗ | ✓ | – | –✗ c✗ |
| s20 | ● abstain_whitfield_44 | abstain-trap | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s21 | abstain_pi_25 | abstain-trap | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ |
| s22 | abstain_cooper_degassed | abstain-trap | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ |
| s23 | abstain_printer2 | abstain-trap | ✓ | ✓ | ✓ | – | – | –✗ | – | ✓ |
| s24 | ● confound_winter_mixer | confound | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s25 | ● confound_prewarm | confound | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s26 | probe_median_porosity | aggregation | – | – | ✓ | ✓ | – | –✗ | – | –✗ |
| s27 | probe_postcure_waits | needle | – | – | ✓ | ✓ | – | –✗ | – | –✗ |
| s28 | probe_parent_chain | multi-hop | – | – | ✓ | ✓ | – | ✓ | – | ✓ |
| s29 | probe_log_count | aggregation | – | – | ✓ | ✓ | – | –✗ | – | –✗ |
| s30 | ledger_superseded | contradiction | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | ✓ |

`✓` correct · `✗` confidently wrong · `–✗` gave up or hedged (said it couldn't answer) · `c✗` citation problem (an id that doesn't exist, or the required evidence not cited) · `–` not run. Core-15 templates are marked ●.

## How it's graded

- **Data:** `generate-haystack.ts` (seed 11) writes one notebook per size in the same `Notebook` shape as `data/notebook.json`: 8 people (Cooper and Greeshma plus six fictional colleagues, two of them named Dana), 15 campaigns, ~15 log entries and 1–3 notes per trial, and a findings ledger. `data/notebook.json` is never modified.
- **Planted at every size:** an overnight rest (T09-like), a >24 h post-cure delay and an aborted print (log only), a loaner mixer in winter 2025–26 (log device field only), two same-recipe trials that differ only by an unlogged pre-warm habit (notes only), three notes that contradict their own measurements, two people named Dana, lookalike ids, a superseded ledger finding, and four abstention traps with a tempting near-match.
- **Expected answers** are computed by `questions.ts` from the generated notebook, and each planted fact is re-derived and asserted unique.
- **Accuracy:** every expected number within tolerance (counts exact; means ±0.01 Pa·s or ±0.06 MPa; hours ±0.25), every required concept or id named, per-person counts next to the right name. Abstention traps: the answer must say it isn't in the notebook.
- **Citation validity:** every bracketed id exists in that size's notebook, and the required evidence ids are cited (a log id counts for its trial).
- **Confidently wrong vs. gave up:** a failed answer is *confidently wrong* when it states an answer without hedging (wrong number, wrong trial, answered an abstention trap). It *gave up / hedged* when it says it couldn't find or compute the answer, or stopped at the per-question budget. The first is the dangerous kind.
- **Core 15:** the same 15 questions (all six categories) in every cell the budget allowed; use this column to compare cells. "All questions run" differs per cell: C ran all 29 at every size; A and B ran 25 at 50 trials; A ran the core 15 plus the 4 harder probes at 250; B ran the core 15 at 250 and only the 7 questions it still passed at 250 when run at 1,000.
- **Agent budget:** B and C ran with the Agent SDK's `maxBudgetUsd` per question (B $0.25–0.30, C $0.10; size 50 ran before the cap existed and no question there exceeded $0.20).
- **Cost:** A from `usage` at published Sonnet 5.5 prices ($2 in / $10 out / $2.50 cache write / $0.20 cache read per MTok; the notebook is prompt-cached, first question writes it). B and C from the Agent SDK's `total_cost_usd`.
- **A doesn't fit** when the notebook plus 20K tokens of headroom exceeds the 1M-token window (token count from `count_tokens`, or estimated from chars/token when the request is too large to count).

## Failures

- **50 B s07** (agg_per_person_counts): per-person counts wrong or missing: Dana Whitfield 7, Dana Whitford 4
- **50 B s11** (agg_highdil_uts): missing/wrong number: mean UTS (43.067 MPa)
- **250 B s02** (needle_postcure_gap): missing/wrong number: gap hours (31.2 h) · missing: names T241 · didn't cite T241-L09, T241-L10
- **250 B s03** (needle_print_restart): missing: names T46; vat film · didn't cite T46-L08
- **250 B s07** (agg_per_person_counts): per-person counts wrong or missing: Dana Whitfield 48, Dana Whitford 35
- **250 B s08** (agg_whitford_uts): declined to answer · missing/wrong number: Whitford trial count (35); Whitford mean UTS (43.169 MPa)
- **250 B s11** (agg_highdil_uts): declined to answer · missing/wrong number: mean UTS (42.455 MPa)
- **250 B s12** (hop_restart_parent): declined to answer · missing/wrong number: parent viscosity (2.14 Pa·s) · missing: names T45 · didn't cite T45
- **250 B s17** (contra_ines_target): declined to answer · missing/wrong number: Ines trials ≤ 1.5 (20)
- **250 B s19** (contra_find_all): missing: names T194 · didn't cite T194
- **250 C s02** (needle_postcure_gap): missing/wrong number: gap hours (31.2 h) · missing: names T241 · didn't cite T241-L09, T241-L10
- **250 C s03** (needle_print_restart): declined to answer · missing: names T46; vat film · didn't cite T46-L08
- **250 C s07** (agg_per_person_counts): declined to answer · per-person counts wrong or missing: Dana Whitfield 48, Dana Whitford 35
- **250 C s08** (agg_whitford_uts): missing/wrong number: Whitford trial count (35); Whitford mean UTS (43.169 MPa)
- **250 C s10** (agg_mixer2_count): declined to answer · missing/wrong number: mixer #2 trials (30)
- **250 C s12** (hop_restart_parent): declined to answer · missing/wrong number: parent viscosity (2.14 Pa·s) · missing: names T45 · didn't cite T45
- **250 C s17** (contra_ines_target): missing/wrong number: Ines trials ≤ 1.5 (20)
- **250 C s23** (abstain_printer2): stopped at the $0.1 per-question budget before answering · no answer · answered instead of saying it's not in the notebook
- **250 C s26** (probe_median_porosity): declined to answer · missing/wrong number: median porosity (0.82 %)
- **250 C s27** (probe_postcure_waits): missing: names T26; names T35; names T55; names T72; names T90; names T100; names T206; names T241
- **250 C s29** (probe_log_count): declined to answer · missing/wrong number: log entries (3813)
- **1000 B s10** (agg_mixer2_count): declined to answer · missing/wrong number: mixer #2 trials (103)
- **1000 C s02** (needle_postcure_gap): declined to answer · missing/wrong number: gap hours (31.2 h) · missing: names T715 · didn't cite T715-L09, T715-L10
- **1000 C s03** (needle_print_restart): missing: names T762; vat film · didn't cite T762-L08
- **1000 C s07** (agg_per_person_counts): per-person counts wrong or missing: Dana Whitfield 233, Dana Whitford 127
- **1000 C s08** (agg_whitford_uts): declined to answer · missing/wrong number: Whitford trial count (127); Whitford mean UTS (41.949 MPa)
- **1000 C s10** (agg_mixer2_count): declined to answer · missing/wrong number: mixer #2 trials (103)
- **1000 C s11** (agg_highdil_uts): missing/wrong number: mean UTS (42.21 MPa)
- **1000 C s12** (hop_restart_parent): missing/wrong number: parent viscosity (1.57 Pa·s) · missing: names T756 · didn't cite T756
- **1000 C s13** (hop_cytotox_child): missing: names T415 · didn't cite T415
- **1000 C s19** (contra_find_all): stopped at the $0.1 per-question budget before answering · no answer · missing: names T714; names T848; names T688 · didn't cite T714, T848, T688
- **1000 C s26** (probe_median_porosity): missing/wrong number: median porosity (0.8 %)
- **1000 C s27** (probe_postcure_waits): declined to answer · missing: names T43; names T54; names T56; names T61; names T139; names T168; names T180; names T302; names T306; names T406; names T501; names T522; names T527; names T634; names T674; names T715; names T718; names T754; names T796; names T834; names T875; names T942; names T971
- **1000 C s29** (probe_log_count): missing/wrong number: log entries (15227)
