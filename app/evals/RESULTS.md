# Eval results

Generated 2026-10-13T17:38:52.070Z · 15 questions (`evals/questions.json`, built from `data/notebook.json` by `evals/build-questions.ts`) · n = 1 per question per config.

| Config | Model | n | Accuracy | Citation validity | Abstention | Wrong numbers | Hero pass | Cost / question | p50 latency |
|---|---|---|---|---|---|---|---|---|---|
| A · Whole notebook in context · Sonnet | `claude-sonnet-5-5` | 15 | 100% | 100% | 100% | 0 | yes | $0.0190 | 4.6 s |
| B · Agent + tools · Sonnet | `claude-sonnet-5-5` | 15 | 100% | 100% | 100% | 0 | yes | $0.0180 | 7.0 s |
| C · Agent + tools · Haiku | `claude-haiku-5-5` | 15 | 100% | 100% | 100% | 0 | yes | $0.0015 | 5.4 s |

## How it's graded

- **Accuracy:** every expected number appears within tolerance and every required concept is named (regex). For abstention questions: the answer says it isn't in the notebook and states no untraceable numbers. For the hero: also names the degassing confound and T09 and proposes a control arm.
- **Citation validity:** share of answers whose bracketed ids (plus structured citations and ids inside proposals) all exist in the notebook (T01–T14, Txx-Lnn, L1–L3; L4/T15* allowed only in the hero) *and* include the question's required evidence ids.
- **Abstention:** share of the two "not in the notebook" questions answered that way.
- **Wrong numbers:** numbers with a unit (Pa·s, MPa, %, h, min, $, …) or a decimal point that match no notebook value, simple group statistic, log gap, or code-computed estimate at the precision stated. A lenient heuristic: derived percentages ("a 30% drop") can be flagged, and a wrong number that happens to equal some other notebook value is missed. Flagged strings are listed per question below.
- **Hero judge:** `claude-haiku-5-5` with forced tool use scores the proposal on 4 criteria (control arm, cheapest experiment, credit to Shreya, uncertainty stated). Reported, not part of accuracy.
- **Cost:** A from `usage` at published prices (Sonnet 5.5 $2 in / $10 out / $2.50 cache write / $0.20 cache read per MTok; the notebook block is prompt-cached). B and C use `cost_usd` reported by the agent.

## Per question

| Q | Category | A | B | C |
|---|---|---|---|---|
| q01 | lookup | ✓ | ✓ | ✓ |
| q02 | lookup | ✓ | ✓ | ✓ |
| q03 | lookup | ✓ | ✓ | ✓ |
| q04 | lookup | ✓ | ✓ | ✓ |
| q05 | aggregation | ✓ | ✓ | ✓ |
| q06 | aggregation | ✓ | ✓ | ✓ |
| q07 | aggregation | ✓ | ✓ | ✓ |
| q08 | aggregation | ✓ | ✓ | ✓ |
| q09 | log_timing | ✓ | ✓ | ✓ |
| q10 | protocol_diff | ✓ | ✓ | ✓ |
| q11 | ledger | ✓ | ✓ | ✓ |
| q12 | abstain | ✓ | ✓ | ✓ |
| q13 | abstain | ✓ | ✓ | ✓ |
| q14 | hero | ✓ judge 2/4 | ✓ judge 4/4 | ✓ judge 4/4 |
| q15 | aggregation | ✓ | ✓ | ✓ |

## Failures and flags


## Hero judge (claude-haiku-5-5)

| Config | Control arm | Cheapest experiment | Credits Shreya | Uncertainty stated | Score |
|---|---|---|---|---|---|
| A | ✓ Proposes rerunning Cooper's T06 recipe with a 10-minute degas, using T06 (no degas) as the control arm, isolating degass | ✓ Proposes rerunning the T06 recipe with a 10-minute degas, which uses existing materials and is a short test, before orde | ✗ Presents the degas insight as the assistant's finding ('That looks like an unlogged degas-like difference', 'I'd propose | ✗ States conclusions firmly ('That looks like...', 'If porosity and UTS recover, you're under 1.5') without noting that fe | 2/4 |
| B | ✓ T15b is the same recipe (38% diluent, 1.7% PI) with no degas, isolating degassing as the only difference from T15a. | ✓ "Nothing to order, so it's a day's work instead of $1,800 and six weeks"; all materials are in stock and the degasser is | ✓ "Credit to you for degassing routinely" and the proposed finding L4 is owned by Shreya, with the degas step framed as  | ✓ "Only 7 trials support this, and 38% diluent with degassing is untested"; the draft also labels the estimates as fitted  | 4/4 |
| C | ✓ T15b is identical to T15a (34% diluent, 1.6% PI, 0.5 h rest) but with no degas, isolating degassing as the only variable | ✓ Proposes T15a/T15b using materials already in stock (base monomer, current diluent, photoinitiator, vacuum degasser) wit | ✓ Says 'Your 10-minute degas [T13-L06] passed strength' and 'Your 32% run' and 'Ledger: ... under you', crediting Shreya | ✓ States 'This is uncertain: only two degassed trials exist, and none at 34% or above', and the ledger finding is 'candida | 4/4 |

## Notes

- A: 15/15 correct; 0 number(s) not traceable to the data; hero passed, judge 2/4.
- B: 15/15 correct; 0 number(s) not traceable to the data; hero passed, judge 4/4.
- C: 15/15 correct; 0 number(s) not traceable to the data; hero passed, judge 4/4.
- Spend for the answers on record: A $0.29, B $0.27, C $0.02; hero judge $0.0015; total $0.58.
- All three setups got the same prompt rules, asker and effort. All three answered 15/15, cited only real ids, declined both questions the notebook can't answer, and stated no number the grader couldn't trace. At 14 trials the whole notebook (about 34K tokens) fits in context, so tools don't win on accuracy here.
- Haiku with tools matched them at $0.0015 a question, 12–13× cheaper than Sonnet either way. That's the routing case: Haiku for lookups, Sonnet when a decision is at stake.
- On the hero question, the Haiku judge scored the whole-notebook proposal 2/4 (it didn't credit Shreya or say what's uncertain) and both tool setups 4/4. One run each, so read it as a signal, not a result.
- Why tools anyway: numbers are computed in code, citations come from tool results, and the design keeps working at 10,000 trials and live device logs, which won't fit in context.
- Grader fixes after the first pass, applied to stored answers: "isn't in the notebook" now counts as declining, and a ratio of two numbers the answer itself states isn't counted as a wrong number. Both had caused false failures.
