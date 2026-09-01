"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepShell } from "./step-shell";
import { OptionCard } from "./option-card";
import { TOP_DOMAIN_META, TOP_DOMAIN_ORDER } from "./domain-meta";
import type { DomainKey } from "./types";

// Step 1, always: pick top-level domains. Selection ORDER is load-bearing —
// M3 walks each selected domain in the order it was picked — so `selected`
// is an array the caller appends/removes from, not a Set.
export function DomainSelectStep({
  selected,
  onToggle,
  onNext,
}: {
  selected: DomainKey[];
  onToggle: (key: DomainKey) => void;
  onNext: () => void;
}) {
  return (
    <StepShell
      stepId="domains"
      accent="info"
      icon={Sparkles}
      progressTotal={1}
      progressIndex={0}
      footer={
        <Button type="button" data-testid="onboarding-next" disabled={selected.length === 0} onClick={onNext} className="self-start">
          Continue
        </Button>
      }
    >
      <h1 className="text-xl font-semibold">What do you want to track?</h1>
      <p className="text-sm text-muted-foreground">Pick as many as you want — you can add or remove these later.</p>
      <div className="flex flex-col gap-2">
        {TOP_DOMAIN_ORDER.map((key) => {
          const meta = TOP_DOMAIN_META[key];
          return (
            <OptionCard
              key={key}
              testId={`domain-option-${key}`}
              icon={meta.icon}
              accent={meta.accent}
              label={meta.label}
              description={meta.description}
              selected={selected.includes(key)}
              onToggle={() => onToggle(key)}
            />
          );
        })}
      </div>
    </StepShell>
  );
}
