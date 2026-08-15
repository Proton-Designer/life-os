import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { featuredCardStyle } from "@/lib/featured-card-style";
import { IconChip } from "@/components/ui/icon-chip";
import { DeltaPill, type DeltaDirection } from "@/components/ui/delta-pill";

// Tier 1 — the reference dashboards' saturated tinted card. Always featured
// (there is no plain mode — that's what distinguishes it from a StatTile),
// and the caption is mandatory: it's what turns a number into an insight,
// and is the single highest-leverage change in the whole structural
// refactor. "No data" / a bare "0" are banned — every caller must supply a
// real, derived caption, including for empty states
// (e.g. "Nothing logged yet — start with Fajr").
export function KpiCard({
  icon,
  accent,
  label,
  value,
  caption,
  delta,
  className,
  ...props
}: {
  icon: LucideIcon;
  accent: AccentToken;
  label: string;
  value: React.ReactNode;
  caption: string;
  delta?: { direction: DeltaDirection; text: string };
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const colorVar = ACCENT_VAR[accent];

  return (
    <div
      data-testid="kpi-card"
      className={cn("flex min-h-[168px] flex-col gap-3 rounded-2xl border p-4", className)}
      style={featuredCardStyle(colorVar)}
      {...props}
    >
      <div className="flex items-center justify-between">
        <IconChip icon={icon} accent={accent} />
        {delta && <DeltaPill direction={delta.direction} text={delta.text} />}
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-mono text-4xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
}
