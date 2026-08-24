import { buildReflectionMonth, type ReflectionMonthBucket, type ReflectionMonthDay } from "@/lib/deen/reflection-month";
import type { ReflectionTierEntry } from "@/lib/deen/reflection-strip";
import { consistencyCellStyle } from "@/lib/charts/consistency-style";
import { cn } from "@/lib/utils";

// Same single-hue severity ramp as the old ReflectionIntensityStrip
// (reflection-intensity-strip.tsx) — reused deliberately per spec §7, not a
// second scale. "empty" is new here: a future day within the month, styled
// as a bare outline rather than "clear"'s flat muted fill, since it hasn't
// happened yet and hasn't earned a verdict either way.
const BUCKET_STYLE: Record<ReflectionMonthBucket, React.CSSProperties> = {
  clear: { backgroundColor: "var(--muted)" },
  low: { backgroundColor: "color-mix(in oklch, var(--destructive) 25%, var(--muted))" },
  mid: { backgroundColor: "color-mix(in oklch, var(--destructive) 50%, var(--muted))" },
  high: { backgroundColor: "color-mix(in oklch, var(--destructive) 80%, var(--muted))" },
  in_progress: consistencyCellStyle("hollow", "--muted-foreground"),
  empty: { backgroundColor: "transparent" },
};

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

function cellLabel(d: ReflectionMonthDay): string {
  if (!d.inMonth) return "";
  if (d.bucket === "empty") return "upcoming";
  if (d.bucket === "in_progress") return "in progress — day not over yet";
  if (d.bucket === "clear") return "clear";
  return `${d.bucket} — Light ${d.counts.light}, Moderate ${d.counts.moderate}, Heavy ${d.counts.heavy}`;
}

function MonthDayCell({ day }: { day: ReflectionMonthDay }) {
  if (!day.inMonth) return <div aria-hidden="true" />;

  const total = day.counts.light + day.counts.moderate + day.counts.heavy;

  return (
    <div
      data-testid="reflection-month-cell"
      data-date={day.date}
      data-bucket={day.bucket}
      role="img"
      aria-label={`${day.date}: ${cellLabel(day)}`}
      title={`${day.date}: ${cellLabel(day)}`}
      className={cn(
        "flex min-h-16 flex-col gap-0.5 rounded-md border border-border/30 p-1 text-[10px]",
        day.bucket === "empty" && "border-dashed"
      )}
      style={BUCKET_STYLE[day.bucket]}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "font-mono tabular-nums",
            day.isToday && "rounded-full bg-accent-deen px-1 text-background"
          )}
        >
          {dayOfMonth(day.date)}
        </span>
        {total > 0 && <span className="font-mono font-semibold tabular-nums">{total}</span>}
      </div>
      {day.bucket !== "empty" && (
        <div className="flex flex-col leading-tight text-muted-foreground">
          <span className={cn(day.counts.light === 0 && "opacity-40")}>L: {day.counts.light}</span>
          <span className={cn(day.counts.moderate === 0 && "opacity-40")}>M: {day.counts.moderate}</span>
          <span className={cn(day.counts.heavy === 0 && "opacity-40")}>H: {day.counts.heavy}</span>
        </div>
      )}
    </div>
  );
}

export function ReflectionMonthCalendar({
  entries,
  todayStr,
}: {
  entries: ReflectionTierEntry[];
  todayStr: string;
}) {
  const year = Number(todayStr.slice(0, 4));
  const month = Number(todayStr.slice(5, 7));
  const days = buildReflectionMonth(entries, year, month, todayStr);
  const monthLabel = new Date(`${todayStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // Opus Lead (2026-08-24, overnight session): tonight's data wipe clears
  // every reflection entry, so a brand-new month renders as a wall of
  // "clear" (weight-0) cells that visually reads as "a perfect month" —
  // indistinguishable from a real one. This caption is the fix: it's the
  // literal fact ("nothing logged"), not a claim about any specific day.
  const hasAnyEntries = days.some((d) => d.inMonth && d.weight > 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">{monthLabel}</p>
        {!hasAnyEntries && <p className="text-xs text-muted-foreground">Nothing logged yet</p>}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i} className="text-center text-[10px] text-muted-foreground">
            {label}
          </span>
        ))}
        {days.map((day) => (
          <MonthDayCell key={day.date} day={day} />
        ))}
      </div>
    </div>
  );
}
