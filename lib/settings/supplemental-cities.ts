import type { CityRecord } from "./location";

/**
 * `city-timezones` (the bundled search dataset in location-actions.ts) ships
 * a fixed, curated ~7,300-city "world cities" list — not every populous US
 * city is in it. McKinney, TX (~207k pop, DFW metro) is absent even though
 * smaller Texas cities already in the dataset (e.g. Denton, Sherman) are
 * present; there's no version bump or config that adds it (npm's `city-timezones`
 * has stayed at its current data since 2026-05, confirmed via `npm view`).
 *
 * Swapping the whole dataset for a more complete one was considered and
 * rejected here: complete offline city lists either lack a timezone field
 * entirely (all-the-cities) or require a coordinate→timezone boundary lookup
 * (geo-tz, ~73MB unpacked) to get one accurately — both disproportionate to
 * fixing a handful of missing entries, and a per-state timezone guess would
 * be wrong for every state with a real internal time-zone split (TX itself
 * included: El Paso is Mountain, the rest Central).
 *
 * So: a short, hand-verified supplement for specific reported gaps, merged
 * into the search results in location-actions.ts. Add an entry here only
 * once a real search has been confirmed to come back empty for it.
 */
export const SUPPLEMENTAL_CITIES: CityRecord[] = [
  {
    city: "McKinney",
    province: "Texas",
    country: "United States of America",
    stateAnsi: "TX",
    lat: 33.1972,
    lng: -96.6398,
    pop: 207088,
    timezone: "America/Chicago",
  },
];
