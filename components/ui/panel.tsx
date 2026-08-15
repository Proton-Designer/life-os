import { cn } from "@/lib/utils";
import { DeltaPill, type DeltaDirection } from "@/components/ui/delta-pill";

// Tier 2 — holds charts, lists, forms. Per the one-metric rule (2026-08-15
// structural refactor review): if a screen has a panel for a metric, that
// number lives HERE, in the panel's own header, next to the detail it
// summarizes — not duplicated into a separate KPI card above it.
export function Panel({
  title,
  controls,
  heroValue,
  delta,
  caption,
  children,
  className,
  ...props
}: {
  title: string;
  controls?: React.ReactNode;
  heroValue?: React.ReactNode;
  delta?: { direction: DeltaDirection; text: string };
  caption?: string;
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-panel
      className={cn("flex flex-col gap-4 rounded-2xl border border-border/40 bg-card p-4", className)}
      {...props}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{title}</span>
          {controls}
        </div>
        {heroValue !== undefined && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xl font-semibold tabular-nums">{heroValue}</span>
              {delta && <DeltaPill direction={delta.direction} text={delta.text} />}
            </div>
            {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
