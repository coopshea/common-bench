/**
 * Messages between the background (which owns the glasses) and the phone screen.
 * Both halves import this file, so the names and shapes can't drift.
 */

/** What the phone screen shows: is the bench reachable, and what are the glasses doing. */
export interface BenchStatus {
  bench: string // the Common Bench address this build talks to
  reachable: boolean | null // null until the first answer
  stream: string // idle, starting, streaming, or the error
  listening: boolean // the microphone is being transcribed for a trial
  heard: string // the last thing heard
  wifi: string | null // the glasses' Wi-Fi network; null when they have none
  battery: number | null
}

export interface Channels {
  // phone screen → background
  "hello": Record<string, never>
  "toggle": Record<string, never> // start or stop a recording, same as the glasses' button

  // background → phone screen
  "status": BenchStatus
}

declare global {
  // eslint-disable-next-line no-var
  var mentra: import("@mentra/miniapp/ui").MentraTyped<Channels>
  // Inlined at build time (build.ts): where Common Bench is, and the key it gave this build.
  // eslint-disable-next-line no-var
  var process: {env: Record<string, string | undefined>}
}
