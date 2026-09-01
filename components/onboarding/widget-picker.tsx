"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OptionCard } from "./option-card";
import type { AccentToken } from "@/lib/accent-tokens";
import { WORK_WIDGET_CATALOGUE } from "./widget-catalogue";

// The "sub-window" M4 asks for: select widgets/features for a subdomain's
// screen, all preselected by default. Confirming is a separate action from
// the wizard's generic onboarding-next, since this is a nested picker inside
// the Work subdomain flow, not a top-level step transition.
export function WidgetPicker({
  accent,
  defaultSelectedIds,
  onConfirm,
}: {
  accent: AccentToken;
  defaultSelectedIds: string[];
  onConfirm: (selectedIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelectedIds));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div data-testid="widget-picker" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        All set with sensible defaults — turn any of these off, or add more.
      </p>
      <div className="flex max-h-[min(60vh,420px)] flex-col gap-2 overflow-y-auto pr-0.5">
        {WORK_WIDGET_CATALOGUE.map((widget) => (
          <OptionCard
            key={widget.id}
            testId={`widget-option-${widget.id}`}
            icon={widget.icon}
            accent={accent}
            label={widget.label}
            description={widget.description}
            selected={selected.has(widget.id)}
            onToggle={() => toggle(widget.id)}
            size="sm"
          />
        ))}
      </div>
      <Button
        type="button"
        data-testid="widget-picker-confirm"
        onClick={() => onConfirm(Array.from(selected))}
        className="self-start"
      >
        Continue
      </Button>
    </div>
  );
}
