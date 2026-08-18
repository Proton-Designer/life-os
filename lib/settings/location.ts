export type CityRecord = {
  city: string;
  province: string;
  country: string;
  lat: number;
  lng: number;
  pop: number;
  timezone: string | null;
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
