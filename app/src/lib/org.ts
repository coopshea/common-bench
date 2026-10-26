// The lab around the notebook: thrusts → projects → experiments, the room, and the links between them.
import type { Experiment, Instrument, LedgerItem, OrgProject, PersonId, Trial } from "../shared/types.ts";
import { notebook, project, trials } from "../data/notebook.ts";

export const org = notebook.org;
export const lab = notebook.lab;
export const ME = "greeshma" as const;

export const thrustById = (id: string) => org.thrusts.find((t) => t.id === id)!;
export const projectById = (id: string): OrgProject | undefined => org.projects.find((p) => p.id === id);
export const experimentById = (id: string): Experiment | undefined => org.experiments.find((x) => x.id === id);
export const experimentsOf = (projectId: string) => org.experiments.filter((x) => x.project === projectId);
export const experimentOfTrial = (t: Trial) => org.experiments.find((x) => x.project === project.id && x.campaign === t.campaign);
export const trialsOf = (x: Experiment) => (x.campaign ? trials.filter((t) => t.campaign === x.campaign) : []);
export const hasTrials = (projectId: string) => projectId === project.id;

const byRecent = (a: OrgProject, b: OrgProject) => b.last.localeCompare(a.last);
export const myProjects = () => org.projects.filter((p) => p.people.includes(ME) && !thrustById(p.thrust).closed).sort(byRecent);
export const projectsIn = (thrustId: string) => org.projects.filter((p) => p.thrust === thrustId).sort(byRecent);

// The notebook project's "what we know" and "open questions" are the ledger, so they change when a finding is approved.
export interface KnownItem { text: string; cite: string; id?: string; owner?: PersonId; ids?: string[] }

export function knownAndOpen(p: OrgProject, ledger: LedgerItem[]): { known: KnownItem[]; open: KnownItem[] } {
  if (p.id !== project.id) return { known: p.known ?? [], open: p.open ?? [] };
  const cite = (l: LedgerItem) => (l.evidence.length > 2 ? `${l.evidence[0]}–${l.evidence[l.evidence.length - 1]}` : l.evidence.join(", "));
  const short = (l: LedgerItem) => l.text.replace(/^Dead end: /, "").replace(/\s*\([^)]*\)\.?$/, "").replace(/\.$/, "").trim();
  const item = (l: LedgerItem, text: string): KnownItem => ({ text, cite: cite(l), id: l.id, owner: l.owner, ids: l.evidence.filter((e) => /^T\d/.test(e)) });
  const known = ledger
    .filter((l) => (l.kind === "finding" && l.status === "accepted") || (l.kind === "dead_end" && l.status === "active"))
    .map((l) => item(l, l.text));
  const open = ledger
    .filter((l) => (l.kind === "question" && l.status === "open") || l.status === "disputed" || l.status === "candidate")
    .map((l) => item(l, l.status === "disputed" ? `Is “${short(l)}” still true?` : l.text));
  return { known, open };
}

export const instrumentById = (id: string): Instrument | undefined => lab.instruments.find((i) => i.id === id);
export const instrumentOfDevice = (device: string) => lab.instruments.find((i) => i.device === device);
export const recentTrialsAt = (i: Instrument, n = 4) =>
  i.device ? trials.filter((t) => t.log.some((e) => e.device === i.device)).slice(-n).reverse() : [];

// ---------- Routes ----------
// /                       home
// /p/:project             project page
// /p/:project/:experiment experiment
// /lab                    the room
// /evals                  evals
export type Route =
  | { view: "home" }
  | { view: "project"; project: string }
  | { view: "experiment"; project: string; experiment: string }
  | { view: "lab" }
  | { view: "bench"; protocol?: string; mode: BenchMode }
  | { view: "evals" };

export type BenchMode = "view" | "run" | "print" | "edit";

export function parseRoute(path: string): Route {
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (seg[0] === "lab") return { view: "lab" };
  if (seg[0] === "sops" || seg[0] === "bench") return { view: "bench", protocol: seg[1], mode: (["run", "print", "edit"] as const).find((m) => m === seg[2]) ?? "view" };
  if (seg[0] === "evals") return { view: "evals" };
  if (seg[0] === "p" && seg[1] && projectById(seg[1])) {
    if (seg[2] && experimentById(seg[2])) return { view: "experiment", project: seg[1], experiment: seg[2] };
    return { view: "project", project: seg[1] };
  }
  return { view: "home" };
}

export const pathOf = {
  home: () => "/",
  project: (id: string) => `/p/${encodeURIComponent(id)}`,
  experiment: (p: string, x: string) => `/p/${encodeURIComponent(p)}/${encodeURIComponent(x)}`,
  lab: () => "/lab",
  bench: (id?: string) => (id ? `/sops/${encodeURIComponent(id)}` : "/sops"),
};
