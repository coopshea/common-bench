# Data notes (phase 0 handoff)

`node data/generate.ts` regenerates `data/notebook.json` and prints `data/verification.txt` (23/23 story checks pass, seed 5).
`data/ground_truth.json` is hidden ground truth for evals only. **Never show it in the UI or give it to the agent.**

## Where the data bends or adds to BRIEF.md

1. **Two people only.** Cooper (former, blue `#2a78d6`) and Shreya (current, violet `#6250d6`; coral was dropped because it reads as "fail" next to status colors). Lena was cut (Cooper's call). The open ledger question L3 is Shreya's.
2. **Bubble physics.** Thin resin folds more air in at 3000 rpm, and bubbles rise out slowly, with rise time proportional to viscosity. That's why high-diluent, undegassed trials are porous (2.4–5.2%) and low-diluent ones aren't (0.3–0.75%). BRIEF said porosity "rises with viscosity × shear", but that would have made campaign A porous, which breaks the story.
3. **T09 meets the objective outright:** 1.28 Pa·s with every guardrail passing. It was excluded as "a lucky specimen". The team-visible "best so far" (included trials only) is Shreya's 1.55. The reveal: an excluded trial already hit the target once, by accident, so T15 needs a controlled test.
4. **The "As the team saw it" lens fits on diluent only,** the variable the dead end was declared on, with T09 excluded. The wall is vertical at ~34%. A 2-D fit tilts badly, because photoinitiator is confounded with *who* ran the trial: it credits Shreya's success to photoinitiator. T15's design (both arms at PI 1.7, only degassing varies) is what separates the two explanations. That's a good line if asked.
5. **The "Split by degassing" lens** is a two-stage fit on all 14 trials (T09 included): ln(porosity) ~ diluent + degassed + rest_h (R² 1.0), then ridge logistic pass ~ diluent + PI + ln(porosity). The grid is predicted for degassed resin. Wall ~41–45%. `extrapolated_beyond: 32`: draw everything past 32% dashed (only 4 degassed trials, all ≤ 32%; only T09 supports the far side).
6. **Cooper's 2024–25 log entries have `backfilled: true`.** MHS didn't exist then, so those logs were imported from instrument exports (mixer run log, printer job history). Show "backfilled from instrument export" on them. Shreya's are live MHS-style capture. Her degas entries are `source: "manual"` (worksheet).
7. **The cytotoxicity optimum caps the true best** at ~41% diluent, PI 1.6–1.7, 1.17 Pa·s (ground truth). The UI never states this.

8. **Notes are notebook entries:** `notes: { id, step, t, text }[]`. Each is tied to the process step it was written at, with a timestamp just after that step's log entry. None mentions T09's overnight rest; only the log shows it.
9. **Draft estimates:** `landscape.models` also holds linear fits for tensile, bend and cells alive. `estimateRecipe()` returns all five checks, so T15a/b can be plotted. T15a: 1.29 Pa·s, 47.8 MPa tensile, 75.8 MPa bend, 0.41% bubbles. T15b: 38.6 MPa tensile and 63.2 MPa bend, both below the floor.
10. **The UI no longer uses the lens grids.** Cooper found them illegible. They stay in the data and the server's context, unused on screen.

## Key facts (all from notebook.json)

| id | who | dil% | PI% | degas | rest h | visc | por% | UTS | pass | note |
|---|---|---|---|---|---|---|---|---|---|---|
| T01–T05 | Cooper A | 15–24 | 0.6–1.0 | 0 | ~0.4 | 2.60–1.98 | 0.27–0.75 | 45–51 | all pass, too viscous | |
| T06 | Cooper B | 34 | 0.8 | 0 | 0.4 | 1.44 | 2.38 | 35.6 | fail | |
| T07 | Cooper B | 36 | 0.9 | 0 | 0.4 | 1.36 | 2.75 | 35.0 | fail | |
| **T08** | Cooper B | 38 | 1.0 | 0 | 0.4 | 1.30 | 3.74 | 34.4 | fail | the diff's "a" |
| **T09** | Cooper B | 38 | 1.0 | 0 | **18.2** | 1.28 | **0.38** | 44.2 | **PASS, excluded** | mix ended `T09-L05` 16:42 → print `T09-L07` 10:52 next day |
| T10 | Cooper B | 40 | 1.2 | 0 | 0.4 | 1.19 | 5.22 | 30.7 | fail | |
| T11 | Shreya | 26 | 1.5 | 10 | 0.5 | 1.85 | 0.12 | 53.1 | pass | first week, SOP walkthrough |
| T12 | Shreya | 28 | 1.8 | 10 | 0.6 | 1.76 | 0.13 | 49.0 | pass | |
| **T13** | Shreya | 30 | 1.7 | 10 | 0.5 | 1.65 | 0.15 | 49.3 | pass | the diff's "b" |
| **T14** | Shreya | 32 | 1.6 | 10 | 0.5 | **1.55** | 0.22 | 50.7 | pass | her best |

- Guardrails: tensile UTS ≥ 40; bend flex ≥ 65 and modulus ≥ 2000; porosity ≤ 1.0%; cytotoxicity viability ≥ 70%.
- Ledger: L1 (Cooper finding, accepted), **L2 (Cooper dead end, active, `region` = diluent 30–45 × PI 0.5–1.3, the hatch)**, L3 (Shreya's open question).
- Log ids look like `T09-L05`. The degas step exists only in Shreya's logs (`T11-L06`, `T13-L06`, …).
- T15 (draft, not in the data): **T15a** = 38% diluent, PI 1.7, degas 10 (treatment); **T15b** = same, no degas (control). Estimates come from `src/shared/surrogate.ts` `estimateRecipe(models, recipe)`, i.e. from models fitted to trials, never from the LLM.

## Shared code

- `src/shared/types.ts`: notebook types, `AskEvent` stream, `Proposal`, `ProtocolDiff`, `DraftTrial`, approve request and response.
- `src/shared/surrogate.ts`: predictions from the fitted models (viscosity, porosity, pass probability, `estimateRecipe`).
