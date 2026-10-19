# High-fidelity design brief: Common Bench

Hand-off for the agent doing the high-fidelity design pass. Read this, then `../CLAUDE.md`, `NAVIGATION_DESIGN.md` and `ISSUES_DRAFT.md`.

## What Cooper asked for

- `mockups/navigation.html` and the current React app (`app/`) are the **spec only**: layout, navigation, features. They are **not the design**, and Cooper called the look "pretty bad". Do not reuse their visual vocabulary: paper background, pill chips, dashed boxes, eyebrow labels everywhere, flat colored rectangles for instruments.
- **Design fresh, in the design tools, before code.** Cooper approves the screens first; the app is rebuilt to match afterwards.
- Cooper chose: **a fresh direction** (not the published Common Bench design system) and **four key screens** in the first round.

## The canvas (already created, empty)

- Design canvas: https://claude.ai/artifact/QHXUAmy4VsxdYkDpuS3Uve ("Common Bench screens"). Fill it per its type's `SKILL.md`: `project/canvas.json` first, then one `.dc.html` per artboard. Read `artifact-type/reference/format.md` and `craft.md` on it. Work in a scratchpad folder.
- Artboards are PAGEs: `expand: "fill"`, w 1440.

## The four screens (spec)

1. **Home.** Your projects (cards: title and people only, your avatar emphasized), then research thrusts, each with its projects as rows. Closed thrusts hidden. Top bar: brand, a big **Projects | Lab** toggle with a round search button beside it, and an avatar menu (admin tools: import lab scan, add instrument, connect instruments, device files; Evals).
2. **Project page** (Fast-print denture base resin). Goal ("Viscosity ≤ 1.5 Pa·s, every guardrail passing"), deliverable ("Formulation spec and a manuscript"), *What we know* / *Open questions* (from the ledger), an experiments grid with a **New experiment** card first. Right panel: why, people, documents, "Send to report" (future), and a scoped Ask box.
3. **Experiment with a trial open** (High-diluent formulations, T09 selected). Main: the trade-off chart (viscosity ← lower is better × tensile ↑ higher is better, goal corner, this experiment's trials solid, the project's others faded, Cooper's "dead end" region), and the trials table. Right panel: T09's numbers (1.28 Pa·s, 44 MPa, 0.4% porosity, goal met), Cooper's quote ("Anomalous, likely a lucky specimen; excluded."), **How it ran**: the 7 SOP steps drawn with the real Anatomy instrument figures, the print step's 18 h rest marked as differing from the SOP. One step is open, showing its log lines and where the instrument is in the room. Then the scoped Ask.
4. **Lab** (Room 214): an isometric **digital twin** built from the Anatomy instruments on benches, with a floor-plan toggle. It shows how each instrument is logged (logs itself / by hand / not logged) and who is using it now (a ring in the person's color). Right panel: the selected instrument (Vacuum degasser: logged by hand, no calibration record, recent trials T11–T14, all Greeshma's, because Cooper never degassed), Book (future), and Ask.

All data is in `app/data/notebook.json` (`org`, `lab`, `trials`, `ledger`). Use real values, never invented ones.

## Visual direction (proposed; commit to it and state it)

**"Technical atlas."** The Anatomy figures are the visual DNA: hairline isometric engineering drawings in warm white, with resin cream (#ece2c8) and UV cyan (#6fd0df). See `shots-figures/gallery-all-instruments-and-specimens.png`.

- **Ground:** near-white, toned slightly warm.
- **Type:** ink, hairline rules (not boxes), generous whitespace.
- **Figures are heroes:** big, not thumbnails.
- **Typefaces:** one precise sans plus one mono for data (Google Fonts; not Inter, Roboto, Arial or Space Grotesk). The app must work offline later, so pick faces that can be bundled.
- **Fixed colors (project rules):**
  - People: Cooper #2a78d6, Greeshma #6250d6, used only for people.
  - Status: ✓ #0ca30c, ○ #d99a00, ✕ #d03b3b, used only for results.
- **Text budgets:** titles ≤ 8 words, labels ≤ 3, one sentence per panel. Navigation screens show a title and people only.
- **"Unusual"** (an SOP deviation) is drawn, not colored. Find a better treatment than a dashed box.
- **Not built yet:** shown with a quiet marker, never disabled.
- Only two people exist (Cooper, Greeshma). The company is fictional (Meridian Dental Materials). Show a visible "Synthetic data" label.

## Anatomy figures: generate real SVGs (don't redraw them)

- **Source:** `app/src/figures/bench/instruments.tsx` (one model per step: weigh, mix, degas, viscosity, print, postcure, test), rendered by `InstrumentFigure.tsx`. State comes from `timeline.ts` (`stationAt(trial, runsOf(trial), step, clock)`). Specimens are in `DogboneFigure`, `BendFigure` and `CouponFigure`. The styles are the `.iso` rules in `app/src/figures/figures.css`.
- **Render:** write a small `tsx` script (in the scratchpad, run against `app/node_modules`) that renders each instrument with `react-dom/server` `renderToStaticMarkup`, in the idle and done states for T09 and T14, at about 240×240. Save them as SVG strings.
- **Embed:** put each SVG inline in the artboards, with the needed `.iso` CSS in the artboard's `<helmet><style>`. That keeps the drawings exact and editable. The Lab twin places the same figures on isometric benches.

## Then

1. Show Cooper the canvas link, with one line on the direction and assumptions.
2. After approval: rewrite the design system (https://claude.ai/artifact/Y8Ka2pi29Yg11DYm5mUVLE) from the approved screens, update `app/src/ds/tokens.json`, and rebuild `app/` screens to match. The current app's routing, store, selection model, agent and approvals work and stay; only the presentation is replaced.
3. Don't commit unless Cooper asks.
