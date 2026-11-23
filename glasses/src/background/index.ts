/**
 * Common Bench on the glasses. Runs inside the Mentra app on the phone for as long as the app is alive.
 *
 * It asks Common Bench (on the lab computer, same network) every two seconds what is wanted:
 *   - a recording → the glasses publish their camera and microphone straight to that computer (RTMP);
 *   - a trial open on screen → what you say is transcribed and sent over, to fill in the steps.
 * The glasses' button starts or stops a recording (short press) or marks the moment (long press).
 *
 * Common Bench decides everything; this file only carries it out and reports back.
 */

import {registerMiniapp} from "@mentra/miniapp/background"
import type {BenchStatus} from "../shared/channels"
import "../shared/channels"

const BENCH = process.env.MENTRA_PUBLIC_BENCH_URL ?? ""
const KEY = process.env.MENTRA_PUBLIC_BENCH_KEY ?? ""
const POLL_MS = 2000
const RETRY_MS = 6000 // after a stream fails to start, wait before trying again

interface Wanted {
  want: "stream" | "idle"
  url: string | null
  listen: boolean
}

registerMiniapp(async (session) => {
  const status: BenchStatus = {bench: BENCH, reachable: null, stream: "idle", listening: false, heard: "", wifi: null, battery: null}
  let model: string | undefined
  let charging: boolean | undefined
  let streamId: string | null = null
  let starting = false
  let retryAt = 0

  const show = () => session.ui.send("status", {...status})

  const bench = async <T>(path: string, body: unknown = {}): Promise<T> => {
    const res = await fetch(`${BENCH}/api/glasses/device${path}`, {
      method: "POST",
      headers: {"content-type": "application/json", "x-bench-key": KEY},
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Common Bench answered ${res.status}`)
    return (await res.json()) as T
  }

  // ---- Microphone: only transcribed while Common Bench wants it ----
  let stopListening: (() => void) | null = null
  let lastInterim = 0
  const listen = (on: boolean) => {
    if (on && !stopListening) {
      stopListening = session.transcription.on((d) => {
        status.heard = d.text
        // Every finished sentence goes over; the words as they form go at most a few times a second.
        if (!d.isFinal && Date.now() - lastInterim < 300) return
        lastInterim = Date.now()
        void bench("/transcript", {text: d.text, isFinal: d.isFinal}).catch(() => {})
        if (d.isFinal) show()
      })
    } else if (!on && stopListening) {
      stopListening()
      stopListening = null
    }
    status.listening = Boolean(stopListening)
  }

  // ---- Camera: publish to the address Common Bench gives, stop when it says so ----
  const follow = async (w: Wanted) => {
    if (w.want === "stream" && w.url && !streamId && !starting && Date.now() >= retryAt) {
      starting = true
      status.stream = "starting"
      show()
      try {
        const r = await session.stream.startStream({direct: w.url, video: {width: 1280, height: 720, fps: 30}})
        streamId = r.streamId
        status.stream = r.status || "streaming"
      } catch (e) {
        status.stream = `error: ${e instanceof Error ? e.message : String(e)}`
        retryAt = Date.now() + RETRY_MS
      } finally {
        starting = false
      }
    } else if (w.want === "idle" && streamId) {
      const id = streamId
      streamId = null
      status.stream = "idle"
      await session.stream.stop(id).catch(() => {})
    } else if (w.want === "idle" && !starting) {
      status.stream = "idle"
    }
  }

  // The glasses report how the stream is doing; when it ends for good, the next poll starts a new one.
  session.events.subscribe("stream_status", (raw) => {
    const d = raw as {streamId?: string; status?: string; errorDetails?: string}
    if (!d.status || (streamId && d.streamId && d.streamId !== streamId)) return
    status.stream = d.errorDetails ? `${d.status}: ${d.errorDetails}` : d.status
    if (d.status === "stopped" || d.status === "error") {
      streamId = null
      retryAt = Date.now() + RETRY_MS
    }
    show()
  })

  // ---- The loop ----
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const w = await bench<Wanted>("/poll", {model, battery: status.battery ?? undefined, charging, wifi: status.wifi, stream: status.stream})
      status.reachable = true
      listen(w.listen)
      await follow(w)
    } catch {
      status.reachable = false // keep doing what we were doing; Common Bench may just be restarting
    } finally {
      busy = false
      show()
    }
  }
  setInterval(() => void tick(), POLL_MS)
  void tick()

  // ---- Glasses: button, battery, Wi-Fi ----
  const press = (pressType: "short" | "long") => bench("/button", {pressType}).then(tick, () => {})
  session.input.onButtonPress((d) => void press(d.pressType))
  session.glasses.onBattery((d) => { status.battery = d.level; charging = d.charging })
  session.glasses.onConnection((d) => { model = d.modelName })
  session.glasses.onWifi((d) => { status.wifi = d.connected ? (d.ssid ?? "connected") : null })

  // ---- Phone screen ----
  session.ui.onOpen(show)
  session.ui.on("hello", show)
  session.ui.on("toggle", () => void press("short"))
})
