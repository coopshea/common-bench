// A tiny rAF clock: q = playback seconds (maps to the trial's real clock), t = animation phase for spinning parts.
// Reduced motion: no playback, show the end state.
import { useCallback, useEffect, useRef, useState } from "react";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function usePlayback(duration: number, key: string, autoplay = true) {
  const [q, setQ] = useState(() => (autoplay && !reduced() ? 0 : duration));
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(() => autoplay && !reduced());
  const raf = useRef(0);

  useEffect(() => {
    // new trial → replay it
    if (autoplay && !reduced()) { setQ(0); setPlaying(true); } else { setQ(duration); setPlaying(false); }
  }, [key, duration, autoplay]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setT((v) => v + dt);
      setQ((v) => {
        const n = v + dt;
        if (n >= duration) { setPlaying(false); return duration; }
        return n;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, duration]);

  const play = useCallback(() => {
    if (reduced()) { setQ(duration); return; }
    setQ((v) => (v >= duration ? 0 : v));
    setPlaying(true);
  }, [duration]);
  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback((v: number) => { setPlaying(false); setQ(Math.max(0, Math.min(duration, v))); }, [duration]);

  return { q, t, playing, play, pause, seek };
}
