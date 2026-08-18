import { countClearDays, type ReflectionDayBucket, type ReflectionStripDay } from "@/lib/deen/reflection-strip";
import { cn } from "@/lib/utils";

// Single-hue saturation ramp, not a categorical map — spec §5A: "one thing
// at four intensities," not "four unrelated things." Clear is a flat
// neutral (nothing to imply), low/mid/high step up --destructive's own
// opacity so severity reads as more-of-the-same-signal, not a new color.
const BUCKET_STYLE: Partial<Record<ReflectionDayBucket, React.CSSProperties>> = {
  clear: { backgroundColor: "var(--muted)" },
  low: { backgroundColor: "color-mix(in oklch, var(--destructive) 25%, var(--muted))" },
  mid: { backgroundColor: "color-mix(in oklch, var(--destructive) 50%, var(--muted))" },
  high: { backgroundColor: "color-mix(in oklch, var(--destructive) 80%, var(--muted))" },
  // in_progress gets no fixed color here — bg-accent-info comes from the
  // class below, matching the day-ribbon's own "live, unresolved" treatment
  // (components/home/day-ribbon.tsx's `pending` span) so the two grids
  // agree instead of one silently claiming a verdict the other withholds.
};

// Today, still running: neither a confirmed clear day nor a logged one.
// Same visual language as day-ribbon's `pending` span for the same reason —
// an open, unresolved window, not a result.
const IN_PROGRESS_CLASS = "bg-accent-info/60 animate-pulse";

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
                className={cn("h-6 flex-1 rounded-sm", d.bucket === "in_progress" && IN_PROGRESS_CLASS)}
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
