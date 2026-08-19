import type { CityRecord } from "./location";

const OPEN_METEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const TIMEOUT_MS = 2500;
const RESULT_COUNT = 8;

type OpenMeteoResult = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
};

/**
 * Geocodes against Open-Meteo (docs/superpowers/specs/2026-08-18-location-search-geocoding.md):
 * free, no API key, and it returns the IANA `timezone` directly — the one
 * thing that made every richer *offline* city list disproportionate (they
 * need a ~73MB coordinate-to-boundary lookup to get a timezone at all, and
 * a per-state guess would be wrong for every state with a real internal
 * split, Texas included).
 *
 * Returns `null` — never `[]` — on any failure (network error, non-2xx,
 * timeout) so `searchCities` can tell "the API answered with zero matches"
 * (a real empty result) apart from "the API didn't answer" (fall back to
 * the bundled dataset). ~2.5s timeout: this app is an unpaid guest on a
 * free service with no key, and a hanging third party must not hang the
 * settings form.
 */
export async function fetchGeocodedCities(query: string): Promise<CityRecord[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${OPEN_METEO_URL}?name=${encodeURIComponent(query)}&count=${RESULT_COUNT}&language=en&format=json`;
    // cache: "no-store" is load-bearing, not defensive boilerplate: Next's
    // patched server-side fetch() applies its own Data Cache to plain fetch
    // calls unless told not to, and this call sat inside a Server Action
    // without it during initial verification — confirmed live, reproduced
    // with plain Node (outside Next entirely) returning the correct
    // per-query results every time, then reproduced again through the real
    // Settings UI showing a fixed, stale set of prior-query results bleeding
    // into unrelated later searches (e.g. "McKinney, Arkansas" persisting
    // into "Prosper"/"Melissa"/"Anna" results). Every one of these searches
    // must be a fresh network call — a wrong-but-cached result here is a
    // wrong-but-cached prayer time.
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: OpenMeteoResult[] };
    return (data.results ?? []).map((r) => ({
      city: r.name,
      province: r.admin1 ?? "",
      country: r.country ?? "",
      lat: r.latitude,
      lng: r.longitude,
      pop: r.population ?? 0,
      timezone: r.timezone ?? null,
    }));
  } catch {
    // Network error, malformed JSON, or the AbortError from the timeout
    // above — all the same "the API didn't answer" case to the caller.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
