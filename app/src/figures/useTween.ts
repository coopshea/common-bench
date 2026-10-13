// Animate a number from → to over ms with ease-in-out; replayable, cancels itself. Reduced motion: jump to the end.
import { useCallback, useEffect, useRef } from "react";

export function useTween(set: (v: number) => void) {
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return useCallback((from: number, to: number, ms = 1400) => {
    cancelAnimationFrame(raf.current);
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) { set(to); return; }
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      set(from + (to - from) * e);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [set]);
}
