"use client";

import { useState, useTransition } from "react";
import type { PlanKind } from "@/lib/fitness/plan-types";
import { SEED_PLANS } from "@/lib/fitness/seed-plans";
import type { TemplateKey } from "@/app/(app)/fitness/workouts/template-actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type { TemplateKey };

const TEMPLATE_OPTIONS: { key: TemplateKey; name: string; description: string }[] = [
  {
    key: "starter_reps",
    name: "Starter Reps",
    description: "30 pull-ups, 100 push-ups, chipped away through the weekday.",
  },
  ...SEED_PLANS.map((p) => ({
    key: p.key as TemplateKey,
    name: p.name,
    description:
      p.key === "plan_a"
        ? "Every session touches push, pull and delts — highest frequency, lowest per-session dose."
        : p.key === "plan_b"
          ? "Fewer, bigger touches — each muscle worked about twice a week at higher volume per touch."
          : "Trains what push-ups and pull-ups don't — delts and core every session, chest and lats held low.",
  })),
];

/**
 * "+ Create workout" → origin (from scratch, or start from a template) →
 * [scratch: name → micro | routine fork → builder] / [template: pick one,
 * materialize it, done]. Once materialized a template is JUST a plan — no
 * badge, no separate section, nothing distinguishing it afterward (Opus
 * Lead ruling, 2026-08-22) — this component's job ends the moment
 * onCreateFromTemplate resolves.
 */
export function NewPlanFlow({
  onChosen,
  onCreateFromTemplate,
}: {
  onChosen: (kind: PlanKind, name: string) => void;
  onCreateFromTemplate: (key: TemplateKey) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [step, setStep] = useState<"origin" | "template" | "name" | "kind">("origin");
  const [isCreating, startCreating] = useTransition();

  if (step === "origin") {
    return (
      <div className="flex flex-col gap-3" data-testid="new-plan-origin-step">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setStep("name")}
            className="min-h-11 rounded-lg border border-border/60 p-4 text-left text-sm hover:bg-muted"
          >
            <span className="font-medium">Create from scratch</span>
          </button>
          <button
            type="button"
            onClick={() => setStep("template")}
            className="min-h-11 rounded-lg border border-border/60 p-4 text-left text-sm hover:bg-muted"
          >
            <span className="font-medium">Start from a template</span>
          </button>
        </div>
      </div>
    );
  }

  if (step === "template") {
    return (
      <ul className="flex flex-col gap-2" data-testid="new-plan-template-step">
        {TEMPLATE_OPTIONS.map((option) => (
          <li key={option.key}>
            <button
              type="button"
              disabled={isCreating}
              onClick={() => startCreating(() => onCreateFromTemplate(option.key))}
              className="min-h-11 w-full rounded-md border border-border/40 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
            >
              <span className="font-medium">{option.name}</span>
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

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
        <Button type="button" disabled={!name.trim()} onClick={() => setStep("kind")} className="min-h-11 w-fit">
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
