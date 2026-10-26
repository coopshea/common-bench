// Guided reveal: the screen builds up one question at a time (see ONBOARDING.md).
// While the guide runs, only the panels the current step has reached are mounted. Exiting shows everything.
import { project } from "../data/notebook.ts";
import { firstNameOf } from "../data/notebook.ts";

export type TourTarget = "process" | "plots" | "table" | "ask" | "diff" | "approvals" | "evals";
export type TourAction = "intro" | "replay" | "ask" | "evidence" | "approve" | "evals";
export type Panel = "tradeoff" | "focus" | "table" | "agent" | "process";

export interface TourStep {
  title: string; // the question this step answers
  caption: string;
  show: Panel[]; // everything visible at this step (cumulative)
  targets: TourTarget[];
  action: TourAction;
}

const g = firstNameOf("shreya");
const c = firstNameOf("cooper");

export const ALL_PANELS: Panel[] = ["tradeoff", "focus", "table", "agent", "process"];

export const TOUR: TourStep[] = [
  {
    title: "What have we tried?",
    caption: `Every trial from both people on one map. The goal is the green corner: thinner than ${project.objective.target} ${project.objective.unit} and still strong. ${c} called high diluent a dead end. ${g} is closest.`,
    show: ["tradeoff"],
    targets: ["plots"],
    action: "replay",
  },
  {
    title: "How well did it work?",
    caption: "Thin enough isn't enough. Every trial is scored against every check: strength, bending, bubbles and cell safety.",
    show: ["tradeoff", "focus", "table"],
    targets: ["plots", "table"],
    action: "intro",
  },
  {
    title: "Why did results differ?",
    caption: `${g} asks before ordering a $1,800 material. The agent lines up two runs step by step: she degasses, ${c} never did. His one trial that sat overnight, T09, passed.`,
    show: ["tradeoff", "focus", "table", "agent"],
    targets: ["ask", "diff"],
    action: "evidence",
  },
  {
    title: "What do we try next?",
    caption: `It proposes T15 with a control arm and nothing to order. Nothing changes until ${g} approves, and the finding is hers.`,
    show: ["tradeoff", "focus", "table", "agent"],
    targets: ["approvals", "plots"],
    action: "approve",
  },
  {
    title: "Where the data comes from",
    caption: "Devices log themselves as people work. The degasser has no interface, so a person logs it, and that's where the answer was.",
    show: ALL_PANELS,
    targets: ["process"],
    action: "intro",
  },
  {
    title: "Is it right?",
    caption: "Numbers come from tools, not the model. Here is what that buys, measured.",
    show: ALL_PANELS,
    targets: ["evals"],
    action: "evals",
  },
];

export function tourClass(step: number | null, target: TourTarget): string {
  if (step === null) return "";
  return TOUR[step]?.targets.includes(target) ? "tour-focus" : "";
}

export function visiblePanels(step: number | null): Set<Panel> {
  return new Set(step === null ? ALL_PANELS : TOUR[step]?.show ?? ALL_PANELS);
}

// First visit starts the guide. Storage can throw (private mode); then the guide just starts every time.
const SEEN_KEY = "common-bench:guided";
export function guideSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
export function markGuideSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}
