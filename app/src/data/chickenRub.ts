// Kitchen-scale SOPs for trying the glasses. Whichever ingredient is weighed first sets the batch, so a heavy
// first pour raises every amount after it by the same share.
// Not part of the seeded notebook: each is added to a browser's own SOPs from /api/glasses/import/<id>.
import type { BenchField, BenchProtocol, BenchStep } from "../shared/types.ts";

const weigh = (id: string, label: string, title: string, detail: string[]): BenchStep => {
  const field: BenchField = { id, label, unit: "g", formula: `batch_g * ${id}_pct / 100`, scales: true };
  return { id, station: "weigh", instrument: "balance", title, detail, fields: [field], get: [], put: [] };
};

/**
 * Rub for one pound of chicken: about 10 g in all, with the salt at 1% of the chicken's weight. Needs a scale that
 * reads tenths of a gram. Whichever ingredient is weighed first sets the batch for the rest.
 */
export const rubForOnePound: BenchProtocol = {
  id: "rub-1lb-chicken",
  title: "Rub for 1 lb chicken",
  runner: "cooper",
  uploaded: "2026-11-15",
  last_run: null,
  next_run: "1",
  params: [
    { id: "batch_g", label: "Rub", value: 10, unit: "g" },
    { id: "salt_pct", label: "Salt", value: 45, unit: "%" },
    { id: "thyme_pct", label: "Thyme", value: 10, unit: "%" },
    { id: "garlic_pct", label: "Garlic powder", value: 15, unit: "%" },
    { id: "paprika_pct", label: "Smoked paprika", value: 30, unit: "%" },
  ],
  steps: [
    weigh("salt", "Salt", "Weigh the salt", ["Put a small bowl on the scale", "Tare", "Add the salt"]),
    weigh("thyme", "Thyme", "Add thyme", ["Tare", "Add the dried thyme"]),
    weigh("garlic", "Garlic powder", "Add garlic powder", ["Tare", "Add the garlic powder"]),
    weigh("paprika", "Smoked paprika", "Add smoked paprika", ["Tare", "Add the smoked paprika"]),
    { id: "mix", station: "mix", instrument: "mixer", title: "Mix", detail: ["Stir until the color is even", "Say “done” when it is"], fields: [], get: [], put: [] },
  ],
  script: [],
};

/** The first version: a full pound of rub. */
export const chickenRub: BenchProtocol = {
  id: "chicken-rub",
  title: "Chicken rub",
  runner: "cooper",
  uploaded: "2026-11-15",
  last_run: null,
  next_run: "1",
  params: [
    { id: "batch_g", label: "Batch", value: 453.6, unit: "g" }, // one pound
    { id: "salt_pct", label: "Salt", value: 40, unit: "%" },
    { id: "garlic_pct", label: "Garlic powder", value: 15, unit: "%" },
    { id: "paprika_pct", label: "Paprika", value: 25, unit: "%" },
    { id: "coriander_pct", label: "Coriander", value: 8, unit: "%" },
    { id: "pepper_pct", label: "Black pepper", value: 12, unit: "%" },
  ],
  steps: [
    weigh("salt", "Salt", "Weigh the salt", ["Put the bowl on the scale", "Tare", "Pour in the salt"]),
    weigh("garlic", "Garlic powder", "Add garlic powder", ["Tare", "Add the garlic powder"]),
    weigh("paprika", "Paprika", "Add paprika", ["Tare", "Add the paprika"]),
    weigh("coriander", "Coriander", "Add coriander", ["Tare", "Add the coriander"]),
    weigh("pepper", "Black pepper", "Add black pepper", ["Tare", "Add the black pepper"]),
    { id: "mix", station: "mix", instrument: "mixer", title: "Mix", detail: ["Whisk until the color is even", "Say “done” when it is"], fields: [], get: [], put: [] },
  ],
  script: [],
};

/**
 * Baking soda, vinegar and dish soap: the foam's height is the result. Everything follows the baking soda
 * (vinegar 15×, water 5×, soap 0.5×), so the first thing weighed rescales the rest.
 * 1 g of baking soda needs about 14 g of 5% vinegar to react completely; 15× leaves a little vinegar over.
 */
const mass = (id: string, label: string, formula: string, title: string, detail: string[], instrument = "balance"): BenchStep =>
  ({ id, station: "weigh", instrument, title, detail, fields: [{ id, label, unit: "g", formula, scales: true }], get: [], put: [] });
