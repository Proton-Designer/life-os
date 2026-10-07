"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Timezone on its own. Every "what day is it" decision in the app reads
 * profiles.timezone (localDateString everywhere), but until Deen Mode it was
 * only editable inside LocationSettings -- which is prayer-only and hidden
 * when Deen Mode is OFF. This keeps timezone editable in that state. Writes
 * ONLY `timezone`; location_lat/lng/label are never touched.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// The zone list is whatever THIS runtime's Intl knows, and Node (the server) and the browser do NOT agree (the server listed
// America/Coyhaique where Chrome listed America/Creston). Rendering it on the server therefore made /settings fail to hydrate
// on every load ("Hydration failed because the server rendered text didn't match the client"), and React discarded and
// rebuilt the whole page on the client. So the server, and the hydration pass, render only the CURRENT zone; the full list
// appears right after hydration (useSyncExternalStore: its server snapshot is used while hydrating, then the client one).
const subscribeNever = () => () => {};
const NO_ZONES: string[] = [];
let browserZones: string[] | null = null;
function getBrowserZones(): string[] {
  if (browserZones === null) {
    try {
      browserZones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      browserZones = [];
    }
  }
  return browserZones;
}
function getServerZones(): string[] {
  return NO_ZONES;
}

export function TimezoneSettings({ initial }: { initial: string | null }) {
  const [timezone, setTimezone] = useState<string | null>(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const known = useSyncExternalStore(subscribeNever, getBrowserZones, getServerZones);
  const zones = timezone && !known.includes(timezone) ? [timezone, ...known] : known;

  function save(next: string) {
    if (!isValidTimezone(next)) {
      setError("That isn't a valid timezone.");
      return;
    }
    setError(null);
    const previous = timezone;
    setTimezone(next); // optimistic
    startTransition(async () => {
      try {
        await updateProfile({ timezone: next });
      } catch (e) {
        setTimezone(previous);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Decides when your day starts and ends everywhere in the app.
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="timezone-select">Timezone</Label>
        <select
          id="timezone-select"
          value={timezone ?? ""}
          disabled={isPending}
          onChange={(e) => save(e.target.value)}
          className="max-w-xs rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        >
          {timezone === null && <option value="">Not set</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        className="self-start"
        onClick={() => save(Intl.DateTimeFormat().resolvedOptions().timeZone)}
      >
        Use this device&apos;s timezone
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
