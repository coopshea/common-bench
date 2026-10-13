// One mark per trial state, so status never rests on color alone (shape + color):
// goal met = filled green disc with a check · too thick = amber ring · fails = red cross.
import type { Status } from "../../lib/metrics.ts";

export const STATUS_COLOR: Record<Status, string> = { goal: "#0ca30c", close: "#d99a00", fail: "#d03b3b" };

export function StatusMark({ status, cx, cy, r = 7, est = false, on = false }: { status: Status; cx: number; cy: number; r?: number; est?: boolean; on?: boolean }) {
  const c = STATUS_COLOR[status];
  const dash = est ? "3 2" : undefined;
  const ring = on ? <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="var(--ink)" strokeWidth={1.5} /> : null;
  if (status === "goal") {
    return (
      <g>
        {ring}
        <circle cx={cx} cy={cy} r={r} fill={est ? "#fff" : c} stroke={c} strokeWidth={est ? 2 : 0} strokeDasharray={dash} />
        <path d={`M${cx - r * 0.45} ${cy + r * 0.02} l${r * 0.32} ${r * 0.32} l${r * 0.6} ${-r * 0.62}`} fill="none" stroke={est ? c : "#fff"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  if (status === "close") {
    return (
      <g>
        {ring}
        <circle cx={cx} cy={cy} r={r - 1} fill="#fff7e0" stroke={c} strokeWidth={2.5} strokeDasharray={dash} />
      </g>
    );
  }
  const k = r * 0.62;
  return (
    <g>
      {ring}
      <circle cx={cx} cy={cy} r={r} fill={est ? "#fff" : "#fde7e7"} stroke={est ? c : "none"} strokeWidth={1.5} strokeDasharray={dash} />
      <path d={`M${cx - k} ${cy - k} L${cx + k} ${cy + k} M${cx + k} ${cy - k} L${cx - k} ${cy + k}`} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
    </g>
  );
}
