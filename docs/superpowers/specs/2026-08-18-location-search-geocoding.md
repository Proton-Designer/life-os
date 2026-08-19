# Settings location: replace the bundled city list with real geocoding

**Status:** design, approved for build — queue behind Part B/C of the prefetch fix
**Author:** Opus Lead, 2026-08-18

## Why this exists

Ayman reported tonight that Settings → Location returned nothing for "McKinney" or "McKinney, TX".
Engineer 1 root-caused it correctly: `city-timezones` ships a fixed ~7,300-city list and McKinney
(pop ~207k, DFW metro) simply isn't in it. Their fix — `lib/settings/supplemental-cities.ts`, a
hand-verified override merged into search — is correct, the coordinates and timezone check out, and it
unblocked him. **Keep it.**

But it fixes McKinney and nothing else. The dataset is missing an unknown number of cities, the
failure is silent (empty results), and the consequence is severe and non-obvious: **no location means
no prayer times, and a wrong location means wrong prayer times all day, every day.** Prayer-time
accuracy is a hard requirement in this product. A city list that fails closed and gets patched one
entry at a time is not an acceptable foundation for it.

Adding entries by hand also has a bad shape: it only ever fixes cities *after* someone hits the gap
and reports it. Ayman is the only user, so "reported" means "his prayer times were already wrong or
unset for some period."

## The change

**Primary: geocode server-side against Open-Meteo's geocoding API.** Verified working tonight:

```
GET https://geocoding-api.open-meteo.com/v1/search?name=<q>&count=<n>&language=en&format=json
```

Returns `name`, `admin1` (state/province), `country_code`, `latitude`, `longitude`, **`timezone`**,
and `population` per result. Free, **no API key**, and it returns the IANA timezone directly — which is
the exact thing that made every richer offline dataset disproportionate (they need a ~73MB
coordinate→boundary lookup to get one).

Coverage measured against the gap that started this, all resolving correctly with the right timezone:
McKinney TX (162k), Frisco TX (154k), Prosper TX (16k), Melissa TX (7.4k).

This already lives in a Server Action, so the call is server-side: no API key exposure, no CORS, no
client bundle cost.

**Fallback: keep the bundled dataset and `SUPPLEMENTAL_CITIES` exactly as they are.** If the API
errors, times out, or returns nothing, fall through to the existing local search. Do **not** remove
`city-timezones` in this change — a network dependency in a core setup flow needs a floor under it,
and this app is an installed PWA that can be opened offline.

## Requirements

- **Short timeout, ~2.5s.** A hanging third party must not hang the settings form; on timeout, fall
  back and let the user proceed.
- **Disambiguation is mandatory, not cosmetic.** "Anna" returns Valencia, Spain and Voronezh, Russia
  ahead of Anna, Texas; "Celina" returns Ohio before Texas. Every result must show state/province and
  country so the user picks the right one. Verify the existing result UI already does this — it has
  `province`/`stateAnsi`/`country` on `CityRecord` — and fix it if it doesn't. **Silently taking the
  first result would be worse than the current bug**, because it fails *open* with a plausible wrong
  answer instead of failing closed with no answer.
- **Map the API response into the existing `CityRecord` shape** rather than introducing a second type.
  Everything downstream — the Server Action, the profile write, `computePrayerWindows` — should be
  untouched by this.
- **Dedupe across sources.** If the API and the local dataset both return the same city, show it once.
- **Don't fire per keystroke.** Check how search is currently triggered; if it's per-keystroke, debounce
  to ~300ms or move it to explicit submit. We are a guest on a free service with no key.
- No secrets, no new env vars, no key.

## Verify

1. Live in a browser: "McKinney", "McKinney, TX", "Prosper", "Melissa" all resolve, persist through a
   reload, and produce plausible prayer times for the chosen coordinates.
2. An ambiguous query ("Anna", "Celina", "Springfield") shows enough state/country to disambiguate, and
   picking the non-first result stores the right coordinates.
3. Fallback proven, not assumed: block the API host (or point the base URL at an unroutable address)
   and confirm the local dataset still answers and the form still works.
4. Timeout path proven the same way — a hung request must fall back inside ~2.5s, not spin.
5. A city in neither source fails with a clear "no match" message, never a silent empty box.
6. `tsc`, `eslint`, full `vitest` (mock the fetch — no network in unit tests), `next build` clean.
7. Confirm no bundle-size regression on the settings or onboarding routes — `city-timezones` has leaked
   into the wrong bundle once before (fixed 2026-08-18 by splitting `location-actions.ts`); re-check
   that split still holds.
