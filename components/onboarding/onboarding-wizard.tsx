"use client";

import { useState } from "react";
import { completeOnboarding } from "@/app/(app)/onboarding/actions";
import { IosInstallPrompt } from "./ios-install-prompt";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
    if (typeof Notification !== "undefined") {
      try {
        await Notification.requestPermission();
      } catch {
        // Permission API unsupported or blocked — fall back silently to
        // the in-app badge fallback (Phase 14), not a blocking error here.
      }
    }
    finish();
  }

  if (step === 1) {
    return (
      <div className="flex flex-col gap-4">
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
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="flex flex-col gap-4">
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
      </div>
    );
  }

  if (isIosSafariNotStandalone()) {
    return <IosInstallPrompt onContinue={finish} />;
  }

  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}
