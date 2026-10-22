// Renders the app's real Anatomy figures (instruments + specimens) to standalone SVG strings.
// No JSX here, so React resolves from the app's node_modules (one React instance with the figure modules).
// Run from the app folder so tsx picks up its tsconfig (jsx: react-jsx):
//   cd <repo>/02-resin-doe-lab-notebook/app && npx tsx <this file> [outDir]
// Output: <outDir>/svg/<name>.svg, <outDir>/figures.json ({name: svg}), <outDir>/iso.css (the .iso rules).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(process.env.APP_DIR ?? process.cwd());
const req = createRequire(join(APP, "package.json"));
const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");
const imp = (p: string) => import(join(APP, p));

const outDir = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "figures-out"));
mkdirSync(join(outDir, "svg"), { recursive: true });

const nb = JSON.parse(readFileSync(join(APP, "data/notebook.json"), "utf8"));
const { InstrumentFigure } = await imp("src/figures/bench/InstrumentFigure.tsx");
const { runsOf, stationAt, playbackOf } = await imp("src/figures/bench/timeline.ts");
const { DogboneFigure } = await imp("src/figures/DogboneFigure.tsx");
const { BendFigure, peakDeflection } = await imp("src/figures/BendFigure.tsx");
const { CouponCT, CouponFigure } = await imp("src/figures/CouponFigure.tsx");

const STEPS = ["weigh", "mix", "degas", "viscosity", "print", "postcure", "test"] as const;
const W = Number(process.env.FIG_W ?? 240), H = Number(process.env.FIG_H ?? 220);
const out: Record<string, string> = {};

