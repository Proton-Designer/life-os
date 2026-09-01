"use client";

import { Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepShell } from "./step-shell";
import { OptionCard } from "./option-card";
import { PERSONAL_SUBDOMAIN_META } from "./domain-meta";
import type { FitnessConfig } from "./types";

export function FitnessStep({
  onBack,
  onNext,
  progressTotal,
  progressIndex,
}: {
  onBack: () => void;
  onNext: (config: FitnessConfig) => void;
  progressTotal: number;
  progressIndex: number;
}) {
  const accent = PERSONAL_SUBDOMAIN_META.fitness.accent;

  return (
    <StepShell
      stepId="personal_growth-fitness"
      accent={accent}
      icon={Dumbbell}
      eyebrow="Personal Growth · Fitness"
      progressTotal={progressTotal}
      progressIndex={progressIndex}
      footer={
        <Button type="button" variant="outline" data-testid="onboarding-back" onClick={onBack} className="self-start">
          Back
        </Button>
      }
    >
      <h1 className="text-xl font-semibold">How do you train?</h1>
      <div className="flex flex-col gap-2">
        <OptionCard
          testId="fitness-style-plan"
          icon={Dumbbell}
          accent={accent}
          label="Follow a plan"
          description="Structured multi-set sessions with a schedule."
          selected={false}
          onToggle={() => onNext({ style: "plan" })}
        />
        <OptionCard
          testId="fitness-style-adhoc"
          icon={Dumbbell}
          accent={accent}
          label="Train ad hoc"
          description="Quick daily rep targets, logged as you go."
          selected={false}
          onToggle={() => onNext({ style: "ad_hoc" })}
        />
      </div>
    </StepShell>
  );
}
