import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccentToken } from "@/lib/accent-tokens";
import { IconChip } from "@/components/ui/icon-chip";
import { DeltaPill, type DeltaDirection } from "@/components/ui/delta-pill";

// Tier 3 — compact, used in clusters of 2-4 inside or beside a Panel. Flat
// bg-card (unlike KpiCard's always-tinted Tier 1 treatment) since several
// of these sit next to each other and tinting all of them would just be
// noise, not signal.
export function StatTile({
  icon,
  accent,
  label,
  value,
  delta,
  className,
  ...props
}: {
  icon: LucideIcon;
  accent: AccentToken;
  label: string;
  value: React.ReactNode;
  delta?: { direction: DeltaDirection; text: string };
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="stat-tile"
      className={cn("flex flex-col gap-2 rounded-xl border border-border/40 bg-card p-4", className)}
      {...props}
    >
      <div className="flex items-center justify-between">
        <IconChip icon={icon} accent={accent} size="sm" />
        {delta && <DeltaPill direction={delta.direction} text={delta.text} />}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
