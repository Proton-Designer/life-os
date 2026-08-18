# Prayer time intelligence, sunnah tracking, and real location

**Status:** design, approved for build
**Author:** Opus Lead, 2026-08-17
**Requested by:** Ayman, 2026-08-17 23:07 CDT

## The ask

1. The app should know when each prayer's time **starts and ends**, per the user's location, timezone,
   and school of thought, and track how that shifts every day.
2. A prayer not logged while its window was still valid should **become missed automatically** — but
   remain editable in Deen, because "prayed it, forgot to log it" is the common case.
3. A missed prayer should **fall into the Qada backlog automatically**.
4. Each fard prayer should expose its **sunnah prayers** through a dropdown or similar.
5. Settings' location field is free text that resolves to nothing — it must produce a **real place
   with real coordinates and a real timezone**.

A Deen layout restructure follows this work as a separate, collaborative phase with Ayman.

## The core problem today

`calculatePrayerTimes` returns five **instants**, not windows. Nothing in the app knows when a prayer
stops being valid, so `status` only ever changes when the user taps something, `"pending"` means "not
tapped" rather than "due now," and `qada_owed` is a hand-cranked integer with no connection to any
prayer that was actually missed. Meanwhile `profiles.location_lat/lng` are never written by Settings
at all — only `location_label`, a string that resolves to nothing. **Prayer times cannot be correct
for a user who set their location through Settings**, because that path never captures coordinates.

## Phase 1 — Prayer windows

### `lib/prayer-times/calculate.ts` (MODIFIED)

Add `sunrise` to `PrayerTimes`. It is the same `hourAngle(MAGHRIB_ANGLE, …)` already used for maghrib,
applied as `dhuhrClock - sunriseHA` instead of `+`. Fajr's window ends at sunrise, so this is
required, not decorative. Existing callers destructure by name and are unaffected.

### `lib/prayer-times/windows.ts` (NEW)

```ts
export type PrayerWindow = { start: Date; end: Date };

export function computePrayerWindows(opts: {
  date: Date; lat: number; lng: number; timezoneOffsetMinutes: number;
  calcMethod: CalcMethod; asrMadhab: AsrMadhab;
}): Record<PrayerName, PrayerWindow>;
```

| Prayer | Starts | Ends |
|---|---|---|
| Fajr | true dawn | sunrise |
| Dhuhr | zawal | Asr |
| Asr | Asr | Maghrib (sunset) |
| Maghrib | sunset | Isha |
| Isha | Isha | **next day's Fajr** |

Isha ends at the *next* day's Fajr, which means `computePrayerWindows` must compute tomorrow's times
too. This is deliberate: the majority fiqh position is that Isha's time extends until true dawn, and
the stricter "Islamic midnight" bound is the *preferred* window, not the valid one. **We must never
mark a prayer missed while it is still valid**, so the outer bound governs auto-miss. Exposing the
preferred bound as a UI hint is fine later; it must not drive status.

Notes for the implementer:
- Timezone offset must be computed for **each** date, not reused across the day boundary — a DST
  transition between today and tomorrow otherwise shifts Isha's end by an hour. Call
  `getTimezoneOffsetMinutes` per date.
- High latitudes can produce a non-existent Fajr or Isha (the `hourAngle` `cosH` clamp fires). Detect
  the clamp case and return `null` for that window rather than a silently wrong `Date`. A `null`
  window means "cannot determine" and must **never** derive a missed status. Ayman is not at high
  latitude; this is about not writing a function that lies.
- Pure and fully unit-tested: a known city/date fixture with hand-checked values, ordering invariants
  (`fajr.end === sunrise`, each window's `end` equals the next window's `start`), the Hanafi/standard
  Asr split shifting Asr's start and Dhuhr's end together, and the DST-boundary case.

## Phase 2 — Derived status and the Qada backlog

### The decision: derive at read time, never write on read

`lib/deen/prayer-status.ts` (NEW):

```ts
export type EffectivePrayerStatus = "upcoming" | "pending" | "on_time" | "qada" | "missed";

export function effectivePrayerStatus(
  stored: "on_time" | "qada" | "missed" | null,
  window: PrayerWindow | null,
  now: Date,
): EffectivePrayerStatus;
```

