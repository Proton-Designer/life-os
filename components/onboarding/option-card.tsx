"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";

// A pressable, checkable card — the shared visual for every "pick one or
// more of these" screen in onboarding (domains, subdomains, work kind,
// widgets). Selected state is real aria-pressed, not just a class, so it's
// both accessible and directly assertable by Playwright.
//
// RC-A / item 6a (Ayman, 2026-09-19): "when one of the two options are pressed,
// it doesn't actually display that option as being pressed immediately".
// Two distinct uses of this card had been conflated:
//   - a TOGGLE (domains, subdomains, widgets): the parent owns `selected` and
//     flips it synchronously, so feedback was already instant.
//   - a NAVIGATION TRIGGER (fitness style, school source): `selected` is
//     hardcoded false and onToggle advances the wizard. Nothing could ever
//     render as pressed, so the card sat visually inert for as long as the
//     server round-trip took.
// `justPressed` fixes the second without disturbing the first. It is only set
// when the card is NOT already selected — otherwise DEselecting a toggle would
// keep it looking selected, which is the same bug pointing the other way.
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
  const [justPressed, setJustPressed] = useState(false);
  // What the user SEES. `selected` stays the accessibility/assertion truth —
  // a transient press must not lie in aria-pressed or in what Playwright reads.
  const looksSelected = selected || justPressed;

  function handleClick() {
    if (!selected) setJustPressed(true);
    onToggle();
  }

  return (
    <button
      type="button"
      role="button"
      aria-pressed={selected}
      data-pressed={looksSelected ? "true" : undefined}
      disabled={disabled}
      onClick={handleClick}
      data-testid={testId}
      className={cn(
        "group/option flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        "active:scale-[0.99] motion-reduce:active:scale-100",
        looksSelected ? "border-transparent bg-card shadow-sm" : "border-border/50 bg-transparent hover:border-border hover:bg-muted/40",
        disabled && "cursor-not-allowed opacity-50 hover:border-border/50 hover:bg-transparent"
      )}
      style={
        looksSelected
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
          looksSelected ? "border-transparent text-white" : "border-border/60 text-transparent"
        )}
        style={looksSelected ? { backgroundColor: `var(${ACCENT_VAR[accent]})` } : undefined}
        aria-hidden="true"
      >
        <Check className="size-3.5" strokeWidth={3} />
      </div>
    </button>
  );
}
