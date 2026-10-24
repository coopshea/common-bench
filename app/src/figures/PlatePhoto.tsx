// Placeholder for the camera photo of a finished print: a build plate with the printed parts.
// Pure function of the counts, so a real photo can replace it without touching the Bench view.

export function PlatePhoto({ dogbones, bars, width = 320 }: { dogbones: number; bars: number; width?: number }) {
  const W = 320, H = 180;
  const bone = (x: number) => (
    <path key={`d${x}`} transform={`translate(${x} 22)`}
      d="M0 0h18v28q-5 6-5 14v28q0 8 5 14v28H0v-28q5-6 5-14V42q0-8-5-14Z" />
  );
  return (
    <svg className="plate-photo" width={width} height={(width * H) / W} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Build plate with ${dogbones} dogbones and ${bars} bend bars`}>
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="6" fill="#d9d6cd" stroke="var(--ink)" />
      <rect x="12" y="12" width={W - 24} height={H - 24} rx="3" fill="#c9c5ba" />
      <g fill="var(--resin)" stroke="var(--ink)" strokeWidth="1" strokeLinejoin="round">
        {Array.from({ length: dogbones }, (_, i) => bone(26 + i * 30))}
        {Array.from({ length: bars }, (_, i) => <rect key={`b${i}`} x={218} y={30 + i * 44} width={84} height={14} rx="1" />)}
      </g>
    </svg>
  );
}