export const fizzFoam: BenchProtocol = {
  id: "fizz-foam",
  title: "Fizz foam test",
  runner: "cooper",
  uploaded: "2026-11-22",
  last_run: null,
  next_run: "1",
  params: [
    { id: "batch_g", label: "Baking soda", value: 4, unit: "g" },
    { id: "vinegar_x", label: "Vinegar per g soda", value: 15, unit: "g" },
    { id: "soap_x", label: "Soap per g soda", value: 0.5, unit: "g" },
    { id: "water_x", label: "Water per g soda", value: 5, unit: "g" },
  ],
  steps: [
    { ...mass("vinegar", "Vinegar", "batch_g * vinegar_x", "Weigh the vinegar", ["Put the tall glass on a plate on the scale", "Tare", "Pour in the vinegar"]), why: "The acid. At 5% acidity this is just enough to use up the baking soda." },
    { ...mass("soap", "Dish soap", "batch_g * soap_x", "Add dish soap", ["Tare", "Add the dish soap", "Swirl gently five times, no bubbles"]), why: "Soap traps the gas as foam. Without it the gas escapes and there is nothing to measure." },
    { ...mass("soda", "Baking soda", "batch_g", "Weigh the baking soda", ["Put the small cup on the scale", "Tare", "Add the baking soda"]), why: "The base. It sets how much gas can be made." },
    { ...mass("water", "Water", "batch_g * water_x", "Add water to the cup", ["Tare", "Add the water", "Stir until cloudy and even"]), why: "Wet soda reacts all at once. Dry powder fizzes slowly and unevenly." },
    { id: "pour", station: "mix", instrument: "mixer", title: "Pour and read the peak", detail: ["Pour the cup into the glass all at once", "Say the foam’s highest point in centimeters"],
      fields: [{ id: "peak_cm", label: "Peak foam", unit: "cm", formula: "0", result: true }], get: [], put: [], why: "The peak is how much of the gas the foam caught." },
    { id: "settle", station: "test", instrument: "imaging", title: "Wait, then read again", detail: ["Say “start” for the timer", "When it chimes, say the foam height in centimeters"], timer_min: 1,
      fields: [{ id: "after_cm", label: "Foam after 1 min", unit: "cm", formula: "0", result: true }], get: [], put: [], why: "How fast the foam drains shows how well the soap holds it." },
    { id: "photo", station: "test", instrument: "imaging", title: "Photo", detail: ["Say “photo”", "Say “note” and anything odd: overflow, a slow start, clumps"], fields: [], get: [], put: [], photo: true },
  ],
  script: [],
  about: {
    question: "How much foam does baking soda make in vinegar, and how long does it last?",
    equation: "NaHCO₃ + CH₃COOH → CO₂ + H₂O + CH₃COONa",
    measured: "Foam height at its peak, and one minute later",
  },
  // A kitchen scale reads whole grams: within 10% of the aim, or within a gram, before moving on.
  accept: { pct: 10, abs: 1 },
  // NaHCO3 84.01 g/mol, acetic acid 60.05 g/mol, a gas near room temperature 24 L/mol. Vinegar taken as 5% acid.
  calc: [
    { id: "co2_l", label: "CO₂ if all the soda reacts", unit: "L", formula: "soda / 84.01 * 24" },
    { id: "acid_x", label: "Acid for the soda", unit: "×", formula: "(vinegar * 0.05 / 60.05) / (soda / 84.01)", note: "1 is exactly enough, at 5% vinegar" },
  ],
};

/** The kitchen SOPs by id, for adding to a browser (/api/glasses/import/<id>) and for working through a recording again. */
/**
 * The whole experiment in one trial: three glasses that differ only in soap, from getting the kit out to the
 * comparison. Setup, then preparing each glass, then pouring, watching and reading each one. Nothing rescales:
 * every glass has its own aims.
 */
const amount = (id: string, title: string, label: string, formula: string, group: string, kind: string, detail: string[], why?: string): BenchStep =>
  ({ id, station: "weigh", instrument: "balance", title, detail, fields: [{ id, label, unit: "g", formula, group, kind }], get: [], put: [], phase: "Prepare", why });
