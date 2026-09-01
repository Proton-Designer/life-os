import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";

// A pressable, checkable card — the shared visual for every "pick one or
// more of these" screen in onboarding (domains, subdomains, work kind,
// widgets). Selected state is real aria-pressed, not just a class, so it's
// both accessible and directly assertable by Playwright.
export function OptionCard({
  icon: Icon,
  accent,
  label,
  description,
  selected,
  disabled,
  onToggle,
  testId,
  size = "md",
}: {
  icon: LucideIcon;
  accent: AccentToken;
  label: string;
  description?: string;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
  testId: string;
  size?: "md" | "sm";
}) {
  return (
    <button
      type="button"
      role="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      data-testid={testId}
      className={cn(
        "group/option flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-transparent bg-card shadow-sm" : "border-border/50 bg-transparent hover:border-border hover:bg-muted/40",
        disabled && "cursor-not-allowed opacity-50 hover:border-border/50 hover:bg-transparent"
      )}
      style={
        selected
          ? {
              boxShadow: `0 0 0 1.5px var(${ACCENT_VAR[accent]})`,
              backgroundColor: `color-mix(in oklch, var(${ACCENT_VAR[accent]}) 6%, var(--card))`,
            }
          : undefined
      }
    >
      <IconChip icon={Icon} accent={accent} size={size === "sm" ? "sm" : "md"} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      <div
        className={cn(
          "mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
          selected ? "border-transparent text-white" : "border-border/60 text-transparent"
        )}
        style={selected ? { backgroundColor: `var(${ACCENT_VAR[accent]})` } : undefined}
        aria-hidden="true"
      >
        <Check className="size-3.5" strokeWidth={3} />
      </div>
    </button>
  );
}
