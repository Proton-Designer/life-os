"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/ui/panel";

export type SettingsFormData = {
  displayName: string;
  prayerCalcMethod: string;
  asrMadhab: "standard" | "hanafi";
  locationLabel: string;
  checkinWindowStart: string;
  checkinWindowEnd: string;
  checkinIntervalMinutes: number;
  pinLockEnabled: boolean;
};

export function SettingsForm({ initial, email }: { initial: SettingsFormData; email: string }) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(initial);
  const [pin, setPin] = useState("");

  function saveMain(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() =>
      updateProfile({
        display_name: form.displayName,
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
      <form onSubmit={saveMain} className="contents">
      <Panel id="profile" className="scroll-mt-24" title="Profile">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="email">Email</Label>
            <p id="email" className="text-sm text-muted-foreground">
              {email}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder="How Life OS should address you"
              className="max-w-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Theme: dark-first (the only theme for v1 — light mode is a future nice-to-have).
          </p>
        </div>
      </Panel>

      <Panel id="prayer" className="scroll-mt-24" title="Prayer">
        <div className="flex flex-col gap-4">
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
        </div>
      </Panel>

      <Panel id="checkins" className="scroll-mt-24" title="Check-ins">
        {/* flex-col below sm: 3 side-by-side inputs (2 native time pickers +
            a number field) genuinely don't fit in 390px — native time
            inputs have a browser-enforced minimum width flex can't shrink
            below. A real overflow bug, caught by the layout-overflow
            spec's determinism fix (2026-08-16), not by eyeballing. Kept
            unchanged through the Phase G restructure — re-verified live. */}
        <div className="flex flex-col gap-3 sm:flex-row">
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
      </Panel>

      <div className="self-start">
        <Button type="submit" disabled={isPending}>
          Save settings
        </Button>
      </div>
      </form>

      <Panel id="security" className="scroll-mt-24" title="Security">
        <div className="flex flex-col gap-4">
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
      </Panel>

      <Panel id="data" className="scroll-mt-24" title="Data">
        <a
          href="/settings/export"
          className="self-start rounded-md border border-border/40 px-4 py-2 text-sm hover:bg-accent/40"
        >
          Export my data (JSON)
        </a>
      </Panel>
    </div>
  );
}