- A **stored status always wins.** The user's own record is the truth; derivation only fills silence.
- No stored row and `now >= window.end` → `missed`.
- No stored row and `now >= window.start` → `pending` (actionable right now).
- No stored row and `now < window.start` → `upcoming` (not yet due).
- `window === null` → `pending`, never `missed`.

`upcoming` is **display-only and never persisted.** The `prayers.status` column keeps its existing
three values.

Why derivation rather than a scheduled job that writes `missed` rows: it needs no cron, cannot race a
user's tap, is correct the instant a window closes rather than at the next job tick, and adds no
dependency on infrastructure this project has never successfully run in production (the
`dispatch-notifications` function has never delivered). A nightly job to *freeze* history remains
available later; it is not needed for correctness and is out of scope here.

**The floor.** Derived-missed must not run backwards forever, or every prayer since the dawn of time
becomes a miss. Floor the derivation at `profiles.created_at`'s local date. Nothing before the
account existed can be derived as missed. Pass the floor in explicitly; do not read it inside the
pure function.

### Ripple — every consumer of raw `status` must go through the derivation

This is the part to be careful with. `"absent"` currently means `"pending"` in four places, and after
this change it can mean `missed` or `upcoming`:

1. `app/(app)/deen/page.tsx` — `todayStatusFor`
2. `lib/home/get-priority-items.ts` — a prayer whose window has closed must **stop** appearing as an
   actionable item on Home. This is a real improvement to the new "Now" module: it will show the
   prayer that is actually due now, not all five from midnight.
3. `lib/home/get-domain-snapshots.ts` — `nextPendingPrayer`, and the deen pulse fraction
4. `lib/deen/prayer-consistency.ts` and `lib/deen/prayer-streak.ts` — the 30-day grid and the streak

Rather than patching each, add one shared helper that takes the raw rows plus the profile and returns
resolved statuses per date, and route all five through it. Streak semantics must not silently change:
today is still excluded from breaking a streak until its windows have actually closed.

### Qada backlog

Replace the opaque integer with a real, itemized backlog:

- **Derived backlog** = every `(date, prayer)` since the floor whose effective status is `missed`.
- **Legacy backlog** = `profiles.qada_owed`, which stays exactly as it is — it represents pre-app debt
  and must not be destroyed or auto-recomputed. Keep `adjustQadaBacklog` for editing it.
- **Displayed total** = legacy + derived count.
- **Making one up**: `markPrayer(date, prayer, "qada")` on that specific past date. It already accepts
  a date, so no action change is needed — but the UI must offer it, which today it does not.

`lib/deen/qada-backlog.ts` (NEW): given resolved statuses, return the itemized list (most recent
first, with date and prayer name) plus the counts. `lib/deen/qada-progress.ts`'s existing
catch-up/miss counters stay and keep feeding the KPI caption.

A minimal backlog list UI ships in this phase — the oldest N outstanding prayers, each with a
"Mark as qada" action. Its final placement is part of the layout restructure that follows; build it
as a self-contained component so moving it is free.

## Phase 3 — Sunnah prayers

### Migration `017_sunnah_logs.sql` (NEW)

```sql
create table public.sunnah_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  prayer_name text not null,
  slot text not null,
  completed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, date, prayer_name, slot)
);
alter table public.sunnah_logs enable row level security;
```

RLS policies matching the existing tables' shape (`user_id = auth.uid()` for select/insert/update/
delete). Copy the exact policy form from an existing table's definition rather than inventing one —
**verify RLS is actually enabled and enforced before reporting done**, with a real cross-user read
attempt, not by reading the SQL back.

**Applying it is a blocker to flag, not to work around.** Migration 016's own header records that
Supabase MCP was unauthenticated and it had to go through `psql` directly, leaving Supabase's
migration history out of sync with the repo. Do not repeat that silently: write the file, attempt the
apply, and if auth is unavailable, report it to me — Ayman will need to supply access.

### `lib/deen/sunnah.ts` (NEW)

The rawatib, as data:

| Prayer | Slot | Rak'ah | Emphasis |
|---|---|---|---|
| Fajr | before | 2 | mu'akkadah |
| Dhuhr | before | 4 | mu'akkadah |
| Dhuhr | after | 2 | mu'akkadah |
| Asr | before | 4 | ghayr mu'akkadah |
| Maghrib | after | 2 | mu'akkadah |
| Isha | after | 2 | mu'akkadah |
| Isha | witr | 3 | witr |

