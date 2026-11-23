import {useEffect, useState} from "react"
import type {BenchStatus} from "../shared/channels"

export function App() {
  const [s, setS] = useState<BenchStatus | null>(null)

  useEffect(() => {
    const off = mentra.on("status", setS)
    mentra.send("hello", {})
    return off
  }, [])

  const streaming = Boolean(s && s.stream !== "idle" && !s.stream.startsWith("error"))

  return (
    <div className="app">
      <h1>Common Bench</h1>
      <dl>
        <dt>Bench</dt>
        <dd className={s?.reachable === false ? "bad" : ""}>{s == null ? "…" : s.reachable ? "Connected" : s.reachable === false ? "Can’t reach it" : "…"}</dd>
        <dt>Camera</dt>
        <dd className={s?.stream.startsWith("error") ? "bad" : ""}>{s?.stream ?? "…"}</dd>
        <dt>Glasses Wi-Fi</dt>
        <dd className={s && !s.wifi ? "bad" : ""}>{s == null ? "…" : (s.wifi ?? "Not connected")}</dd>
        <dt>Heard</dt>
        <dd>{s?.listening ? (s.heard ? `“${s.heard}”` : "Listening") : "Off"}</dd>
      </dl>
      <button type="button" disabled={!s?.reachable} onClick={() => mentra.send("toggle", {})}>
        {streaming ? "Stop" : "Record"}
      </button>
      <p className="where">{s?.bench}</p>
    </div>
  )
}
