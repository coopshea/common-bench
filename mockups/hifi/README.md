# High-fidelity screens ("technical atlas")

The four screens Cooper approved on 2026-10-18, published as the Design canvas
[Common Bench screens](https://claude.ai/artifact/QHXUAmy4VsxdYkDpuS3Uve). The app in `../../app` was rebuilt from them.

- `render-figures.mts` renders the app's real Anatomy figures (instruments, specimens, lab twin, chart) to SVG.
- `canvas/src/` holds the hand-written artboard templates and `_base.css`.
- `canvas/assemble.py` pastes the SVGs and shared parts into the templates; `canvas/project/` is what was published.

Regenerate (figures-out/ is ignored by git):

```
cd ../../app && npx tsx ../mockups/hifi/render-figures.mts ../mockups/hifi/figures-out
python3 ../mockups/hifi/canvas/assemble.py
```

The canvas is a design reference and no longer tracks the app: the app moved Ask to the top of each panel,
simplified the New experiment card, and drew fixtures as outlines (see `../../CLAUDE.md`).
