// Dev-only: renders every instrument at several playback moments to static HTML (no browser state), proving
// the figures are pure functions that can be exported in parallel. Run: npx tsx src/figures/bench/gallery.render.tsx out.html [T14]
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import nb from "../../../data/notebook.json" with { type: "json" };
import type { Notebook, StepId } from "../../shared/types.ts";
import { InstrumentFigure } from "./InstrumentFigure.tsx";
import { playbackOf, runsOf, stationAt } from "./timeline.ts";
import { DogboneFigure } from "../DogboneFigure.tsx";
import { BendFigure, peakDeflection } from "../BendFigure.tsx";
import { CouponCT } from "../CouponFigure.tsx";

const data = nb as unknown as Notebook;
const [out = "gallery.html", id = "T14"] = process.argv.slice(2);
const trial = data.trials.find((t) => t.id === id)!;
const runs = runsOf(trial);
const pb = playbackOf(runs);
const steps: StepId[] = ["weigh", "mix", "degas", "viscosity", "print", "postcure", "test"];
const frames: string[] = [];
for (const step of steps) {
  const mine = runs.filter((r) => r.step === step);
  const moments = mine.length ? [mine[0].start - 60_000, (mine[0].start + mine[0].end) / 2, mine[mine.length - 1].end] : [pb.start];
  if (step === "test") moments.splice(2, 0, (runs.find((r) => r.mode === "bend")!.start + runs.find((r) => r.mode === "bend")!.end) / 2);
  const cells = moments.map((c, i) => {
    const s = stationAt(trial, runs, step, c);
    return `<div class="cell">${renderToStaticMarkup(<InstrumentFigure step={step} state={s} t={i * 0.37 + 0.2} width={240} height={200} optional={step === "degas"} />)}<div>${step} · ${s.status} · ${s.readout ?? ""}</div></div>`;
  });
  frames.push(`<div class="rowg">${cells.join("")}</div>`);
}
for (const sid of ["T08", "T09", "T13", "T02"]) {
  const tr = data.trials.find((t) => t.id === sid)!;
  const e = tr.outputs.elongation_pct, pk = peakDeflection(tr);
  frames.push(`<h4>${sid} · ${tr.outputs.fracture} · ${tr.outputs.porosity_pct}%</h4><div class="rowg">` +
    [0, 0.8, 1].map((f) => `<div class="cell">${renderToStaticMarkup(<DogboneFigure trial={tr} strain={e * f} />)}</div>`).join("") + `</div><div class="rowg">` +
    [0, 0.8, 1].map((f) => `<div class="cell">${renderToStaticMarkup(<BendFigure trial={tr} deflection={pk * f} />)}</div>`).join("") + `</div><div class="rowg">` +
    [7.2, 5.5, 4].map((sl) => `<div class="cell">${renderToStaticMarkup(<CouponCT trial={tr} slice={sl} width={225} height={150} />)}</div>`).join("") + `</div>`);
}
const css = readFileSync(new URL("../figures.css", import.meta.url), "utf8");
writeFileSync(out, `<!doctype html><meta charset=utf-8><style>:root{--ink:#1b1a17;--ink-3:#6f6a60}body{background:#f3f1ec;font:12px system-ui;margin:12px}${css}.rowg{display:flex;gap:8px;margin-bottom:6px}.cell{background:#fff;border:1px solid #e4e0d7;border-radius:8px;padding:4px}</style><h3>${id}</h3>${frames.join("")}`);
console.log("wrote", out);
