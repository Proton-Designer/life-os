import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { featuredCardStyle } from "@/lib/featured-card-style";
import { IconChip } from "@/components/ui/icon-chip";
import { DeltaPill, type DeltaDirection } from "@/components/ui/delta-pill";
import { Sparkline } from "@/components/charts/sparkline";

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
  sparkline,
  size = "default",
  className,
  children,
  ...props
}: {
  icon: LucideIcon;
  accent: AccentToken;
  label: string;
  value: React.ReactNode;
  caption: string;
  delta?: { direction: DeltaDirection; text: string };
  // Optional inline trend (Insights' Week over week recap tiles) — same Sparkline
  // primitive already used in Reflection/Qur'an, colored to match the
  // card's own accent so it reads as part of the tile, not a bolted-on chart.
  sparkline?: number[];
  // Opt-in, additive-only variant (School's 2026-08-26 header rebuild,
  // Ayman: "decrease the sizes ... by a little") — every existing caller
  // keeps the default full size untouched; a smaller footprint is a
  // per-caller choice, never the component's own default.
  size?: "default" | "sm";
  className?: string;
  // Optional trailing content (e.g. a "View backlog" button + dialog) below
  // the caption/sparkline — opt-in, so every existing plain KpiCard is unaffected.
  children?: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const colorVar = ACCENT_VAR[accent];
  const isSm = size === "sm";

  return (
    <div
      data-testid="kpi-card"
      className={cn(
        "flex flex-col gap-3 rounded-2xl border",
        isSm ? "min-h-[120px] p-3" : "min-h-[168px] p-4",
        className
      )}
      style={featuredCardStyle(colorVar)}
      {...props}
    >
      <div className="flex items-center justify-between">
        <IconChip icon={icon} accent={accent} />
        {delta && <DeltaPill direction={delta.direction} text={delta.text} />}
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("font-mono font-semibold tabular-nums", isSm ? "text-2xl" : "text-4xl")}>{value}</p>
        <p className="text-xs text-muted-foreground">{caption}</p>
        {sparkline && sparkline.length > 0 && (
          <div className="mt-1">
            <Sparkline values={sparkline} colorVar={colorVar} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