Slot keys are `before` / `after` / `witr`, unique per prayer, matching the table's unique constraint.
Emphasis is carried as data and shown as a quiet label — the mu'akkadah items are the ones that
matter most, and the UI should make that visible without ranking or scoring the user.

### `toggleSunnah(date, prayerName, slot)` in `app/(app)/deen/actions.ts` (NEW)

Same upsert-and-flip shape as `toggleDeenHabitLog`. `revalidatePath("/deen")` only — sunnah does not
appear on Home, so do not purge `/`.

### `components/deen/prayer-row.tsx` (MODIFIED)

The row gains a disclosure control revealing that prayer's sunnah items, each a toggle with its
rak'ah count and emphasis. Requirements:

- **Collapsed by default**, and collapsing must not disturb the row's height or the fard buttons'
  position — logging the fard is the primary action and must not get harder.
- A quiet completion hint on the collapsed row (e.g. `2/3`) so the state is visible without expanding.
- Real disclosure semantics: `<button aria-expanded aria-controls>`, keyboard operable, and the
  expanded region reachable in tab order.
- Optimistic toggles, same `useOptimistic` + `startTransition` pattern the row already uses for fard.
- Asr has only a non-mu'akkadah sunnah and Fajr has only a before-slot — the component must render a
  variable-length list from the data, never a hardcoded five-row shape.

## Phase 4 — Real location in Settings

Today `settings-form.tsx` writes `location_label` and nothing else. Coordinates and timezone are never
captured, so prayer times silently cannot work for anyone who set up through Settings.

**Two paths, both writing `location_lat`, `location_lng`, `location_label`, and `timezone` together in
one update.** A partial write here is the bug we are fixing, so treat the four as one atomic unit.

1. **"Use my current location"** — `navigator.geolocation.getCurrentPosition`, with
   `Intl.DateTimeFormat().resolvedOptions().timeZone` for the timezone. This is one tap and exact.
   Handle denial and unavailability with a clear message that points at path 2; never leave the user
   on a spinner.
2. **City search** — a text input that resolves against a **bundled** city dataset (city, country,
   lat, lng, IANA timezone), searched in a Server Action so the dataset never ships to the browser.
   Prefer a small, well-maintained npm package that carries timezone per city; if none is suitable,
   bundle a curated dataset of major world cities. **No external geocoding API** — no key to manage,
   no network dependency, no third party receiving Ayman's location.

The field must stop accepting free text that resolves to nothing. A typed string that matches no city
is not a save; show the candidate matches and require a selection.

Also surface what is currently invisible: once a location is set, Settings should show the resolved
place, its timezone, and **today's five prayer times** as a confirmation that the setting actually
took effect. A silent success is what let this bug live this long.

## Out of scope

- Traveling mode's effect on prayer windows (`traveling_mode` exists and is otherwise orphaned).
- Push notifications for prayer windows — the notification pipeline has never delivered in production
  and that is a separate fix.
- Freezing derived statuses into rows via a scheduled job.
- The Deen layout restructure — a separate collaborative phase with Ayman after this lands.

## Acceptance criteria

1. Prayer times for Ayman's real location match a trusted reference (e.g. IslamicFinder / a local
   masjid timetable) for today **and** for a date six months out, within a minute or two. Check the
   Hanafi/standard Asr difference explicitly. Verified against a real source, not self-consistency.
2. A prayer whose window has closed with nothing logged reads as **Missed** in Deen without any user
   action, and is editable from there to On-time or Qada.
3. That same prayer appears in the Qada backlog, and marking it Qada removes it from the backlog.
4. `profiles.qada_owed` is unchanged by any of the above.
5. Home's "Now" module shows the prayer that is actually due — not all five from midnight, and not one
   whose window has closed.
6. Each fard row expands to its own sunnah items, toggles persist, and RLS is verified by a real
   cross-user read attempt.
7. Setting a location in Settings writes coordinates, label, and timezone together, and Settings then
   displays today's prayer times for that place.
8. `tsc --noEmit`, `eslint`, full `vitest`, `next build`, full e2e, and a live browser pass at
   1600/1024/390px with a clean console — per `AGENTS.md`, an RSC serialization violation is invisible
   to every automated check.
