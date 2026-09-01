"use client";

import { useState } from "react";
import { saveDomainSelection, saveSubdomains, completeOnboarding } from "@/app/(app)/onboarding/actions";
import { DomainSelectStep } from "./domain-select-step";
import { PersonalGrowthStep } from "./personal-growth-step";
import { WorkStep } from "./work-step";
import { SchoolStep } from "./school-step";
import type { DomainKey, FaithConfig, SubdomainInput, WorkSubdomainDraft } from "./types";

type Phase = "domains" | "walk" | "submitting";

// The onboarding orchestrator (M3): pick top-level domains, then walk each
// selected domain IN SELECTION ORDER, then done. Each domain's step calls
// back with its own subdomain data; this component is the only place that
// talks to the server actions, so every step component below stays a pure,
// testable, server-ignorant UI.
//
// AC#5 (resume, not blind restart): `initialSelectedDomains`/`domainsWithData`/
// `initialFaithConfig` come from page.tsx's server-side read of
// getOnboardingState(). A brand-new account passes empty/null for all three
// and this behaves exactly as before.
export function OnboardingWizard({
  initialSelectedDomains = [],
  domainsWithData = [],
  initialFaithConfig = null,
}: {
  initialSelectedDomains?: DomainKey[];
  domainsWithData?: DomainKey[];
  initialFaithConfig?: FaithConfig | null;
}) {
  const [phase, setPhase] = useState<Phase>("domains");
  const [selectedDomains, setSelectedDomains] = useState<DomainKey[]>(initialSelectedDomains);
  const [walkIndex, setWalkIndex] = useState(0);
  const [faithConfig, setFaithConfig] = useState<FaithConfig | null>(initialFaithConfig);

  function toggleDomain(key: DomainKey) {
    setSelectedDomains((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function startWalk() {
    await saveDomainSelection(selectedDomains);
    // Resume at the first selected domain that doesn't already have
    // subdomains saved, rather than always restarting at index 0 — a
    // domain already answered in a prior session is skipped, not re-asked.
    const resumeIndex = selectedDomains.findIndex((d) => !domainsWithData.includes(d));
    setWalkIndex(resumeIndex === -1 ? Math.max(0, selectedDomains.length - 1) : resumeIndex);
    setPhase("walk");
  }

  async function finishCurrentDomain(domainKey: DomainKey, subs: SubdomainInput[]) {
    await saveSubdomains(domainKey, subs);
    // Use a local value for the completeOnboarding call below rather than
    // the `faithConfig` state variable — setFaithConfig here won't have
    // re-rendered yet, so reading the state directly in this same tick
    // would silently submit stale (usually null) profile fields whenever
    // Personal Growth is the last domain in the walk.
    let resolvedFaithConfig = faithConfig;
    if (domainKey === "personal_growth") {
      const faith = subs.find((s) => s.key === "faith");
      if (faith?.config) {
        resolvedFaithConfig = faith.config as unknown as FaithConfig;
        setFaithConfig(resolvedFaithConfig);
      }
    }
    if (walkIndex + 1 < selectedDomains.length) {
      setWalkIndex(walkIndex + 1);
    } else {
      setPhase("submitting");
      await completeOnboarding(resolvedFaithConfig ?? {});
    }
  }

  function backWithinWalk() {
    if (walkIndex === 0) {
      setPhase("domains");
    } else {
      setWalkIndex(walkIndex - 1);
    }
  }

  const progressTotal = 1 + selectedDomains.length;
  const progressIndex = phase === "domains" ? 0 : 1 + walkIndex;

  return (
    <div data-testid="onboarding-wizard" className="w-full">
      {phase === "domains" ? (
        <DomainSelectStep selected={selectedDomains} onToggle={toggleDomain} onNext={startWalk} />
      ) : null}

      {phase === "walk" && selectedDomains[walkIndex] === "personal_growth" ? (
        <PersonalGrowthStep
          onBack={backWithinWalk}
          onNext={(subs) => finishCurrentDomain("personal_growth", subs)}
          progressTotal={progressTotal}
          progressIndex={progressIndex}
        />
      ) : null}

      {phase === "walk" && selectedDomains[walkIndex] === "work" ? (
        <WorkStep
          onBack={backWithinWalk}
          onNext={(drafts: WorkSubdomainDraft[]) =>
            finishCurrentDomain(
              "work",
              drafts.map((d) => ({ key: d.key, label: d.label, kind: d.kind, widgets: d.widgets, config: {} }))
            )
          }
          progressTotal={progressTotal}
          progressIndex={progressIndex}
        />
      ) : null}

      {phase === "walk" && selectedDomains[walkIndex] === "school" ? (
        <SchoolStep
          onBack={backWithinWalk}
          onNext={() => finishCurrentDomain("school", [])}
          progressTotal={progressTotal}
          progressIndex={progressIndex}
        />
      ) : null}
    </div>
  );
}
