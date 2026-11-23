// Glasses: what the server and the trial view share. See server/glasses.ts.
import type { BenchProtocol } from "./types.ts";

/** One line of the activity log. Camera lines are guesses until a person confirms them. */
export interface GlassesEvent {
  id: string;
  at: string; // ISO time
  // reply: something said back through the glasses. value: an amount recorded in the trial (see `data`).
  // step: the trial moved to this step (`step`), or finished (step null). mark: a timer, note, photo, done or skip (`kind`).
  source: "camera" | "voice" | "reply" | "value" | "step" | "mark" | "button" | "system";
  text: string;
  step?: number | null; // 1-based SOP step: the camera's guess on camera lines, the trial's own on step and mark lines
  /** Put in after the recording (server/glasses-ask-after.ts), not said or answered at the time. Shown as such. */
  added?: boolean;
  kind?: GlassesMark["kind"]; // mark lines
  confidence?: "low" | "medium" | "high";
  frame?: string; // file name of the frame it was read from, under the recording's frames/
  ok?: boolean; // camera lines: confirmed by a person
  data?: GlassesValue; // value lines
}

/** An amount as it was recorded in the trial: which step, how much, and what it was aiming for at that moment. */
export interface GlassesValue {
  step: number; // 0-based
  label: string;
  value: number;
  unit: string;
  target: number | null;
  off: number | null; // percent over (+) or under (−) the target, when that is more than the tolerance
  by: string; // voice, typed, timer
}

/** Something that happened in the trial besides an amount: kept in the recording's log so a replay can show it. */
export interface GlassesMark {
  kind: "timer_start" | "timer_stop" | "note" | "photo" | "done" | "skip";
  step: number; // 0-based
  text: string;
  at?: string; // ISO time it was stamped in the trial
}

/** What the trial view tells the server about the trial being run, so the camera log knows the SOP. */
export interface GlassesContext {
  sop: string;
  trial: string;
  steps: { title: string; detail: string[] }[];
  current: number | null; // 0-based index of the step the app shows as current
  // The whole SOP as this trial runs it, and the trial's settings: a recording can then be worked through again
  // later from its own folder (server/glasses-reprocess.ts), without the browser that ran it.
  protocol?: BenchProtocol;
  params?: Record<string, number>;
  operator?: string;
  /** What the SOP called for when the recording began, by field: the closing card's "Aim", whatever was rescaled later. */
  plan?: Record<string, number | null>;
}

export interface GlassesState {
  /** The phone app is polling (seen in the last few seconds). */
  device: { connected: boolean; model?: string; battery?: number; charging?: boolean; wifi?: string | null; stream?: string };
  /** A recording is wanted (started from the trial view or the glasses' button). */
  recording: { id: string; started: string; trial: string | null } | null;
  /** Frames are arriving from the glasses. */
  video: "off" | "waiting" | "live";
  /** Why the camera log isn't running, when it isn't. */
  observer: "on" | "no key" | "off";
  /** What the camera log last saw, whether or not it logged a line: shows it is looking. */
  seen: { at: string; scene: string } | null;
  /** Where spoken answers come out: the glasses, when they are one of this computer's sound outputs; otherwise the computer. */
  voice: "glasses" | "computer" | "off";
  /** The media server binary was found. */
  media: boolean;
  log: GlassesEvent[];
}
