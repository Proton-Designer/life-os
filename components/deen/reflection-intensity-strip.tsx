import { countClearDays, type ReflectionDayBucket, type ReflectionStripDay } from "@/lib/deen/reflection-strip";
import { consistencyCellStyle } from "@/lib/charts/consistency-style";

// Single-hue saturation ramp, not a categorical map — spec §5A: "one thing
// at four intensities," not "four unrelated things." Clear is a flat
// neutral (nothing to imply), low/mid/high step up --destructive's own
// opacity so severity reads as more-of-the-same-signal, not a new color.
const BUCKET_STYLE: Partial<Record<ReflectionDayBucket, React.CSSProperties>> = {
  clear: { backgroundColor: "var(--muted)" },
  low: { backgroundColor: "color-mix(in oklch, var(--destructive) 25%, var(--muted))" },
  mid: { backgroundColor: "color-mix(in oklch, var(--destructive) 50%, var(--muted))" },
  high: { backgroundColor: "color-mix(in oklch, var(--destructive) 80%, var(--muted))" },
  // Today, still running: neither a confirmed clear day nor a logged one.
  // Lead's ruling (2026-08-18): this started as day-ribbon's solid+pulse
  // "live" treatment, but a pulse-only signal fails under
  // prefers-reduced-motion, and unlike the ribbon's single "now" this grid
  // can carry several in-progress cells at once (one per habit row, plus
  // this strip) — animation that reads as "alive" on one element reads as
  // noise on six. Reusing the habit grid's own "hollow" recipe instead
  // (lib/charts/consistency-style.ts) is both accessible and literally the
  // same treatment, not just a similar-looking one.
  in_progress: consistencyCellStyle("hollow", "--muted-foreground"),
};

function formatShortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function cellLabel(d: ReflectionStripDay): string {
  if (d.bucket === "clear") return "clear";
  if (d.bucket === "in_progress") return "in progress — day not over yet";
  return `${d.bucket} (weight ${d.weight})`;
}

export function ReflectionIntensityStrip({ days }: { days: ReflectionStripDay[] }) {
  const clearCount = countClearDays(days);
  const first = days[0];
  const last = days[days.length - 1];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        {clearCount} of the last {days.length} days clear
      </p>
      {/* overflow-x-auto + min-w on the track: 30 cells at a legible tap
          size don't reliably fit at 390px, same overflow class of bug
          already caught once tonight in prayer-row.tsx. */}
      <div className="overflow-x-auto">
        <div className="flex min-w-[480px] items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">{formatShortDate(first.date)}</span>
          <div className="flex flex-1 gap-1">
            {days.map((d) => (
              <div
                key={d.date}
                data-testid="reflection-strip-cell"
                data-date={d.date}
                data-bucket={d.bucket}
                role="img"
                aria-label={`${formatShortDate(d.date)}: ${cellLabel(d)}`}
                title={`${formatShortDate(d.date)}: ${d.bucket}`}
                className="h-6 flex-1 rounded-sm"
                style={BUCKET_STYLE[d.bucket]}
              />
            ))}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{formatShortDate(last.date)}</span>
        </div>
      </div>
    </div>
  );
}
