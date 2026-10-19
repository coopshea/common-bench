// Moving around: go to a screen with a selection, jump across halves with a back chip, and the "not built yet" dialog.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { navigate } from "./hooks.ts";
import { noSel, useStore, type Selection } from "../state/store.tsx";
import { Future } from "../ds/index.tsx";

/** Go to a path with a selection. `back` leaves a chip that returns to where you were. */
export function useGo() {
  const { state, dispatch } = useStore();
  return (path: string, sel: Partial<Selection> = {}, back?: string) => {
    dispatch({ type: "back", back: back ? { path: window.location.pathname, sel: state.sel, label: back } : null });
    dispatch({ type: "askOpen", open: false });
    dispatch({ type: "select", sel: { ...noSel, ...sel } });
    navigate(path);
    window.scrollTo({ top: 0 });
  };
}

const FUTURE = {
  scan: { label: "Import lab scan", text: "Build the room from a phone scan, then confirm each instrument." },
  add: { label: "Add instrument", text: "Click a spot, take a photo, and the instrument is placed and drawn." },
  connect: { label: "Connect instruments", text: "Link an instrument through an MHS-style driver, a camera, or a worksheet." },
  devices: { label: "Device files", text: "What each instrument measures, what can be adjusted, and its limits." },
  book: { label: "Book", text: "Reserve a time slot; bookings show on the plan." },
  report: { label: "Send to report", text: "Hand the goal, findings, trials and questions to a writing tool, with citations." },
} as const;
export type FutureKey = keyof typeof FUTURE;
export const futureLabel = (k: FutureKey) => FUTURE[k].label;

const FutureCtx = createContext<{ open: FutureKey | null; set: (k: FutureKey | null) => void }>({ open: null, set: () => {} });
export function FutureProvider({ children }: { children: ReactNode }) {
  const [open, set] = useState<FutureKey | null>(null);
  return <FutureCtx.Provider value={{ open, set }}>{children}</FutureCtx.Provider>;
}
export function useFuture() {
  const { set } = useContext(FutureCtx);
  return (k: FutureKey) => set(k);
}

/** A not-yet-built action: clickable, tagged FUTURE, explains itself in one sentence. Never disabled. */
export function FutureButton({ k }: { k: FutureKey }) {
  const open = useFuture();
  return <button className="cb-btn" onClick={() => open(k)}>{FUTURE[k].label} <Future /></button>;
}

export function FutureDialog() {
  const { open, set } = useContext(FutureCtx);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, set]);
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && set(null)}>
      <div className="finder dialog" role="dialog" aria-label={FUTURE[open].label}>
        <Future />
        <h2>{FUTURE[open].label}</h2>
        <p>{FUTURE[open].text}</p>
        <button className="cb-btn" autoFocus onClick={() => set(null)}>OK</button>
      </div>
    </div>
  );
}
