"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export type SettingsFormData = {
  prayerCalcMethod: string;
  asrMadhab: "standard" | "hanafi";
  locationLabel: string;
  checkinWindowStart: string;
  checkinWindowEnd: string;
  checkinIntervalMinutes: number;
  pinLockEnabled: boolean;
};

export function SettingsForm({ initial }: { initial: SettingsFormData }) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(initial);
  const [pin, setPin] = useState("");

  function saveMain(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() =>
      updateProfile({
        prayer_calc_method: form.prayerCalcMethod,
        asr_madhab: form.asrMadhab,
        location_label: form.locationLabel,
        checkin_window_start: form.checkinWindowStart,
        checkin_window_end: form.checkinWindowEnd,
        checkin_interval_minutes: form.checkinIntervalMinutes,
      })
    );
  }

  function togglePinLock(enabled: boolean) {
    setForm((f) => ({ ...f, pinLockEnabled: enabled }));
    startTransition(() =>
      updateProfile({ pin_lock_enabled: enabled, ...(enabled ? {} : { pin: undefined, pin_hash: null }) })
    );
  }

  function savePin(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) return;
    startTransition(async () => {
      await updateProfile({ pin });
      setPin("");
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={saveMain} className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-card p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Prayer &amp; location</h2>
        <div className="flex flex-col gap-1">
          <Label htmlFor="prayer-method">Calculation method</Label>
          <select
            id="prayer-method"
            value={form.prayerCalcMethod}
            onChange={(e) => setForm((f) => ({ ...f, prayerCalcMethod: e.target.value }))}
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          >
            <option value="MWL">Muslim World League</option>
            <option value="ISNA">ISNA</option>
            <option value="Karachi">Karachi</option>
            <option value="Egyptian">Egyptian</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="asr-madhab">Asr madhab</Label>
          <select
            id="asr-madhab"
            value={form.asrMadhab}
            onChange={(e) => setForm((f) => ({ ...f, asrMadhab: e.target.value as "standard" | "hanafi" }))}
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          >
            <option value="standard">Standard (Shafi/Maliki/Hanbali)</option>
            <option value="hanafi">Hanafi</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="location">Location (city)</Label>
          <Input
            id="location"
            value={form.locationLabel}
            onChange={(e) => setForm((f) => ({ ...f, locationLabel: e.target.value }))}
            placeholder="e.g. Chicago, IL"
          />
        </div>

        <h2 className="mt-2 text-sm font-semibold text-muted-foreground">Check-ins</h2>
        <div className="flex gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="window-start">Window start</Label>
            <Input
              id="window-start"
              type="time"
              value={form.checkinWindowStart}
              onChange={(e) => setForm((f) => ({ ...f, checkinWindowStart: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="window-end">Window end</Label>
            <Input
              id="window-end"
              type="time"
              value={form.checkinWindowEnd}
              onChange={(e) => setForm((f) => ({ ...f, checkinWindowEnd: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="interval">Interval (min)</Label>
            <Input
              id="interval"
              type="number"
              min={15}
              step={15}
              value={form.checkinIntervalMinutes}
              onChange={(e) =>
                setForm((f) => ({ ...f, checkinIntervalMinutes: Number(e.target.value) }))
              }
              className="w-24"
            />
          </div>
        </div>

        <Button type="submit" disabled={isPending} className="self-start">
          Save settings
        </Button>
      </form>

      <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-card p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">App lock</h2>
        <div className="flex items-center gap-2">
          <Switch
            id="pin-lock"
            checked={form.pinLockEnabled}
            disabled={isPending}
            onCheckedChange={togglePinLock}
          />
          <Label htmlFor="pin-lock" className="text-sm">
            Require a PIN to open the app (default off)
          </Label>
        </div>
        {form.pinLockEnabled && (
          <form onSubmit={savePin} className="flex gap-2">
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="New PIN"
              className="w-32"
            />
            <Button type="submit" disabled={isPending} variant="outline">
              Set PIN
            </Button>
          </form>
        )}
      </div>

      <div className="rounded-2xl border border-border/40 bg-card p-4 text-sm text-muted-foreground">
        Theme: dark-first (the only theme for v1 — light mode is a future nice-to-have).
      </div>

      <a
        href="/settings/export"
        className="self-start rounded-md border border-border/40 px-4 py-2 text-sm hover:bg-accent/40"
      >
        Export my data (JSON)
      </a>
    </div>
  );
}
