// A plain circular completion ring, v in 0..1.
export function Ring({ v, size = 16, stroke = 2.5 }: { v: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${Math.round(v * 100)}% done`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink)" strokeWidth={stroke}
        strokeDasharray={`${c * Math.max(0, Math.min(1, v))} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
