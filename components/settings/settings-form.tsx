"use client";

import { useState, useTransition } from "react";
import { LogOut } from "lucide-react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { signOut } from "@/app/(app)/actions";
import { TimezoneSettings } from "@/components/settings/timezone-settings";
import { LocationSettings } from "@/components/settings/location-settings";
import { DeleteAccountSection } from "@/components/settings/delete-account-section";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/ui/panel";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";
import { TimeField12 } from "@/components/ui/time-field-12";

export type SettingsFormData = {
  displayName: string;
  prayerCalcMethod: CalcMethod;
  asrMadhab: AsrMadhab;
  location: { lat: number | null; lng: number | null; label: string | null; timezone: string | null };
  checkinWindowStart: string;
  checkinWindowEnd: string;
  pinLockEnabled: boolean;
};

export function SettingsForm({
  initial,
  email,
  deenMode,
  slots,
}: {
  initial: SettingsFormData;
  email: string;
  /** Deen Mode (profiles.deen_mode). OFF hides the Prayer panel and the prayer-time preview; stored prayer settings are left untouched. */
  deenMode: boolean;
  /** Server-rendered panels interleaved at the right place so the page order matches the section tabs. */
  slots?: { afterProfile?: React.ReactNode; afterCheckins?: React.ReactNode };
}) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(initial);
  const [pin, setPin] = useState("");

  function saveMain(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() =>
      updateProfile({
        display_name: form.displayName,
        // Prayer fields are only submitted while their controls are visible:
        // with Deen Mode OFF they must never be overwritten (a profile with
        // no row yet would otherwise be saved with the form's defaults).
        ...(deenMode ? { prayer_calc_method: form.prayerCalcMethod, asr_madhab: form.asrMadhab } : {}),
        checkin_window_start: form.checkinWindowStart,
        checkin_window_end: form.checkinWindowEnd,
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
      {/* THEME/SETTINGS-ORDER: sections render in the SAME order as the left tab list
          (page.tsx SECTIONS): Profile, Appearance, Features, Prayer, Location, Check-ins,
          Notifications, AI, Canvas, RescueTime, Whoop, Connectors, Webhooks, Security, Data.
          The Profile / Prayer / Check-ins fields are no longer contiguous, so they submit
          through ONE empty form by id (`form="settings-main-form"`); panels in the slots
          below carry their own forms, which therefore can never be nested inside it. */}
      <form id="settings-main-form" onSubmit={saveMain} />
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
            <Input form="settings-main-form"
              id="display-name"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder="How Life OS should address you"
              className="max-w-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Theme: dark-first (still the only mode — light mode is a future nice-to-have). Pick an accent preset
            below in Appearance.
          </p>
        </div>
      </Panel>

      {slots?.afterProfile}

      {deenMode && (
      <Panel id="prayer" className="scroll-mt-24" title="Prayer">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="prayer-method">Calculation method</Label>
            <select form="settings-main-form"
              id="prayer-method"
              value={form.prayerCalcMethod}
              onChange={(e) => setForm((f) => ({ ...f, prayerCalcMethod: e.target.value as CalcMethod }))}
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
            <select form="settings-main-form"
              id="asr-madhab"
              value={form.asrMadhab}
              onChange={(e) => setForm((f) => ({ ...f, asrMadhab: e.target.value as "standard" | "hanafi" }))}
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            >
              <option value="standard">Standard (Shafi/Maliki/Hanbali)</option>
              <option value="hanafi">Hanafi</option>
            </select>
          </div>
        </div>
      </Panel>
      )}

      {/* Location saves itself atomically the moment a place is resolved
          (geolocation success or a candidate pick) -- it never waits on "Save
          settings". */}
      {/* Location (lat/lng/label) is consumed only by prayer features, so it
          hides with Deen Mode OFF. Timezone is app-wide and used to be set
          only inside LocationSettings -- it gets its own panel in that case. */}
      {deenMode ? (
        <Panel id="location" className="scroll-mt-24" title="Location">
          <LocationSettings
            initial={form.location}
            prayerCalcMethod={form.prayerCalcMethod}
            asrMadhab={form.asrMadhab}
          />
        </Panel>
      ) : (
        <Panel id="timezone" className="scroll-mt-24" title="Timezone">
          <TimezoneSettings initial={form.location.timezone} />
        </Panel>
      )}

      <Panel id="checkins" className="scroll-mt-24" title="Check-ins">
        {/* These two bounds are the ONLY check-in settings, and that is
            deliberate. An "Interval (min)" field used to sit beside them,
            writing profiles.checkin_interval_minutes -- a column nothing
            has read since the point-sample check-in model was replaced
            (2026-08-19). The live model steps fixed windows of
            ALLOCATION_WINDOW_MINUTES (lib/checkins/schedule.ts), and the
            allocation bar's TOTAL_MINUTES (lib/checkins/allocation.ts) is
            hardcoded to the same 120 in every surface that renders it.
            The control persisted, round-tripped, and changed nothing --
            worse than a silent dead column, because it was labelled and
            interactive. Removed 2026-09-10 rather than wired: making the
            interval real means decoupling those two constants, which is a
            feature to be chosen on its merits, not smuggled in as a fix.
            The bounds themselves ARE live -- schedule.ts reuses them as
            the wake/sleep range, as its own comment says.

            flex-col below sm: side-by-side native time pickers genuinely
            don't fit in 390px -- they have a browser-enforced minimum
            width flex can't shrink below. A real overflow bug, caught by
            the layout-overflow spec's determinism fix (2026-08-16), not by
            eyeballing. Kept unchanged through the Phase G restructure --
            re-verified live. */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-col gap-1">
            <Label htmlFor="window-start">Window start</Label>
            <TimeField12 id="window-start" aria-label="Window start" defaultOpenValue="09:00" value={form.checkinWindowStart} onChange={(v) => setForm((f) => ({ ...f, checkinWindowStart: v }))} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="window-end">Window end</Label>
            <TimeField12 id="window-end" aria-label="Window end" defaultOpenValue="21:00" value={form.checkinWindowEnd} onChange={(v) => setForm((f) => ({ ...f, checkinWindowEnd: v }))} />
          </div>
        </div>
      </Panel>

      <div className="self-start">
        <Button type="submit" form="settings-main-form" disabled={isPending}>
          Save settings
        </Button>
      </div>

      {slots?.afterCheckins}

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
          {/* Mobile's only remaining path to sign out, since batch 3 item 2
              removed the hamburger drawer that used to hold AccountBlock.
              The lg/xl sidebar still has its own AccountBlock popover —
              this is additive, not a replacement. */}
          <form action={signOut} className="border-t border-border/40 pt-4">
            <Button type="submit" variant="outline" className="text-destructive hover:text-destructive">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Button>
          </form>
        </div>
      </Panel>

      <Panel id="data" className="scroll-mt-24" title="Data">
        <div className="flex flex-col gap-4">
          <a
            href="/settings/export"
            className="self-start rounded-md border border-border/40 px-4 py-2 text-sm hover:bg-accent/40"
          >
            Export my data (JSON)
          </a>
          {/* #32: account deletion, the other half of this panel's job —
              export what you have, or remove all of it. */}
          <DeleteAccountSection />
        </div>
      </Panel>
    </div>
  );
}