const glass = (g: "A" | "B" | "C", soap: string): BenchStep[] => {
  const k = g.toLowerCase();
  return [
    { id: `pour_${k}`, station: "mix", instrument: "mixer", title: `Pour glass ${g}, read the peak`, detail: [`Tip cup ${g} into glass ${g} all at once`, "Say the foam’s highest point in centimeters"],
      fields: [{ id: `peak_${k}`, label: `Peak ${g}`, unit: "cm", formula: "0", result: true, group: g, kind: "Peak" }], get: [], put: [], phase: "Run", why: `Glass ${g}: ${soap}. The peak is how much of the gas the foam caught.` },
    { id: `wait_${k}`, station: "test", instrument: "imaging", title: `Glass ${g}: wait, read again`, detail: ["Say “start” for the timer", "When it chimes, say the foam height in centimeters"], timer_min: 1,
      fields: [{ id: `after_${k}`, label: `After 1 min ${g}`, unit: "cm", formula: "0", result: true, group: g, kind: "After 1 min" }], get: [], put: [], phase: "Run", why: "How much is left after a minute shows how well the foam holds." },
  ];
};
export const fizzSeries: BenchProtocol = {
  id: "fizz-series",
  title: "Does soap hold the foam?",
  runner: "cooper",
  uploaded: "2026-11-22",
  last_run: null,
  next_run: "1",
  params: [
    { id: "soda_g", label: "Baking soda per glass", value: 4, unit: "g" },
    { id: "vinegar_g", label: "Vinegar per glass", value: 60, unit: "g" },
    { id: "soap_b", label: "Soap, glass B", value: 2, unit: "g" },
    { id: "soap_c", label: "Soap, glass C", value: 4, unit: "g" },
  ],
  steps: [
    { id: "gather", station: "weigh", instrument: "balance", title: "Get everything out", phase: "Setup",
      detail: ["3 tall glasses and 3 small cups", "Vinegar, baking soda, dish soap", "Scale, ruler, spoon, a tray and a towel", "Say “done”"], fields: [], get: [], put: [],
      why: "Everything within reach first: once the pour starts there is no time to fetch." },
    { id: "layout", station: "weigh", instrument: "balance", title: "Label and lay out", phase: "Setup",
      detail: ["Label the glasses A, B, C and stand them on the tray", "Label the cups A, B, C", "Stand the ruler behind the glasses", "Say “done”"], fields: [], get: [], put: [],
      why: "Three glasses that differ only in soap: A none, B some, C double." },
    amount("vin_a", "Vinegar into glass A", "Vinegar A", "vinegar_g", "A", "Vinegar", ["Glass A on the scale, tare", "Pour in the vinegar"], "The acid. The same in every glass, so soap is the only thing that changes."),
    amount("vin_b", "Vinegar into glass B", "Vinegar B", "vinegar_g", "B", "Vinegar", ["Glass B on the scale, tare", "Pour in the vinegar"]),
    amount("vin_c", "Vinegar into glass C", "Vinegar C", "vinegar_g", "C", "Vinegar", ["Glass C on the scale, tare", "Pour in the vinegar"]),
    amount("soap_b_g", "Soap into glass B", "Soap B", "soap_b", "B", "Soap", ["Tare", "Add the soap", "Swirl gently five times, no bubbles"], "Soap traps the gas as foam. Glass A gets none."),
    amount("soap_c_g", "Soap into glass C", "Soap C", "soap_c", "C", "Soap", ["Tare", "Add the soap", "Swirl gently five times, no bubbles"], "Double the soap of glass B."),
    amount("soda_a", "Baking soda into cup A", "Soda A", "soda_g", "A", "Soda", ["Cup A on the scale, tare", "Add the baking soda"], "The base. It sets how much gas can be made, so it is the same in every cup."),
    amount("soda_b", "Baking soda into cup B", "Soda B", "soda_g", "B", "Soda", ["Cup B on the scale, tare", "Add the baking soda"]),
    amount("soda_c", "Baking soda into cup C", "Soda C", "soda_g", "C", "Soda", ["Cup C on the scale, tare", "Add the baking soda"]),
    ...glass("A", "no soap"), ...glass("B", "some soap"), ...glass("C", "double soap"),
    { id: "photo", station: "test", instrument: "imaging", title: "Photo of all three", phase: "Run", detail: ["Say “photo”", "Say “note” and anything odd: overflow, a slow start, clumps"], fields: [], get: [], put: [], photo: true },
  ],
  script: [],
  about: {
    question: "Does dish soap make baking soda and vinegar foam higher, and does it make the foam last?",
    equation: "NaHCO₃ + CH₃COOH → CO₂ + H₂O + CH₃COONa",
    measured: "Foam height in three glasses, at its peak and one minute later",
  },
  accept: { pct: 10, abs: 1 },
  calc: [
    ...(["a", "b", "c"] as const).map((k) => ({ id: `kept_${k}`, label: `Foam kept ${k.toUpperCase()}`, unit: "%", formula: `after_${k} / peak_${k} * 100`, group: k.toUpperCase(), kind: "Kept" })),
    { id: "co2_l", label: "CO₂ each glass can make", unit: "L", formula: "soda_a / 84.01 * 24", note: "from glass A's soda" },
  ],
};

