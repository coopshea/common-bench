// Typed access to data/notebook.json. Every number on screen comes from here or from the /api/ask stream.
import raw from "../../data/notebook.json";
import type { LogEntry, Notebook, Person, PersonId, Trial } from "../shared/types.ts";

export const notebook = raw as unknown as Notebook;

export const project = notebook.project;
export const people = notebook.people;
export const trials = notebook.trials;
export const landscape = notebook.landscape;

const trialMap = new Map(trials.map((t) => [t.id, t]));
const personMap = new Map(people.map((p) => [p.id, p]));
const logMap = new Map<string, { entry: LogEntry; trial: Trial }>();
for (const t of trials) for (const e of t.log) logMap.set(e.id, { entry: e, trial: t });

export const trialById = (id: string): Trial | undefined => trialMap.get(id);
export const personById = (id: PersonId): Person => personMap.get(id)!;
export const logById = (id: string) => logMap.get(id);
export const colorOf = (id: PersonId): string => personMap.get(id)?.color ?? "#888";
export const firstNameOf = (id: PersonId): string => (personMap.get(id)?.name ?? id).split(" ")[0];

// Person colors are tuned for marks on the map. As text they must reach WCAG AA (4.5:1) on the warm canvas,
// so text uses the same hue, darkened just enough. Computed, not hand-picked, so any palette works.
const lum = (hex: string) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const darken = (hex: string, k: number) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
const INK = new Map(
  notebook.people.map((p) => {
    let c = p.color;
    for (let k = 1; contrast(c, "#f3f1ec") < 4.5 && k > 0.5; k -= 0.02) c = darken(p.color, k);
    return [p.id, c];
  }),
);
export const inkOf = (id: PersonId) => INK.get(id) ?? "#1b1a17";
