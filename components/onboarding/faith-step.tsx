"use client";

import { useState } from "react";
import { Moon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { StepShell } from "./step-shell";
import type { FaithConfig } from "./types";

// Reuses the previous wizard's exact inputs (location, calc method, Asr
// madhab) verbatim per the Lead's spec — only their home moved, from a
// standalone step to Personal Growth -> Faith, asked only if Faith is kept.
export function FaithStep({
  onBack,
  onNext,
  progressTotal,
  progressIndex,
}: {
  onBack: () => void;
  onNext: (config: FaithConfig) => void;
  progressTotal: number;
  progressIndex: number;
}) {
  const [locationLabel, setLocationLabel] = useState("");
  const [prayerCalcMethod, setPrayerCalcMethod] = useState("MWL");
  const [asrMadhab, setAsrMadhab] = useState<"standard" | "hanafi">("standard");

  return (
    <StepShell
      stepId="personal_growth-faith"
      accent="deen"
      icon={Moon}
      eyebrow="Personal Growth · Faith"
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
            disabled={!locationLabel.trim()}
            onClick={() => onNext({ location_label: locationLabel, prayer_calc_method: prayerCalcMethod, asr_madhab: asrMadhab })}
          >
            Continue
          </Button>
        </div>
      }
    >
      <h1 className="text-xl font-semibold">Where are you?</h1>
      <p className="text-sm text-muted-foreground">Used to compute accurate prayer times for Deen tracking.</p>
      <Input
        data-testid="faith-location-input"
        value={locationLabel}
        onChange={(e) => setLocationLabel(e.target.value)}
        placeholder="City, State"
        autoFocus
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="faith-calc-method">Calculation method</Label>
        <select
          id="faith-calc-method"
          data-testid="faith-calc-method"
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
        <Label htmlFor="faith-asr-madhab">Asr madhab</Label>
        <select
          id="faith-asr-madhab"
          data-testid="faith-asr-madhab"
          value={asrMadhab}
          onChange={(e) => setAsrMadhab(e.target.value as "standard" | "hanafi")}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        >
          <option value="standard">Standard (Shafi/Maliki/Hanbali)</option>
          <option value="hanafi">Hanafi</option>
        </select>
      </div>
    </StepShell>
  );
}
