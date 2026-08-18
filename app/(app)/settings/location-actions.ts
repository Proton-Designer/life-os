"use server";

import { lookupViaCity, findFromCityStateProvince, cityMapping } from "city-timezones";
import { requireUser } from "@/lib/supabase/auth";
import { rankCityMatches, nearestCityLabel, type CityMatch } from "@/lib/settings/location";

// Split into its own module from actions.ts deliberately: onboarding/
// actions.ts imports updateProfile from that file, and a same-module import
// pulls in the whole module graph — city-timezones' ~1.4MB bundled dataset
// was leaking into onboarding's server bundle even though onboarding never
// calls either function below. Verified via `npm run build` + grepping
// .next/server for the chunk containing `cityMapping`: before this split it
// was referenced by both settings/page.js and onboarding/page.js; after,
// only settings/page.js references it.

// Bundled dataset (city-timezones), never an external geocoding API — no
// key to manage, no network dependency, no third party receiving the
// user's location. Runs as a Server Action so the ~2MB dataset never ships
// to the browser.
export async function searchCities(query: string): Promise<CityMatch[]> {
  await requireUser();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return rankCityMatches(lookupViaCity(trimmed), findFromCityStateProvince(trimmed));
}

// Nearest-city lookup over the same bundled dataset — offline reverse
// geocoding, no external API. The label only; the caller keeps the GPS
// coordinates it already has. Also why this stays a Server Action: the
// dataset (and the linear scan over it) must never ship to the browser.
export async function getNearestCityLabel(lat: number, lng: number): Promise<string | null> {
  await requireUser();
  return nearestCityLabel(lat, lng, cityMapping);
}
