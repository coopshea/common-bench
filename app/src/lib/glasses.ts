// Glasses in the trial view: the server's state over one event stream, and what was just heard through the
// glasses' microphone. The server side is server/glasses.ts; nothing here runs when that isn't reachable.
import { useEffect, useRef, useState } from "react";
import type { GlassesContext, GlassesMark, GlassesState, GlassesValue } from "../shared/glasses.ts";

const send = (path: string, method: "POST" | "DELETE" = "POST", body?: unknown) =>
  fetch(`/api/glasses${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => undefined);

export const glasses = {
  start: (context: GlassesContext) => send("/start", "POST", { context }),
  stop: () => send("/stop"),
  context: (context: GlassesContext) => send("/context", "POST", { context }),
  say: (text: string) => send("/say", "POST", { text }),
  value: (value: GlassesValue) => send("/value", "POST", { value }),
  mark: (mark: GlassesMark) => send("/mark", "POST", { mark }),
  trial: (trial: unknown) => send("/trial", "POST", { trial }),
  confirm: (id: string) => send(`/events/${id}`, "POST", { ok: true }),
  remove: (id: string) => send(`/events/${id}`, "POST", { remove: true }),
  deleteRecording: (id: string) => send(`/recordings/${id}`, "DELETE"),
};

/**
 * The glasses' state, or null when the server has none to give (an older server, or offline).
 * `heard` gets each finished sentence from the glasses' microphone; `interim` gets it as it forms.
 */
export function useGlasses(on: { heard: (text: string) => void; interim: (text: string) => void }): GlassesState | null {
  const [state, setState] = useState<GlassesState | null>(null);
  const cb = useRef(on);
  cb.current = on;
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let again = 0;
    let last = Date.now(); // when the server was last heard from; it sends something at least every 5 s
    let none = false; // a hosted copy has no glasses server: asked once, then left alone
    const connect = () => {
      if (none) return;
      window.clearTimeout(again);
      es?.close();
      last = Date.now();
      const me = (es = new EventSource("/api/glasses/events"));
      const on = (name: string, fn: (data: string) => void) => me.addEventListener(name, (e) => { last = Date.now(); try { fn((e as MessageEvent<string>).data); } catch { /* a cut-off line: the next one replaces it */ } });
      on("state", (d) => setState(JSON.parse(d)));
      on("heard", (d) => { const h = JSON.parse(d) as { text: string; final: boolean }; (h.final ? cb.current.heard : cb.current.interim)(h.text); });
      on("ping", () => {});
      // A server that is down answers with an error status, and the browser then gives up for good: start over ourselves.
      me.onerror = () => { if (me === es && me.readyState === EventSource.CLOSED) again = window.setTimeout(connect, 2000); };
    };
    void fetch("/api/glasses/state").then((r) => { if (r.status === 404) { none = true; window.clearTimeout(again); es?.close(); } }).catch(() => {});
    connect();
    // A dev proxy can keep a dead connection open after the server behind it restarts. Silence means start over;
    // the first message on a new connection is the whole state.
    const watch = window.setInterval(() => { if (Date.now() - last > 12_000) connect(); }, 3000);
    return () => { window.clearInterval(watch); window.clearTimeout(again); es?.close(); };
  }, []);
  return state;
}
