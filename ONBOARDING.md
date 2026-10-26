# Onboarding: the 60-second explainer

One script with two uses. It's a 60-second video, and each beat is also a first-run onboarding step in the app. The video plays the beats one after another. The app plays the same beats over the real UI, one panel at a time.

## The argument

1. **The problem.** Every experiment answers three questions: *What have we tried? How well did it work? What do we try next?* On a team, the answers are scattered across people, notebooks and years. The most decisive part, how each person actually does the work, is never written down.
2. **What changed.** Machines can now log what they do. MHS lets an agent see and run equipment. Most bench work is still done by people, so their steps need logging too. Once both kinds of step land in one notebook, an agent can see the team's whole search.
3. **How Common Bench answers each question.** There is one feature per question:

| Question | Feature | In the story |
|---|---|---|
| What have we tried? | **The map**: everyone's trials on one chart, with replay | Cooper's "dead end" and Shreya's better region, side by side |
| How well did it work, and why did results differ? | **Protocol Diff**: two runs step by step, intended vs. accidental | She degasses, he never did; T09 sat overnight and passed |
| What do we try next? | **The agent**: proposes the next trial, with a control | T15a/T15b, nothing to order; a person approves |

**Close:** less time reprogramming mixers, more time interpreting results.

## The script (≈145 words, 60 s)

Visual language: the MHS explainer. Warm graph paper, rounded chips, hand-inked wires, one accent for "active". The person colors (Cooper `#2a78d6`, Shreya `#6250d6`) are the only other colors. Beats 1–3 are drawn on paper. Beats 4–6 cross-fade into the real app, so the viewer recognizes it afterward.

| # | Time | Voiceover | Picture |
|---|---|---|---|
| 1 | 0:00–0:08 | "Every experiment answers three questions. What have we tried? How well did it work? What do we try next?" | Dark card turns to paper. The three questions appear one at a time, centered, then settle into a small stack at the top left, where they stay for the rest of the film. |
| 2 | 0:08–0:20 | "On a team, the answers are scattered across people, notebooks and years. And how each person actually does the work is never written down." | A graph-paper lens opens. Cooper's notebook chip has blue trial dots; Shreya's, two years later, has violet dots. They sit apart with no wire between them. A dashed chip, "degas 10 min", floats beside Shreya's notebook only (the tacit habit). |
| 3 | 0:20–0:30 | "Now machines can log what they do. With the Model Hardware Standard, an agent can see and run lab equipment. But people still run most of the bench, so their steps get logged too." | The process row slides in: balance, mixer, degasser, viscometer, printer, oven, test frame. The MHS-capable devices pulse and wire into a **Common Bench** chip. The degasser has no interface: a person icon logs it, and its wire goes from dashed to solid. Both notebooks wire in. The end state echoes the MHS fan: **Agent → Common Bench → people + devices**. |
| 4 | 0:30–0:38 | "Common Bench puts everyone's trials on one map. His dead end. Her better region." | Cut to the real chart, replaying: the blue path walks down and crosses into ✕, and the "dead end" bracket appears. The violet path approaches from above. T09 sits ✓, excluded. *Question 1 lights up.* |
| 5 | 0:38–0:46 | "It lines up two runs step by step and flags what differed by accident. She degasses. He never did." | The Protocol Diff. Intended rows dim; one amber row, "Degas: 10 min vs. none", stays lit. The T09 callout reads "18 h rest, passed." *Question 2 lights up.* |
| 6 | 0:46–0:54 | "Then it proposes the next experiment, with a control, and nothing to order. A person approves every change." | The approval card for T15a/T15b. A cursor clicks Approve. Dashed estimates drop onto the chart: T15a clears the floor, T15b (the control) doesn't. *Question 3 lights up.* |
| 7 | 0:54–1:00 | "Less time reprogramming mixers. More time interpreting results." | Back to paper: the three questions, all lit. Then **Common Bench · labworkers.app**. |

Rules carried over from MHS: no captions on screen except the three questions and device names; one idea per sentence; the picture makes the argument.

## Translating it into the app

The app shows everything at once today. Onboarding should **build the screen up in the order of the argument**:

- **First run:** the paper intro (beats 1–3) plays full-screen, about 30 s, and can be skipped. It ends by dissolving into the app with **only the chart visible**.
- **Step 1, "What have we tried?":** the chart and Replay. Everything else is hidden. Next reveals the scorecard under it.
- **Step 2, "Why were results different?":** Ask streams, and the Protocol Diff opens inline with only the amber row lit.
- **Step 3, "What do we try next?":** the approval cards. Approving reveals the full app.
- **Make the questions permanent:** use them as panel headings (chart = "What have we tried", diff = "Why did results differ", Ask/approvals = "What next"). A returning user then still sees the argument.
- **Keep it reusable:** the existing `tour.ts` becomes these three steps (plus evals as an optional fourth). The paper intro is a single SVG component (`<Intro />`, route `/intro`). Recording `/intro` plus a scripted tour at 4K produces the video, so there's one source for both.

## Open choices

- **Voiceover:** Cooper's voice, or text-only (MHS clip style)? The script works either way; with text only, the questions carry it.
- **Example:** the resin story stays. For onboarding, the only change is that it's told in three steps instead of six.
