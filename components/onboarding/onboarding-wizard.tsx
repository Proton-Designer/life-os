"use client";

import { useRef, useState } from "react";
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
  ingestionAvailable = false,
}: {
  initialSelectedDomains?: DomainKey[];
  domainsWithData?: DomainKey[];
  initialFaithConfig?: FaithConfig | null;
  /** Plain boolean, not a function — a server-computed value crossing the RSC
   * boundary. See AGENTS.md on never passing a function from a Server to a
   * Client Component. */
  ingestionAvailable?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("domains");
  const [selectedDomains, setSelectedDomains] = useState<DomainKey[]>(initialSelectedDomains);
  const [walkIndex, setWalkIndex] = useState(0);
  const [faithConfig, setFaithConfig] = useState<FaithConfig | null>(initialFaithConfig);
  const [saveFailed, setSaveFailed] = useState(false);

  // RC-A (Ayman, 2026-09-19): "a lot of continue/next buttons in the onboarding
  // process are not smooth response feedback, they all have lag."
  // Every advance used to `await` a server action BEFORE calling setState, so
  // the screen sat still for a full round-trip on every single step. The UI now
  // moves immediately and the write goes into this queue behind it.
  //
  // It is a QUEUE, not fire-and-forget, and that matters: completeOnboarding()
  // validates `user_domains count >= 1` server-side and throws if it is zero,
  // so a fast user reaching the end before saveDomainSelection landed would hit
  // a hard error. Chaining keeps the writes in their original order and lets the
  // final step await everything still in flight.
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  function enqueueWrite(run: () => Promise<void>) {
    writeQueue.current = writeQueue.current.then(run).catch((err) => {
      // Swallow AFTER recording, or one failure poisons every later link in the
      // chain and the user gets stuck with no way forward and no explanation.
      console.error("onboarding: background save failed", err);
      setSaveFailed(true);
    });
  }

  function toggleDomain(key: DomainKey) {
    setSelectedDomains((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function startWalk() {
    // Resume at the first selected domain that doesn't already have
    // subdomains saved, rather than always restarting at index 0 — a
    // domain already answered in a prior session is skipped, not re-asked.
    const resumeIndex = selectedDomains.findIndex((d) => !domainsWithData.includes(d));
    setWalkIndex(resumeIndex === -1 ? Math.max(0, selectedDomains.length - 1) : resumeIndex);
    setPhase("walk");
    const domains = selectedDomains;
    enqueueWrite(() => saveDomainSelection(domains));
  }

  async function finishCurrentDomain(domainKey: DomainKey, subs: SubdomainInput[]) {
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

    enqueueWrite(() => saveSubdomains(domainKey, subs));

    if (walkIndex + 1 < selectedDomains.length) {
      // Intermediate step: move now, let the write land behind us.
      setWalkIndex(walkIndex + 1);
      return;
    }

    // Final step is the one place we genuinely must wait. completeOnboarding
    // reads what the queued writes produce and then redirects, so advancing
    // optimistically here would race our own persistence.
    setPhase("submitting");
    await writeQueue.current;
    await completeOnboarding(resolvedFaithConfig ?? {});
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
      {/* Moving the UI ahead of the write means a failure no longer surfaces as
          a stuck button — so it has to be said out loud, or the user finds out
          only when the final step rejects. */}
      {saveFailed ? (
        <p data-testid="onboarding-save-warning" className="mb-3 text-xs text-destructive">
          Some of your answers could not be saved. You can keep going — we will ask again for
          anything that did not stick.
        </p>
      ) : null}

      {phase === "domains" ? (
        <DomainSelectStep selected={selectedDomains} onToggle={toggleDomain} onNext={startWalk} />
      ) : null}

      {phase === "walk" && selectedDomains[walkIndex] === "personal_growth" ? (
        <PersonalGrowthStep
          ingestionAvailable={ingestionAvailable}
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
