# Figures: handoff for the Anatomy pass

These are basic SVG placeholders. Each one is a pure function of one trial's data, so a replacement can be generated per sample, in parallel, and update automatically when the data changes. Keep the props. Swap the drawing.

| Component | Props | Driven by (per trial, from `data/notebook.json`) | Shown in |
|---|---|---|---|
| `BenchFigure` | `stations[]`, `activeStation`, `trial?`, `onSelectStation?` | `project.sop.stations` (device, `in_sop`); `trial.log[].step` (steps never run are greyed) | Process row; trial drawer "Process" |
| `DogboneFigure` | `trial`, `strain`, `width?`, `height?` | `outputs.elongation_pct`, `outputs.fracture` (ductile necks, brittle snaps), `curve` [strain %, MPa] | Drawer "Specimens" (slider drives `strain`) |
| `BendFigure` | `trial`, `deflection`, `width?`, `height?` | `flex_curve` [mm, N], `outputs.fracture`; `peakDeflection(trial)` | Drawer "Specimens" (slider drives `deflection`) |
| `CouponFigure` | `trial`, `size?` | `pores[]` `{x, y, r}`: normalized cross-section, area fraction = `outputs.porosity_pct` | Drawer "Specimens" |

## Ideas Cooper raised (for the Anatomy session)

- **A visual SOP:** clicking a process step or a test opens its figure, so the process reads like an illustrated protocol.
- **A CT-style porosity animation:** sweep slices through the specimen and show `pores[]` as voids. High-diluent, undegassed trials (T06–T10) show 2.4–5.2% voids; T09 and Greeshma's degassed trials show almost none.
  - For a 3-D look, seed the z positions from the same per-trial seed so every view of a trial is consistent.
- **Parametric everywhere:** never hand-tune a figure for one trial. Everything comes from the trial object, so T15a/T15b estimates can render too (`estimateRecipe()` in `src/shared/surrogate.ts` gives `porosity_pct`; pores for drafts can be sampled the same way the generator does).

## Data notes

- `data/generate.ts` writes the figure data: `tensileCurve`, `flexCurve`, `pores`. If a figure needs more per-trial data (pore z-depth, crack path), add it there so it stays seeded and verified.
- Person colors: Cooper `#2a78d6`, Greeshma `#6250d6`. Status colors: `#0ca30c` ✓ / `#d99a00` ○ / `#d03b3b` ✕. Never use status colors for people.
