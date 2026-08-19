export type CityRecord = {
  city: string;
  province: string;
  country: string;
  lat: number;
  lng: number;
  pop: number;
  timezone: string | null;
  /** US-only, matches city-timezones' `state_ansi` (e.g. "TX") — lets a
   * "city, state-abbreviation" query match the way it does for cities that
   * come from the bundled dataset itself. */
  stateAnsi?: string;
};

export type CityMatch = {
  city: string;
  province: string;
  country: string;
  lat: number;
  lng: number;
  timezone: string;
};

const MAX_RESULTS = 8;

/**
 * Prefer exact city-name matches; fall back to the broader city/province/
 * country search only when nothing matched exactly. Entries with no known
 * timezone in the dataset are unusable here and dropped. Ranked by
 * population — city-timezones' fallback search matches substrings anywhere
 * (a village can outrank the city the user meant), so relevance has to come
 * from us, not the package.
 */
export function rankCityMatches(exactMatches: CityRecord[], fallbackMatches: CityRecord[]): CityMatch[] {
  const source = exactMatches.length > 0 ? exactMatches : fallbackMatches;
  return source
    .filter((c): c is CityRecord & { timezone: string } => Boolean(c.timezone))
    .sort((a, b) => b.pop - a.pop)
    .slice(0, MAX_RESULTS)
    .map(({ city, province, country, lat, lng, timezone }) => ({ city, province, country, lat, lng, timezone }));
}

/** ~11km grid — coarse enough to treat the same real city as one match
 * across sources that format province/country differently (Open-Meteo:
 * "United States"; city-timezones: "United States of America"), tight
 * enough that two distinct same-named cities in different states don't
 * collide. */
function dedupeKey(c: Pick<CityRecord, "city" | "lat" | "lng">): string {
  return `${c.city.toLowerCase().trim()}|${c.lat.toFixed(1)}|${c.lng.toFixed(1)}`;
}

/**
 * Merges geocoded API results (primary, checked first) with local-dataset
 * exact matches (supplement, never the broad fallback search — see
 * localExactMatches's caller) into one list — used when the geocoding API
 * answered at all, as opposed to `rankCityMatches`'s pure-local path used
 * when it didn't. A collision between the two sources keeps the geocoded
 * record: fresher and more complete.
 *
 * Deliberately does NOT sort by population, unlike rankCityMatches.
 * Open-Meteo already returns results in real relevance order — confirmed
 * live: querying "Anna" puts Anna, Spain / Anna, Russia / Anna, Texas
 * ahead of Annaba, Algeria (pop 342,703 vs low four figures for the actual
 * Annas), exactly the disambiguation this feature exists to preserve. A
 * population sort here would bury every one of those under the one
 * unrelated big city that happens to share a name prefix. Local-exact
 * entries not already covered by the geocoded response are appended after,
 * in whatever order they came in — there's no relevance ranking to
 * preserve for a single supplemental override entry.
 */
export function combineCitySources(geocoded: CityRecord[], local: CityRecord[]): CityMatch[] {
  const seen = new Map<string, CityRecord & { timezone: string }>();
  for (const c of [...geocoded, ...local]) {
    if (!c.timezone) continue;
    const key = dedupeKey(c);
    if (!seen.has(key)) seen.set(key, { ...c, timezone: c.timezone });
  }
  return Array.from(seen.values())
    .slice(0, MAX_RESULTS)
    .map(({ city, province, country, lat, lng, timezone }) => ({ city, province, country, lat, lng, timezone }));
}

/**
 * Geolocation gives coordinates only, no city name. Reverse geocoding
 * against an *external* service is off the table (per spec), but a nearest-
 * city lookup over the same bundled dataset is offline reverse geocoding —
 * nearestCityLabel below does exactly that. This is the fallback for when
 * nothing in the dataset is close enough to be an honest guess.
 */
export function formatCoordinateLabel(lat: number, lng: number): string {
  const latLabel = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}`;
  const lngLabel = `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? "E" : "W"}`;
  return `${latLabel}, ${lngLabel}`;
}

export function formatCityLabel(c: { city: string; province: string; country: string }): string {
  return c.province ? `${c.city}, ${c.province}, ${c.country}` : `${c.city}, ${c.country}`;
}

const EARTH_RADIUS_KM = 6371;

/** Fast equirectangular approximation — fine at this dataset's scale (nearest-city, not routing). */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const avgLatRad = toRad((lat1 + lat2) / 2);
  const x = toRad(lng2 - lng1) * Math.cos(avgLatRad);
  const y = toRad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_KM;
}

const DEFAULT_MAX_DISTANCE_KM = 50;

/**
 * Offline reverse geocoding for a display label only — the caller's GPS
 * coordinates must still be what gets saved; this never substitutes the
 * matched city's own coordinates. Null past `maxDistanceKm` rather than
 * naming a city that's actually nowhere near the user — the dataset is
 * coarse (7k+ cities worldwide), so an unbounded "nearest" would eventually
 * name an absurdly distant city for mid-ocean or sparse-coverage coordinates.
 */
export function nearestCityLabel(
  lat: number,
  lng: number,
  cities: CityRecord[],
  maxDistanceKm: number = DEFAULT_MAX_DISTANCE_KM
): string | null {
  let best: CityRecord | null = null;
  let bestDist = Infinity;
  for (const c of cities) {
    const d = distanceKm(lat, lng, c.lat, c.lng);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (!best || bestDist > maxDistanceKm) return null;
  return formatCityLabel(best);
}
