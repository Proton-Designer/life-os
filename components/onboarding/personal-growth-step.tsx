"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StepShell } from "./step-shell";
import { OptionCard } from "./option-card";
import { FaithStep } from "./faith-step";
import { FitnessStep } from "./fitness-step";
import { SelfMasteryStep } from "./self-mastery-step";
import { TOP_DOMAIN_META, PERSONAL_SUBDOMAIN_META, PERSONAL_SUBDOMAIN_ORDER } from "./domain-meta";
import type { FaithConfig, FitnessConfig, PersonalSubdomainKey, SubdomainInput } from "./types";

type Phase = "select" | PersonalSubdomainKey;

// Personal Growth: pick subdomains (Fitness + Self-Mastery preselected,
// Faith is not — ONB item 3 — minimum 1 kept), then walk the kept ones in a
// fixed order asking each one's own question (Faith and Fitness have one;
// Self-Mastery's primary path asks nothing).
export function PersonalGrowthStep({
  onBack,
  onNext,
  progressTotal,
  progressIndex,
  ingestionAvailable = false,
}: {
  onBack: () => void;
  onNext: (subs: SubdomainInput[]) => void;
  progressTotal: number;
  progressIndex: number;
  /** ONB item 4 removed SelfMasteryStep's own ingestion-gated affordance, so
   * this prop is no longer forwarded anywhere and does nothing here. Kept
   * declared, not removed, only because the wizard (not owned by this file)
   * still passes it — dropping the prop type would break that call site.
   * Safe for the wizard's own owner to also stop passing it. */
  ingestionAvailable?: boolean;
}) {
  const accent = TOP_DOMAIN_META.personal_growth.accent;
  // ONB item 3: Faith is the app's only religious-practice track (deen:
  // prayer times, Qur'an, adhkar) -- preselecting it, as Fitness/Self-Mastery
  // are, defaults every new account to practicing Islam without ever asking.
  // Only Faith starts unchosen; the user must actively opt in. Fitness and
  // Self-Mastery carry no such assumption and keep the original default.
  // Safe to leave unset: profiles.location_lat/location_lng have been
  // nullable with no default since the baseline schema, and
  // lib/home/get-priority-items.ts already gates prayer-window computation
  // on `!= null` (R18(4): "no location set" is an absent, already-handled
  // state, not a crash).
  const [kept, setKept] = useState<Set<PersonalSubdomainKey>>(new Set(PERSONAL_SUBDOMAIN_ORDER.filter((k) => k !== "faith")));
  const [showMinWarning, setShowMinWarning] = useState(false);
  const [phase, setPhase] = useState<Phase>("select");
  const [faithConfig, setFaithConfig] = useState<FaithConfig | null>(null);
  const [fitnessConfig, setFitnessConfig] = useState<FitnessConfig | null>(null);

  function toggle(key: PersonalSubdomainKey) {
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) {
          setShowMinWarning(true);
          return prev;
        }
        next.delete(key);
      } else {
        next.add(key);
      }
      setShowMinWarning(false);
      return next;
    });
  }

  function keptOrder(): PersonalSubdomainKey[] {
    return PERSONAL_SUBDOMAIN_ORDER.filter((k) => kept.has(k));
  }

  function advancePast(current: PersonalSubdomainKey) {
    const order = keptOrder();
    const idx = order.indexOf(current);
    const nextKey = order[idx + 1];
    if (nextKey) {
      setPhase(nextKey);
    } else {
      finish();
    }
  }

  function finish() {
    const subs: SubdomainInput[] = keptOrder().map((key) => {
      const meta = PERSONAL_SUBDOMAIN_META[key];
      if (key === "faith") {
        return { key, label: meta.label, config: faithConfig ? { ...faithConfig } : {} };
      }
      if (key === "fitness") {
        return { key, label: meta.label, config: fitnessConfig ? { ...fitnessConfig } : {} };
      }
      return { key, label: meta.label, config: {} };
    });
    onNext(subs);
  }

  function backFrom(current: PersonalSubdomainKey) {
    const order = keptOrder();
    const idx = order.indexOf(current);
    if (idx <= 0) {
      setPhase("select");
    } else {
      setPhase(order[idx - 1]);
    }
  }

  if (phase === "faith") {
    return (
      <FaithStep
        onBack={() => backFrom("faith")}
        onNext={(config) => {
          setFaithConfig(config);
          advancePast("faith");
        }}
        progressTotal={progressTotal}
        progressIndex={progressIndex}
      />
    );
  }

  if (phase === "self_mastery") {
    return (
      <SelfMasteryStep
        onBack={() => backFrom("self_mastery")}
        onNext={() => advancePast("self_mastery")}
        progressTotal={progressTotal}
        progressIndex={progressIndex}
      />
    );
  }

  if (phase === "fitness") {
    return (
      <FitnessStep
        onBack={() => backFrom("fitness")}
        onNext={(config) => {
          setFitnessConfig(config);
          advancePast("fitness");
        }}
        progressTotal={progressTotal}
        progressIndex={progressIndex}
      />
    );
  }

  return (
    <StepShell
      stepId="personal_growth-subdomains"
      accent={accent}
      icon={TOP_DOMAIN_META.personal_growth.icon}
      eyebrow="Personal Growth"
      progressTotal={progressTotal}
      progressIndex={progressIndex}
      footer={
        <div className="flex gap-2">
          <Button type="button" variant="outline" data-testid="onboarding-back" onClick={onBack}>
            Back
          </Button>
          <Button
            type="button"
            data-testid="onboarding-next"
            onClick={() => {
              const order = keptOrder();
              setPhase(order[0] ?? "select");
            }}
          >
            Continue
          </Button>
        </div>
      }
    >
      <h1 className="text-xl font-semibold">What&apos;s part of Personal Growth for you?</h1>
      <p className="text-sm text-muted-foreground">All three are on by default — keep at least one.</p>
      <div className="flex flex-col gap-2">
        {PERSONAL_SUBDOMAIN_ORDER.map((key) => {
          const meta = PERSONAL_SUBDOMAIN_META[key];
          return (
            <OptionCard
              key={key}
              testId={`subdomain-option-${key}`}
              icon={meta.icon}
              accent={meta.accent}
              label={meta.label}
              description={meta.description}
              selected={kept.has(key)}
              onToggle={() => toggle(key)}
            />
          );
        })}
      </div>
      {showMinWarning ? (
        <p data-testid="subdomain-minimum-warning" className="text-xs font-medium text-destructive">
          Keep at least one — you can always add the rest back later.
        </p>
      ) : null}
    </StepShell>
  );
}
