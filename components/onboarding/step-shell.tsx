import type { LucideIcon } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";

// The shared chrome for every onboarding screen: icon chip, eyebrow/title
// slot, body, footer, and the top-level progress dots. `stepId` is a stable
// machine-readable identifier for the currently rendered screen (Playwright
// asserts on it via data-step) — separate from the human-facing `eyebrow`.
export function StepShell({
  stepId,
  accent,
  icon: Icon,
  eyebrow,
  children,
  footer,
  progressTotal,
  progressIndex,
}: {
  stepId: string;
  accent: AccentToken;
  icon: LucideIcon;
  eyebrow?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  progressTotal: number;
  progressIndex: number;
}) {
  return (
    <div
      key={stepId}
      data-testid="onboarding-step"
      data-step={stepId}
      className="flex flex-col gap-5 rounded-2xl border border-border/40 bg-card p-6 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none motion-reduce:slide-in-from-bottom-0"
    >
      <div className="flex items-center justify-between">
        <IconChip icon={Icon} accent={accent} />
        {eyebrow ? (
          <span className="text-xs font-medium text-muted-foreground">{eyebrow}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">{children}</div>

      <div className="flex flex-col gap-3">
        {footer}
        <div data-testid="onboarding-progress" className="flex gap-1.5 pt-1">
          {Array.from({ length: progressTotal }, (_, i) => i).map((i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full transition-colors duration-300"
              style={{
                backgroundColor:
                  i <= progressIndex
                    ? `var(${ACCENT_VAR[accent]})`
                    : "color-mix(in oklch, var(--foreground) 12%, transparent)",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
