// Single completion fraction — generalizes Home's pulse rings (previously a
// CSS conic-gradient donut) into hand-rolled SVG, matching every other
// Phase C primitive's technique and giving proper stroke-linecap control.
export function ProgressRing({
  pct,
  colorVar,
  size = 56,
  strokeWidth = 6,
  label,
}: {
  pct: number;
  colorVar: string;
  size?: number;
  strokeWidth?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (clamped / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={label ?? `${Math.round(clamped)}%`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
        />
        {clamped > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`var(${colorVar})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <span className="pointer-events-none absolute font-mono text-xs font-medium tabular-nums">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