// Prefix ids so many inline SVGs can share one page.
const scope = (svg: string, p: string) =>
  svg.replace(/\bid="([^"]+)"/g, `id="${p}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}-$1)`).replace(/href="#([^"]+)"/g, `href="#${p}-$1"`);
const put = (name: string, el: unknown) => {
  let svg = scope(renderToStaticMarkup(el), name);
  // Specimen figures size themselves with width/height only; add a viewBox so they scale when embedded.
  if (!/^<svg[^>]*viewBox/.test(svg)) svg = svg.replace(/^<svg([^>]*?) width="([\d.]+)" height="([\d.]+)"/, '<svg$1 width="$2" height="$3" viewBox="0 0 $2 $3"');
  out[name] = svg;
  writeFileSync(join(outDir, "svg", `${name}.svg`), svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
};

for (const id of ["T09", "T14"]) {
  const trial = nb.trials.find((t: { id: string }) => t.id === id);
  const runs = runsOf(trial);
  const pb = playbackOf(runs);
  for (const step of STEPS) {
    const mine = runs.filter((r: { step: string }) => r.step === step);
    const moments: Record<string, number> = { idle: pb.start - 60_000, done: pb.end + 60_000 };
    if (mine.length) moments.running = (mine[0].start + mine[0].end) / 2;
    for (const [state, clock] of Object.entries(moments)) {
      const s = stationAt(trial, runs, step, clock);
      // A step the trial never ran (T09 never degassed) has status "skipped": drawn as the ghost.
      put(`${id}-${step}-${state}`, React.createElement(InstrumentFigure, { step, state: s, t: 0.6, width: W, height: H, optional: step === "degas" }));
    }
  }
  // Specimens: unloaded and at break.
  const e = trial.outputs.elongation_pct, pk = peakDeflection(trial);
  put(`${id}-dogbone-rest`, React.createElement(DogboneFigure, { trial, strain: 0, width: 300, height: 110 }));
  put(`${id}-dogbone-break`, React.createElement(DogboneFigure, { trial, strain: e, width: 300, height: 110 }));
  put(`${id}-bend-rest`, React.createElement(BendFigure, { trial, deflection: 0, width: 300, height: 110 }));
  put(`${id}-bend-break`, React.createElement(BendFigure, { trial, deflection: pk, width: 300, height: 110 }));
  put(`${id}-coupon-ct`, React.createElement(CouponCT, { trial, slice: 5.5, width: 225, height: 150 }));
  put(`${id}-coupon`, React.createElement(CouponFigure, { trial, size: 150 }));
}

// Lab twin: every SOP instrument in its plain idle pose, not dashed, small (one per bench slot).
{
  const trial = nb.trials.find((t: { id: string }) => t.id === "T14");
  const runs = runsOf(trial);
  const pb = playbackOf(runs);
  for (const step of STEPS) {
    const s = stationAt(trial, runs, step, pb.start - 60_000);
    put(`lab-${step}`, React.createElement(InstrumentFigure, { step, state: s, t: 0.6, width: 150, height: 140 }));
  }
}

// ---------- Lab panel: the degasser alone, plain (the panel is about the device, not a trial) ----------
const T14 = nb.trials.find((t: { id: string }) => t.id === "T14");
const R14 = runsOf(T14);
const PB14 = playbackOf(R14);
const at14 = (step: string, when: "idle" | "running" | "done") => {
  const mine = R14.filter((r: { step: string }) => r.step === step);
  const clock = when === "idle" ? PB14.start - 60_000 : when === "done" ? PB14.end + 60_000 : (mine[0].start + mine[0].end) / 2;
  return stationAt(T14, R14, step, clock);
};
put("panel-degas", React.createElement(InstrumentFigure, { step: "degas", state: at14("degas", "done"), t: 0.6, width: 300, height: 260 }));
put("panel-print", React.createElement(InstrumentFigure, { step: "print", state: stationAt(nb.trials.find((t: { id: string }) => t.id === "T09"), runsOf(nb.trials.find((t: { id: string }) => t.id === "T09")), "print", Infinity), t: 0.6, width: 300, height: 260 }));

// ---------- Lab twin: the room's benches (kit slabs) with every instrument model placed at its plan position ----------
{
  const { INSTRUMENTS } = await imp("src/figures/bench/instruments.tsx");
  const { Solid, box, cyl, disc, Line, seg } = await imp("src/figures/anatomy/draw.tsx");
  const { fitProjection, iso } = await imp("src/figures/anatomy/iso-kit.ts");
  const h = React.createElement;
  const lab = nb.lab;
  const U = 0.1; // world units per plan unit (plan is cm-ish; world matches the instrument models)
  const TW = 1000, TH = 640, BENCH = 9;
  const room: [number, number, number][] = [];
  for (const x of [0, lab.width * U]) for (const y of [0, lab.depth * U]) for (const z of [0, 17]) room.push([x, y, z]);
  const pR = fitProjection(room, TW, TH, { pad: 56 });
  const MODEL: Record<string, string> = { balance: "weigh", mixer: "mix", degasser: "degas", viscometer: "viscosity", "printer-1": "print", "printer-2": "print", "uv-oven": "postcure", "test-frame": "test" };
  const TOP: Record<string, number> = { weigh: 6.6, mix: 8, degas: 8.9, viscosity: 11.8, print: 14.2, postcure: 8.6, test: 14.6 };
  type Rect = { name?: string; id?: string; x: number; y: number; w: number; h: number; z?: number; in_use?: { by: string } ; source?: string };
  const surfaces: (Rect & { kind: "bench" | "fixture" })[] = [
    ...lab.benches.map((b: Rect) => ({ ...b, kind: "bench" as const })),
    ...lab.fixtures.map((f: Rect) => ({ ...f, kind: "fixture" as const })),
  ];
  const inside = (i: Rect, s: Rect) => i.x + i.w / 2 >= s.x && i.x + i.w / 2 <= s.x + s.w && i.y + i.h / 2 >= s.y && i.y + i.h / 2 <= s.y + s.h;
  const near = (r: Rect) => r.x + r.w + r.y + r.h;
  const color = (pid: string) => nb.people.find((q: { id: string }) => q.id === pid)?.color ?? "#000";
  const balloons: { n: number; id: string; x: number; y: number; ax: number; ay: number; front: boolean; source: string }[] = [];
  const order = lab.instruments.map((i: Rect) => i.id);
  const kids: unknown[] = [];

  // floor slab + a faint 1 m grid
  kids.push(h(Solid, { key: "floor", paths: box(0, 0, lab.width * U, lab.depth * U, -0.6, 0.6, pR, 0), tone: "mid", crease: "none", className: "floor" }));
  for (let x = 10; x < lab.width * U; x += 10) kids.push(h(Line, { key: `gx${x}`, d: seg([x, 0, 0], [x, lab.depth * U, 0], pR), tone: "faint" }));
  for (let y = 10; y < lab.depth * U; y += 10) kids.push(h(Line, { key: `gy${y}`, d: seg([0, y, 0], [lab.width * U, y, 0], pR), tone: "faint" }));

  for (const s of [...surfaces].sort((a, b) => near(a) - near(b))) {
    const sh = s.kind === "bench" ? BENCH : (s.z ?? 90) * U;
    kids.push(h(Solid, { key: s.name, paths: box(s.x * U, s.y * U, s.w * U, s.h * U, 0, sh, pR, 0.2), tone: "mid", className: `surface ${s.kind}` }));
    if (s.name === "Sink") kids.push(h(Line, { key: "sinkbowl", d: disc((s.x + s.w / 2) * U, (s.y + s.h / 2) * U, 2, sh + 0.01, pR), tone: "mid" }));
    const mine = lab.instruments.filter((i: Rect) => inside(i, s)).sort((a: Rect, b: Rect) => near(a) - near(b));
    for (const inst of mine) {
      const cx = (inst.x + inst.w / 2) * U, cy = (inst.y + inst.h / 2) * U;
      if (inst.in_use) {
        kids.push(h("path", { key: `ring-${inst.id}`, className: "twin-ring", d: disc(cx, cy, (Math.max(inst.w, inst.h) * U) / 2 + 1, sh + 0.02, pR, 48), fill: "none", stroke: color(inst.in_use.by), strokeWidth: 2.4 }));
      }
      const step = MODEL[inst.id];
      let top: number;
      if (step) {
        const k = (Math.min(inst.w, inst.h) * U) / 9;
        const p = { ...pR, origin: iso([cx - 6 * k, cy - 6 * k, sh], pR), scale: pR.scale * k };
        const state = at14(step, inst.in_use ? "running" : "idle");
        kids.push(h("g", { key: inst.id, className: `twin-inst`, "data-id": inst.id }, h(INSTRUMENTS[step], { s: state, t: 0.6, p })));
        top = sh + TOP[step] * k;
      } else {
        // No Anatomy model for this device yet: a plain kit block at its footprint and logged height.
        const hh = Math.max(1.2, (inst.z ?? 30) * U);
        const g = [h(Solid, { key: "b", paths: box(inst.x * U, inst.y * U, inst.w * U, inst.h * U, sh, hh, pR, 0.3) })];
        if (inst.id === "hot-plate") g.push(h(Line, { key: "d", d: disc(cx, cy, Math.min(inst.w, inst.h) * U * 0.32, sh + hh + 0.01, pR), tone: "mid" }));
        if (inst.id === "imaging") g.push(h(Solid, { key: "c", paths: cyl(cx, cy, 1.1, sh + hh, 2.2, pR), tone: "hi" }));
        kids.push(h("g", { key: inst.id, className: "twin-inst generic", "data-id": inst.id }, ...g));
        top = sh + hh + (inst.id === "imaging" ? 2.2 : 0);
      }
      const [ax, ay] = iso([cx, cy, top], pR);
      balloons.push({ n: order.indexOf(inst.id) + 1, id: inst.id, x: ax, y: ay, ax, ay, front: inst.y > lab.depth / 2, source: inst.source ?? "none" });
    }
  }
  // Bench names, on the floor in front of each bench.
  const benchLabels = lab.benches.map((b: Rect) => {
    const [x, y] = iso([b.x * U, (b.y + b.h) * U + 2.2, 0], pR);
    return `<text class="tw-bench" x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(26.57 ${x.toFixed(1)} ${y.toFixed(1)})" dy="10">${b.name}</text>`;
  }).join("");
  // Numbered balloons with leaders: back row lifted to one band, front row lifted a fixed amount.
  const backBand = Math.min(...balloons.filter((b) => !b.front).map((b) => b.ay)) - 34;
  const mark = (src: string, x: number, y: number) => {
    const s = 7, X = (x + 15).toFixed(1), Y = (y - s / 2).toFixed(1);
    if (src === "manual") return `<rect class="tw-log" x="${X}" y="${Y}" width="${s}" height="${s}"/><path class="tw-log-fill" d="M${X} ${Y}h${s / 2}v${s}h-${s / 2}z"/>`;
    if (src === "none") return `<rect class="tw-log" x="${X}" y="${Y}" width="${s}" height="${s}"/>`;
    return `<rect class="tw-log tw-log-fill" x="${X}" y="${Y}" width="${s}" height="${s}"/>`;
  };
  const balloonSvg = balloons.map((b) => {
    const by = b.front ? b.ay - 46 : backBand;
    const sel = b.id === "degasser";
    return `<g class="tw-balloon${sel ? " sel" : ""}"><path class="tw-leader" d="M${b.ax.toFixed(1)} ${b.ay.toFixed(1)}V${(by + 11).toFixed(1)}"/><circle cx="${b.ax.toFixed(1)}" cy="${by.toFixed(1)}" r="11"/><text x="${b.ax.toFixed(1)}" y="${by.toFixed(1)}" dy="4">${b.n}</text>${mark(b.source, b.ax, by)}</g>`;
  }).join("");
  const scene = renderToStaticMarkup(h("g", null, ...kids));
  const svg = `<svg class="iso twin" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}" role="img" aria-label="Room 214, isometric">${scene}${benchLabels}${balloonSvg}</svg>`;
  out["lab-twin"] = scope(svg, "lab-twin");
  writeFileSync(join(outDir, "svg", "lab-twin.svg"), out["lab-twin"].replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
}

