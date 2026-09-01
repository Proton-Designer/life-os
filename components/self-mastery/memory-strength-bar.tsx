import { cn } from "@/lib/utils";

// A 5-bucket color ramp low→high (mirrors ULM's own memoryRamp) rather than
// a single accent color — the point of this bar is legibility of WHERE a
// value sits, not brand consistency.
const RAMP = ["#D6CFC1", "#C9B98C", "#A8AE72", "#6E9463", "#2F5D50"];
function rampColorFor(value: number): string {
  const bucket = Math.min(4, Math.max(0, Math.floor(value * 5)));
  return RAMP[bucket];
}

// No fabricated data (ULM lead, repeated twice): a book/lesson nobody has
// reviewed yet renders at 0, not omitted and not padded up — the product's
// claim is that this number is measured, never asserted.
export function MemoryStrengthBar({
  value,
  label,
  size = "md",
  reviewedCount,
  totalCount,
}: {
  /** 0..1 mean FSRS retrievability. */
  value: number;
  label?: string;
  size?: "sm" | "md";
  /** Optional context — "3 of 5 cards reviewed" style caption, honest about partial coverage. */
  reviewedCount?: number;
  totalCount?: number;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const barHeight = size === "sm" ? "h-1.5" : "h-2";

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono tabular-nums text-foreground">{pct}%</span>
        </div>
      ) : null}
      <div className={cn("w-full overflow-hidden rounded-full bg-muted/60", barHeight)}>
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, backgroundColor: rampColorFor(value) }}
        />
      </div>
      {totalCount !== undefined ? (
        <span className="text-[11px] text-muted-foreground">
          {reviewedCount ?? 0} of {totalCount} card{totalCount === 1 ? "" : "s"} reviewed
        </span>
      ) : null}
    </div>
  );
}
