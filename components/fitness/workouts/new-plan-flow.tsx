"use client";

import { useState } from "react";
import type { PlanKind } from "@/lib/fitness/plan-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** "+ Create workout" → name → micro | routine fork → the matching builder (this component stops at the fork). */
export function NewPlanFlow({ onChosen }: { onChosen: (kind: PlanKind, name: string) => void }) {
  const [name, setName] = useState("");
  const [step, setStep] = useState<"name" | "kind">("name");

  if (step === "name") {
    return (
      <div className="flex flex-col gap-3" data-testid="new-plan-name-step">
        <Input
          placeholder="What should this workout be called?"
          aria-label="New workout name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Button
          type="button"
          disabled={!name.trim()}
          onClick={() => setStep("kind")}
          className="min-h-11 w-fit"
        >
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="new-plan-kind-step">
      <p className="text-sm font-medium">Micro session, or a traditional routine?</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onChosen("micro", name.trim())}
          className="min-h-11 rounded-lg border border-border/60 p-4 text-left text-sm hover:bg-muted"
        >
          <span className="font-medium">Micro</span>
          <span className="block text-xs text-muted-foreground">
            Standalone exercises, done whenever throughout the day — e.g. 30 pull-ups.
          </span>
        </button>
        <button
          type="button"
          onClick={() => onChosen("routine", name.trim())}
          className="min-h-11 rounded-lg border border-border/60 p-4 text-left text-sm hover:bg-muted"
        >
          <span className="font-medium">Traditional routine</span>
          <span className="block text-xs text-muted-foreground">
            Named sessions with scheduled exercises — e.g. Push day, Pull day.
          </span>
        </button>
      </div>
    </div>
  );
}
