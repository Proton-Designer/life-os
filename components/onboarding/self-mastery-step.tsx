"use client";

import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepShell } from "./step-shell";
import { PERSONAL_SUBDOMAIN_META } from "./domain-meta";

// ONB item 4: onboarding used to offer an inline "Add a book" side door
// (file upload -> stub ingestion -> a "reading your book" confirmation
// screen). Books are added in-app, not during onboarding — removed
// entirely, not merely hidden, so there is no disabled/dead control left
// behind. Collects nothing (ULM lead's ruling on PHASE-1-SPEC.md):
// "Continue" is the one action and it advances immediately.
export function SelfMasteryStep({
  onBack,
  onNext,
  progressTotal,
  progressIndex,
}: {
  onBack: () => void;
  onNext: () => void;
  progressTotal: number;
  progressIndex: number;
}) {
  const accent = PERSONAL_SUBDOMAIN_META.self_mastery.accent;

  return (
    <StepShell
      stepId="personal_growth-self_mastery"
      accent={accent}
      icon={BookOpen}
      eyebrow="Personal Growth · Self-Mastery"
      progressTotal={progressTotal}
      progressIndex={progressIndex}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" data-testid="onboarding-back" onClick={onBack}>
            Back
          </Button>
          <Button type="button" data-testid="selfmastery-continue" onClick={onNext}>
            Continue
          </Button>
        </div>
      }
    >
      <h1 className="text-xl font-semibold">Remember what you read.</h1>
      <p className="text-sm text-muted-foreground">
        Most of a book is gone within a month of finishing it. Self-Mastery turns a book into a few minutes of daily
        recall — so the ideas are still there when you need them.
      </p>
    </StepShell>
  );
}
