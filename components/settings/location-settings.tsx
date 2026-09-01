"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { searchCities, getNearestCityLabel } from "@/app/(app)/settings/location-actions";
import { formatCoordinateLabel, formatCityLabel, type CityMatch } from "@/lib/settings/location";
import { calculatePrayerTimes, type CalcMethod, type AsrMadhab, type PrayerTimes } from "@/lib/prayer-times/calculate";
import { getTimezoneOffsetMinutes, localDateString } from "@/lib/date-utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Location = { lat: number; lng: number; label: string; timezone: string };

const PRAYER_ORDER: (keyof PrayerTimes)[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const PRAYER_LABEL: Record<(typeof PRAYER_ORDER)[number], string> = {
  fajr: "Fajr",
  sunrise: "Sunrise",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

function formatTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

const GEOLOCATION_UNAVAILABLE_MESSAGE =
  "Couldn't access your location — search for your city below instead.";

export function LocationSettings({
  initial,
  prayerCalcMethod,
  asrMadhab,
}: {
  initial: { lat: number | null; lng: number | null; label: string | null; timezone: string | null };
  prayerCalcMethod: CalcMethod;
  asrMadhab: AsrMadhab;
}) {
  const [location, setLocation] = useState<Location | null>(
    initial.lat != null && initial.lng != null && initial.label && initial.timezone
      ? { lat: initial.lat, lng: initial.lng, label: initial.label, timezone: initial.timezone }
      : null
  );
  const [geoError, setGeoError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CityMatch[] | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [isSearching, startSearching] = useTransition();

  async function saveLocation(next: Location) {
    await updateProfile({
      location_lat: next.lat,
      location_lng: next.lng,
      location_label: next.label,
      timezone: next.timezone,
    });
    setLocation(next);
    setGeoError(null);
    setCandidates(null);
    setQuery("");
  }

  function handleUseCurrentLocation() {
    setGeoError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError(GEOLOCATION_UNAVAILABLE_MESSAGE);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        startSaving(async () => {
          // Offline reverse geocoding (nearest bundled city) for a human
          // label only — saveLocation above always persists these exact
          // GPS coordinates, never the matched city's centroid.
          const nearestLabel = await getNearestCityLabel(latitude, longitude);
          await saveLocation({
            lat: latitude,
            lng: longitude,
            label: nearestLabel ?? formatCoordinateLabel(latitude, longitude),
            timezone,
          });
        });
      },
      () => setGeoError(GEOLOCATION_UNAVAILABLE_MESSAGE)
    );
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    startSearching(async () => {
      const result = await searchCities(trimmed);
      setCandidates(result);
    });
  }

  function handleSelectCandidate(c: CityMatch) {
    startSaving(() => saveLocation({ lat: c.lat, lng: c.lng, label: formatCityLabel(c), timezone: c.timezone }));
  }

  // calculatePrayerTimes is timezone-naive by design — it reads whatever UTC
  // Y/M/D fields it's handed. computePrayerWindows (lib/prayer-times/windows.ts)
  // is normally the one safe entry point because it pre-anchors the date to
  // the local calendar day; calling calculatePrayerTimes directly with a raw
  // `new Date()` bypasses that and computes tomorrow's prayer times for any
  // UTC-negative timezone from evening onward local time. Mirror windows.ts's
  // anchor here instead of going through it, since this preview only needs
  // today's times for the currently-selected (possibly unsaved) location.
  const dayAnchor = location ? new Date(`${localDateString(new Date(), location.timezone)}T00:00:00Z`) : null;
  const prayerTimes =
    location && dayAnchor
      ? calculatePrayerTimes({
          date: dayAnchor,
          lat: location.lat,
          lng: location.lng,
          timezoneOffsetMinutes: getTimezoneOffsetMinutes(dayAnchor, location.timezone),
          calcMethod: prayerCalcMethod,
          asrMadhab,
        })
      : null;

  return (
    <div className="flex flex-col gap-4">
      {location ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
          <div>
            <p className="text-sm font-medium">{location.label}</p>
            <p className="text-xs text-muted-foreground">{location.timezone}</p>
          </div>
          {prayerTimes && (
            <dl className="grid grid-cols-5 gap-2 text-center text-xs">
              {PRAYER_ORDER.map((name) => (
                <div key={name} className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">{PRAYER_LABEL[name]}</dt>
                  <dd className="font-mono tabular-nums">{formatTime(prayerTimes[name], location.timezone)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No location set yet.</p>
      )}

      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" onClick={handleUseCurrentLocation} disabled={isSaving} className="self-start">
          Use my current location
        </Button>
        {geoError && <p className="text-xs text-muted-foreground">{geoError}</p>}
      </div>

      <form onSubmit={handleSearch} className="flex flex-col gap-2">
        <Label htmlFor="city-search">Search for a city</Label>
        <div className="flex gap-2">
          <Input
            id="city-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Chicago"
            className="max-w-xs"
          />
          <Button type="submit" variant="outline" disabled={isSearching}>
            Search
          </Button>
        </div>
      </form>

      {candidates && candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">No matches — try a different spelling.</p>
      )}
      {candidates && candidates.length > 0 && (
        <ul className="flex flex-col gap-1">
          {candidates.map((c) => (
            // lat/lng, not just city/province/country: real geocoding data
            // can have two distinct places with identical city+province+
            // country (confirmed live — Open-Meteo returns two different
            // towns both named "McKinney, Arkansas, United States" at
            // different coordinates for one query). A duplicate key across
            // renders left a stale <li> from a PRIOR search's result stuck
            // in the DOM after React failed to reconcile it correctly on
            // the next search — confirmed via a client-side log showing the
            // new candidates array was already clean, so this was a render
            // bug, not a stale-data bug.
            <li key={`${c.city}-${c.province}-${c.country}-${c.lat}-${c.lng}`}>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleSelectCandidate(c)}
                className="w-full rounded-md border border-border/40 px-3 py-2 text-left text-sm hover:bg-accent/40 disabled:opacity-50"
              >
                {formatCityLabel(c)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