/** The volcano as LabKit teaches it (Worldwide AI for Science/labkit): the same amounts, weighed, with what happened read off a ruler. */
const onScale = (id: string, title: string, label: string, formula: string, detail: string[], why: string): BenchStep =>
  ({ id, station: "weigh", instrument: "balance", title, detail, fields: [{ id, label, unit: "g", formula }], get: [], put: [], phase: "Prepare", why });
export const volcano: BenchProtocol = {
  id: "volcano",
  title: "Baking-soda volcano",
  runner: "cooper",
  uploaded: "2026-11-22",
  last_run: null,
  next_run: "1",
  params: [
    { id: "soda_g", label: "Baking soda", value: 28, unit: "g" },
    { id: "vinegar_g", label: "Vinegar, 5%", value: 120, unit: "g" },
    { id: "water_g", label: "Warm water", value: 60, unit: "g" },
    { id: "soap_g", label: "Dish soap", value: 15, unit: "g" },
  ],
  steps: [
    { id: "gather", station: "weigh", instrument: "balance", title: "Lay out the kit", phase: "Setup",
      detail: ["Bottle or tall glass, a tray with a rim, a jug and a cup", "Baking soda, vinegar, dish soap, food colouring", "Scale, ruler, spoon, paper towels", "Say “done”"], fields: [], get: [], put: [],
      why: "Baking soda, not baking powder: baking powder already contains its own acid." },
    { id: "stand", station: "weigh", instrument: "balance", title: "Stand the bottle on the tray", phase: "Setup",
      detail: ["Bottle in the middle of the tray, cap off and out of reach", "Ruler upright beside it", "Say “done”"], fields: [], get: [], put: [],
      why: "The cap stays off: this makes litres of gas, and a sealed bottle would burst." },
    onScale("water", "Warm water into the jug", "Water", "water_g", ["Jug on the scale, tare", "Pour in warm water"], "Warm water takes up more baking soda, so more of it reacts at once."),
    onScale("soda", "Baking soda into the jug", "Baking soda", "soda_g", ["Tare", "Add the baking soda and stir"], "The base. Each gram can release about 0.29 L of gas if there is acid to meet it."),
    onScale("soap", "Soap and colouring into the jug", "Dish soap", "soap_g", ["Tare", "Add the soap, then 6 drops of colouring", "Stir gently, no bubbles"], "Soap traps the gas as foam. Without it the gas just leaves."),
    { id: "load", station: "mix", instrument: "mixer", title: "Pour the mix into the bottle", phase: "Prepare", detail: ["Pour it in straight away, before the powder settles", "Rinse the jug", "Say “done”"], fields: [], get: [], put: [],
      why: "Nothing happens yet: soda, soap, colouring and water do not react with each other." },
    onScale("vinegar", "Vinegar into the cup", "Vinegar", "vinegar_g", ["Cup on the scale, tare", "Pour in the vinegar"], "The acid. It sets how much gas is made here: there is less of it than the soda needs."),
    { id: "erupt", station: "mix", instrument: "mixer", title: "Pour the vinegar, read the rise", phase: "Run", detail: ["Pour all the vinegar in at once and step back", "Say how far the foam rose above the rim, in centimeters"],
      fields: [{ id: "rise_cm", label: "Rise above the rim", unit: "cm", formula: "0", result: true }], get: [], put: [], why: "What does not fit in the bottle is pushed out of the neck: the rise is the gas you can see." },
    { id: "settle", station: "test", instrument: "imaging", title: "Wait, then read the foam left", phase: "Run", detail: ["Say “start” for the timer", "When it chimes, say the foam height above the rim in centimeters"], timer_min: 1,
      fields: [{ id: "left_cm", label: "Foam after 1 min", unit: "cm", formula: "0", result: true }], get: [], put: [], why: "How fast the foam drains shows how well the soap holds it." },
    { id: "photo", station: "test", instrument: "imaging", title: "Photo", phase: "Run", detail: ["Say “photo”", "Say “note” and anything odd"], fields: [], get: [], put: [], photo: true },
  ],
  script: [],
  about: {
    question: "How much gas does a kitchen volcano make, and does the foam match the chemistry?",
    equation: "NaHCO₃ + CH₃COOH → CH₃COONa + H₂O + CO₂",
    measured: "How far the foam rises above the rim, and what is left a minute later",
  },
  reaction: { acid: "vinegar", base: "soda", acid_frac: 0.05 },
  accept: { pct: 10, abs: 1 },
};

export const KITCHEN: Record<string, BenchProtocol> = Object.fromEntries([rubForOnePound, chickenRub, fizzFoam, fizzSeries, volcano].map((x) => [x.id, x]));
