"use client";

import { useState } from "react";
import { MapPin, Moon, Bell, type LucideIcon } from "lucide-react";
import { completeOnboarding } from "@/app/(app)/onboarding/actions";
import { subscribeToPush } from "@/lib/pwa/push-subscribe";
import { IosInstallPrompt } from "./ios-install-prompt";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";

const STEP_ICON: Record<1 | 2 | 3, LucideIcon> = { 1: MapPin, 2: Moon, 3: Bell };
const STEP_ACCENT: Record<1 | 2 | 3, AccentToken> = { 1: "info", 2: "deen", 3: "info" };

function StepCard({ step, children }: { step: 1 | 2 | 3; children: React.ReactNode }) {
  const accent = STEP_ACCENT[step];
  return (
    <div
      data-testid="onboarding-card"
      className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-card p-6"
    >
      <div className="flex items-center justify-between">
        <IconChip icon={STEP_ICON[step]} accent={accent} />
        <span className="text-xs font-medium text-muted-foreground">Step {step} of 3</span>
      </div>
      {children}
      <div className="flex gap-1.5">
        {([1, 2, 3] as const).map((s) => (
          <div
            key={s}
            className="h-1 flex-1 rounded-full"
            style={{
              backgroundColor:
                s <= step
                  ? `var(${ACCENT_VAR[accent]})`
                  : "color-mix(in oklch, var(--foreground) 12%, transparent)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function isIosSafariNotStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const isStandalone = nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return isIos && !isStandalone;
}

export function OnboardingWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isPending, setIsPending] = useState(false);
  const [locationLabel, setLocationLabel] = useState("");
  const [prayerCalcMethod, setPrayerCalcMethod] = useState("MWL");
  const [asrMadhab, setAsrMadhab] = useState<"standard" | "hanafi">("standard");

  async function finish() {
    setIsPending(true);
    await completeOnboarding({
      location_label: locationLabel,
      prayer_calc_method: prayerCalcMethod,
      asr_madhab: asrMadhab,
    });
  }

  async function enableNotifications() {
    // Runs the FULL subscribe flow (permission -> service worker -> push
    // subscription -> POST to the server) here, not just the permission
    // ask — this used to only call Notification.requestPermission() and
    // rely on register-sw.tsx's background effect to pick up the grant on
    // a later page load, which is exactly the kind of silent gap that led
    // to zero devices ever registering in production. The result is
    // deliberately not surfaced here (a failure shouldn't block finishing
    // onboarding); it's logged, and Settings offers a retry with the real
    // reason visible.
    const result = await subscribeToPush();
    if (!result.ok) {
      console.error("[push] onboarding subscribe failed:", result.reason);
    }
    finish();
  }

  if (step === 1) {
    return (
      <StepCard step={1}>
        <h1 className="text-xl font-semibold">Where are you?</h1>
        <p className="text-sm text-muted-foreground">
          Used to compute accurate prayer times for Deen tracking.
        </p>
        <Input
          value={locationLabel}
          onChange={(e) => setLocationLabel(e.target.value)}
          placeholder="City, State"
          autoFocus
        />
        <Button
          type="button"
          onClick={() => setStep(2)}
          disabled={!locationLabel.trim()}
          className="self-start"
        >
          Next
        </Button>
      </StepCard>
    );
  }

  if (step === 2) {
    return (
      <StepCard step={2}>
        <h1 className="text-xl font-semibold">Prayer calculation</h1>
        <p className="text-sm text-muted-foreground">
          A sensible default is pre-filled — change it if you know you need to.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm" htmlFor="onb-method">
            Calculation method
          </label>
          <select
            id="onb-method"
            value={prayerCalcMethod}
            onChange={(e) => setPrayerCalcMethod(e.target.value)}
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          >
            <option value="MWL">Muslim World League</option>
            <option value="ISNA">ISNA</option>
            <option value="Karachi">Karachi</option>
            <option value="Egyptian">Egyptian</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm" htmlFor="onb-madhab">
            Asr madhab
          </label>
          <select
            id="onb-madhab"
            value={asrMadhab}
            onChange={(e) => setAsrMadhab(e.target.value as "standard" | "hanafi")}
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          >
            <option value="standard">Standard (Shafi/Maliki/Hanbali)</option>
            <option value="hanafi">Hanafi</option>
          </select>
        </div>
        <Button type="button" onClick={() => setStep(3)} className="self-start">
          Next
        </Button>
      </StepCard>
    );
  }

  if (isIosSafariNotStandalone()) {
    return <IosInstallPrompt onContinue={finish} />;
  }

  return (
    <StepCard step={3}>
      <h1 className="text-xl font-semibold">Enable notifications</h1>
      <p className="text-sm text-muted-foreground">
        Prayer times, check-in prompts, and deadline reminders all depend on this.
      </p>
      <div className="flex gap-2">
        <Button type="button" disabled={isPending} onClick={enableNotifications}>
          Enable notifications
        </Button>
        <Button type="button" disabled={isPending} variant="outline" onClick={finish}>
          Skip for now
        </Button>
      </div>
    </StepCard>
  );
}