// ---------- Trade-off chart (plain SVG from the trials; not an Anatomy figure) ----------
{
  const people: Record<string, string> = Object.fromEntries(nb.people.map((q: { id: string; color: string }) => [q.id, q.color]));
  const camp2exp: Record<string, string> = { A: "A", B: "B", G: "G" };
  const chart = (focus: string, W: number, H: number, mini: boolean, selected?: string) => {
    const m = mini ? { l: 6, r: 6, t: 6, b: 6 } : { l: 58, r: 20, t: 34, b: 58 };
    const X0 = 1.0, X1 = 2.8, Y0 = 26, Y1 = 56;
    const sx = (v: number) => m.l + ((v - X0) / (X1 - X0)) * (W - m.l - m.r);
    const sy = (v: number) => H - m.b - ((v - Y0) / (Y1 - Y0)) * (H - m.t - m.b);
    const f = (n: number) => n.toFixed(1);
    const parts: string[] = [];
    // goal corner: viscosity ≤ 1.5 and tensile ≥ 40
    parts.push(`<rect class="ch-goal" x="${f(sx(X0))}" y="${f(sy(Y1))}" width="${f(sx(1.5) - sx(X0))}" height="${f(sy(40) - sy(Y1))}"/>`);
    if (!mini) {
      for (const v of [1.0, 1.5, 2.0, 2.5]) parts.push(`<path class="ch-grid" d="M${f(sx(v))} ${f(sy(Y0))}V${f(sy(Y1))}"/><text class="ch-tick" x="${f(sx(v))}" y="${f(sy(Y0) + 18)}" text-anchor="middle">${v.toFixed(1)}</text>`);
      for (const v of [30, 40, 50]) parts.push(`<path class="ch-grid" d="M${f(sx(X0))} ${f(sy(v))}H${f(sx(X1))}"/><text class="ch-tick" x="${f(sx(X0) - 10)}" y="${f(sy(v) + 4)}" text-anchor="end">${v}</text>`);
      parts.push(`<path class="ch-axis" d="M${f(sx(X0))} ${f(sy(Y1))}V${f(sy(Y0))}H${f(sx(X1))}"/>`);
      parts.push(`<text class="ch-goal-label" x="${f(sx(X0) + 10)}" y="${f(sy(Y1) + 20)}">Goal</text>`);
      parts.push(`<text class="ch-title" x="${f(sx(X0))}" y="${f(sy(Y0) + 44)}">← Viscosity, Pa·s · lower is better</text>`);
      parts.push(`<text class="ch-title" x="${f(sx(X0) - 44)}" y="${f(m.t - 16)}">↑ Tensile, MPa · higher is better</text>`);
    }
    parts.push(`<path class="ch-thresh" d="M${f(sx(1.5))} ${f(sy(Y0))}V${f(sy(Y1))}M${f(sx(X0))} ${f(sy(40))}H${f(sx(X1))}"/>`);
    // Cooper's dead-end call (ledger L2): the region his included high-diluent trials occupied, hatched
    const dead = nb.ledger.find((l: { id: string }) => l.id === "L2");
    if (dead && (focus === "B" || !mini)) {
      const ev = nb.trials.filter((t: { id: string }) => dead.evidence.includes(t.id));
      const vx = ev.map((t: { outputs: { viscosity_pa_s: number } }) => t.outputs.viscosity_pa_s), vy = ev.map((t: { outputs: { uts_mpa: number } }) => t.outputs.uts_mpa);
      const x0 = sx(Math.min(...vx) - 0.07), x1 = sx(Math.max(...vx) + 0.07), y0 = sy(Math.max(...vy) + 1.6), y1 = sy(Math.min(...vy) - 1.6);
      parts.push(`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" class="ch-hatch"/></pattern></defs>`);
      parts.push(`<rect class="ch-dead" x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" fill="url(#hatch)"/>`);
      if (!mini) parts.push(`<text class="ch-dead-label" x="${f(x1 + 10)}" y="${f(y1 - 6)}">Dead end, Cooper 2025</text>`);
    }
    const trials = [...nb.trials].sort((a: { campaign: string }, b: { campaign: string }) => (a.campaign === focus ? 1 : 0) - (b.campaign === focus ? 1 : 0));
    for (const t of trials) {
      const x = sx(t.outputs.viscosity_pa_s), y = sy(t.outputs.uts_mpa);
      const c = people[t.owners[0]];
      const on = camp2exp[t.campaign] === focus;
      const r = mini ? (on ? 3.6 : 2.6) : on ? 6 : 4.5;
      if (t.excluded) parts.push(`<circle class="ch-pt excluded${on ? "" : " faded"}" cx="${f(x)}" cy="${f(y)}" r="${r - 0.8}" stroke="${c}" />`);
      else parts.push(`<circle class="ch-pt${on ? "" : " faded"}" cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${c}"/>`);
      if (!mini && on) parts.push(`<text class="ch-id" x="${f(x + 10)}" y="${f(y + 4)}">${t.id}</text>`);
      if (!mini && t.id === selected) {
        parts.push(`<circle class="ch-sel" cx="${f(x)}" cy="${f(y)}" r="13"/>`);
        // drawn "unusual" mark: a revision delta on a leader
        const dx = x - 46, dy = y - 40;
        parts.push(`<path class="ch-leader" d="M${f(x - 9)} ${f(y - 9)}L${f(dx + 6)} ${f(dy + 8)}"/><path class="delta" d="M${f(dx)} ${f(dy - 8)}L${f(dx + 9)} ${f(dy + 7)}H${f(dx - 9)}Z"/>`);
      }
    }
    return `<svg class="chart${mini ? " mini" : ""}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${mini ? `Experiment ${focus} trials` : "Viscosity against tensile strength"}">${parts.join("")}</svg>`;
  };
  out["chart-B"] = scope(chart("B", 860, 440, false, "T09"), "chart-B");
  for (const e of ["A", "B", "G"]) out[`mini-${e}`] = scope(chart(e, 300, 150, true), `mini-${e}`);
  for (const k of ["chart-B", "mini-A", "mini-B", "mini-G"]) writeFileSync(join(outDir, "svg", `${k}.svg`), out[k].replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
}

// ---------- Mini floor plan: where the selected step's instrument is in the room ----------
{
  const lab = nb.lab, W = 300, s = W / lab.width, H = Math.round(lab.depth * s);
  const r = (o: { x: number; y: number; w: number; h: number }, cls: string) =>
    `<rect class="${cls}" x="${(o.x * s).toFixed(1)}" y="${(o.y * s).toFixed(1)}" width="${(o.w * s).toFixed(1)}" height="${(o.h * s).toFixed(1)}"/>`;
  for (const hi of ["printer-1", "degasser"]) {
    const body = [`<rect class="pl-room" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}"/>`, ...lab.benches.map((b: never) => r(b, "pl-bench")), ...lab.fixtures.map((b: never) => r(b, "pl-fixture")),
      ...lab.instruments.map((i: { id: string } & never) => r(i, i.id === hi ? "pl-inst hi" : "pl-inst"))].join("");
    out[`plan-${hi}`] = `<svg class="plan" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Floor plan, Room 214">${body}</svg>`;
  }
}

writeFileSync(join(outDir, "figures.json"), JSON.stringify(out));
// The .iso rules only (bench/zoom layout rules depend on app tokens and are left out).
const css = readFileSync(join(APP, "src/figures/figures.css"), "utf8");
const isoOnly = css.split("}").filter((r) => /^\s*(\/\*[^]*?\*\/\s*)?\.iso\b/.test(r)).map((r) => r.trim() + "}").join("\n");
writeFileSync(join(outDir, "iso.css"), isoOnly);
console.log(`wrote ${Object.keys(out).length} SVGs to ${outDir}`);
