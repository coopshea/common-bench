// Tour mode: walkthrough scenes 2–7, one caption each, with the panel it highlights.
import { project } from "../data/notebook.ts";
import { firstNameOf } from "../data/notebook.ts";

export type TourTarget = "process" | "plots" | "table" | "ask" | "diff" | "approvals" | "evals";
export type TourAction = "intro" | "replay" | "ask" | "evidence" | "approve" | "evals";

export interface TourStep {
  scene: number;
  caption: string;
  targets: TourTarget[];
  action: TourAction;
}

const g = firstNameOf("greeshma");
const c = firstNameOf("cooper");

export const TOUR: TourStep[] = [
  {
    scene: 2,
    caption: `One goal: resin thinner than ${project.objective.target} ${project.objective.unit} that still passes every check. ${g} was running trials in her first week.`,
    targets: ["process", "plots"],
    action: "intro",
  },
  {
    scene: 3,
    caption: `Two years of trials. ${c} got strong but too thick, then thin but too weak, and called high diluent a dead end. ${g} is closest, from a different recipe.`,
    targets: ["plots", "table"],
    action: "replay",
  },
  {
    scene: 4,
    caption: `${g} asks before ordering a new material. Watch what the agent checks before it answers.`,
    targets: ["ask"],
    action: "ask",
  },
  {
    scene: 5,
    caption: `One unintended difference: ${g} degasses, ${c} never did. His one trial that sat overnight, T09, hit the goal, and was thrown out.`,
    targets: ["diff", "plots"],
    action: "evidence",
  },
  {
    scene: 6,
    caption: `Nothing changes without a person. ${g} approves: the dead end is disputed, the finding is hers, and T15 lands on the chart.`,
    targets: ["approvals", "plots"],
    action: "approve",
  },
  {
    scene: 7,
    caption: "Numbers come from tools, not the model. Here is what that buys, measured.",
    targets: ["evals"],
    action: "evals",
  },
];

export function tourClass(step: number | null, target: TourTarget): string {
  if (step === null) return "";
  return TOUR[step]?.targets.includes(target) ? "tour-focus" : "";
}
