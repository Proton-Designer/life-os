import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { IconChip } from "@/components/ui/icon-chip";

export function StatCard({
  icon,
  accent,
  label,
  value,
  badge,
  featured = false,
  className,
  ...props
}: {
  icon: LucideIcon;
  accent: AccentToken;
  label: string;
  value: React.ReactNode;
  badge?: React.ReactNode;
  featured?: boolean;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const colorVar = ACCENT_VAR[accent];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4",
        !featured && "border-border/40 bg-card",
        className
      )}
      style={
        featured
          ? {
              borderColor: `color-mix(in oklch, var(${colorVar}) 30%, transparent)`,
              background: `radial-gradient(ellipse at top left, color-mix(in oklch, var(${colorVar}) 16%, transparent), transparent 70%)`,
            }
          : undefined
      }
      {...props}
    >
      <div className="flex items-center justify-between">
        <IconChip icon={icon} accent={accent} />
        {badge}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
