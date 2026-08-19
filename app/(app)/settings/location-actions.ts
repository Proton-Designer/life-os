"use server";

import { lookupViaCity, findFromCityStateProvince, cityMapping } from "city-timezones";
import { requireUser } from "@/lib/supabase/auth";
import {
  rankCityMatches,
  combineCitySources,
  nearestCityLabel,
  type CityMatch,
  type CityRecord,
} from "@/lib/settings/location";
import { SUPPLEMENTAL_CITIES } from "@/lib/settings/supplemental-cities";
import { fetchGeocodedCities } from "@/lib/settings/geocode";

// Same matching rules city-timezones itself uses (exact city-name equality;
// partial match against city/province/country) — see supplemental-cities.ts
// for why this list exists instead of just being part of exactMatches.
function supplementalExactMatches(query: string): CityRecord[] {
  return SUPPLEMENTAL_CITIES.filter((c) => c.city.toLowerCase() === query.toLowerCase());
}

function supplementalPartialMatches(query: string): CityRecord[] {
  const terms = query.toLowerCase().split(" ");
  return SUPPLEMENTAL_CITIES.filter((c) => {
    const haystack = [c.city, c.stateAnsi ?? "", c.province, c.country].join(",").toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

function localExactMatches(trimmed: string): CityRecord[] {
  return [...lookupViaCity(trimmed), ...supplementalExactMatches(trimmed)];
}

// Same exact-else-broader rule rankCityMatches applies on its own: prefer an
// exact city-name match, fall back to the wider city/province/country search
// only when nothing matched exactly.
function resolveLocalMatches(trimmed: string): CityRecord[] {
  const exact = localExactMatches(trimmed);
  if (exact.length > 0) return exact;
  return [...findFromCityStateProvince(trimmed), ...supplementalPartialMatches(trimmed)];
}

// Split into its own module from actions.ts deliberately: onboarding/
// actions.ts imports updateProfile from that file, and a same-module import
// pulls in the whole module graph — city-timezones' ~1.4MB bundled dataset
// was leaking into onboarding's server bundle even though onboarding never
// calls either function below. Verified via `npm run build` + grepping
// .next/server for the chunk containing `cityMapping`: before this split it
// was referenced by both settings/page.js and onboarding/page.js; after,
// only settings/page.js references it.

// Geocodes against Open-Meteo first (real, near-complete city coverage with
// a real IANA timezone per result — see lib/settings/geocode.ts) and falls
// back to the bundled city-timezones dataset only when the API genuinely
// didn't answer (network error, non-2xx, ~2.5s timeout — never on a
// legitimate zero-match response, which is a real answer, not a failure).
// docs/superpowers/specs/2026-08-18-location-search-geocoding.md: the
// bundled dataset stays as a floor under a network dependency in a core
// setup flow, since this app is an installed PWA that can be opened
// offline. Runs as a Server Action either way, so neither the ~2MB bundled
// dataset nor the geocoding call ever reaches the browser.
export async function searchCities(query: string): Promise<CityMatch[]> {
  await requireUser();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const geocoded = await fetchGeocodedCities(trimmed);
  if (geocoded === null) {
    // The API didn't answer — the bundled dataset is the whole story here,
    // same shape as before this change. resolveLocalMatches already applied
    // the exact-else-fallback rule, so there's nothing left for
    // rankCityMatches's own fallback argument to do.
    return rankCityMatches(resolveLocalMatches(trimmed), []);
  }
  // Only an EXACT local match, never the broad city/province/country
  // substring search, gets merged in here. That broader search is a real
  // fallback for when the API is down (the branch above), but merging it in
  // *alongside a working API* actively hurts disambiguation: it matches
  // substrings anywhere (confirmed live — searching "Anna" pulled in
  // "Annaba, Algeria," pop 355k, via a bare substring match), and
  // combineCitySources ranks by population, so that noise outranked and
  // buried the API's own correctly-disambiguated Anna, Spain / Anna, Russia
  // / Anna, Texas results entirely off the visible list.
  return combineCitySources(geocoded, localExactMatches(trimmed));
}

// Nearest-city lookup over the same bundled dataset — offline reverse
// geocoding, no external API. The label only; the caller keeps the GPS
// coordinates it already has. Also why this stays a Server Action: the
// dataset (and the linear scan over it) must never ship to the browser.
export async function getNearestCityLabel(lat: number, lng: number): Promise<string | null> {
  await requireUser();
  return nearestCityLabel(lat, lng, cityMapping);
}
