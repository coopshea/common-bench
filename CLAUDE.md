# Common Bench

A collaborative lab notebook: a concept for a team project layer for Claude Science (unofficial). Read this first, then `README.md` and `app/DATA_NOTES.md`.

## The problem

Lab science is a search run by a team, and nobody can see the whole search. Regions get abandoned for the wrong reason, outliers get dismissed, and know-how never moves between people. Common Bench gives the team a shared map of everyone's trials, catches results that weren't measured the same way, and proposes the next experiment. A person approves every change, and credit goes to the person whose work produced the finding.

## The demo story

- **Cooper** (former member) searched two years ago and wrongly called high diluent a dead end. His one excluded trial, T09, rested 18 h before printing and passed.
- **Greeshma** (current) has fewer trials, in a different region, and they're better, because of a degassing habit that isn't in the SOP.
- The agent finds the unintended difference, revives T09, and proposes T15a/T15b: a crossover with a control arm and nothing to order.
- Only these two people exist. The company (Meridian Dental Materials) is fictional.

## Build rules

1. **Toy is fine; legible is mandatory.** Radically simple UI: the chart carries the meaning, not captions.
2. **All data comes from one seeded generator** (`app/data/generate.ts`). Every number on screen traces back to it, and never hand-edit `notebook.json`. Run `npm run data` to regenerate; 24/24 story checks must pass.
3. **Numbers come from tools, not the model.** Draft estimates come from models fitted to the trials (`src/shared/surrogate.ts`).
4. **The demo works offline.** The hero answer is recorded in `app/server/cache/`, and replays when there's no key or network.
5. **Nothing changes without an approval card.** The write tools are gated by the Agent SDK permission callback.
6. **Colors:** one per person (Cooper `#2a78d6`, Greeshma `#6250d6`). Status colors (✓ `#0ca30c`, ○ `#d99a00`, ✕ `#d03b3b`) are never used for people.
7. **Figures are parametric:** each figure is a pure function of one trial. See `app/src/figures/FIGURES_HANDOFF.md`.
8. **MHS** means MHS-style logging, built from the public description of Anthropic's Model Hardware Standard research preview. There's no access to MHS itself.

## Structure (2026-10-18)

- **Navigation:** thrust → project → experiment → trial, plus the Lab (the room).
- **Data:** the generator also writes `org` (thrusts, projects, experiments) and `lab` (the room). Only the notebook project has trials; its sibling projects exist so it isn't alone.
- **Design system:** `app/src/ds/`. `tokens.json` is the same file as the Design System artifact, and `tokens.css` is generated from it (`npm run tokens`). Components are `cb-*`.
- **Text budgets:** titles ≤ 8 words, labels ≤ 3, one sentence per panel. Navigation screens show a title and people only.
- **Not built yet:** shown with a FUTURE tag, never a disabled control.
- **Retired:** the old single-screen `Workspace.tsx` and the Guide (`TourBar`, `tour.ts`) are no longer mounted. The walkthrough needs rewriting for the new structure.

## Layout

- `app/`: Vite + React UI, Hono + Claude Agent SDK server, notebook MCP tools, Skill, plugin, evals (`npm run dev`)
- `ROADMAP.md`: the pilot plan and known limits
