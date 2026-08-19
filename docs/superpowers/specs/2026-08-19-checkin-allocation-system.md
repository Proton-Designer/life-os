# Check-in allocation system — design

**Status:** design, approved by Ayman 2026-08-19 — build it
**Author:** Opus Lead
**Supersedes:** the point-sample check-in model in `lib/checkins/*` and the Signal:Noise definition in
`lib/business/sn-ratio.ts`.

## What changed and why

The current check-in asks *"what are you doing right now?"* — one tag, one row. Ayman's objection,
which is correct: a lot happens in two hours. Spend 1h40 on YouTube and the last 20 minutes working,
and a snapshot taken at the end records the whole block as signal.

There is also a **reactivity bias** the snapshot can't escape: a prompt arriving is itself a nudge to
start working, so prompts systematically land at "just started," inflating signal for reasons unrelated
to how the day went.

**The replacement: each check-in allocates the two-hour window across domains.** Not one tag — a
distribution.

## Signal and noise, per Ayman's ruling (2026-08-19)

**This is a priority-allocation metric, not a productivity metric.** His words: *"after deen, my
priority is business… I can't include everything under signal, it has to be priority based."*

- **Signal** = Deen + Business
- **Noise** = everything else — School, Fitness, Co-op, Wasted
- **Excluded entirely** = sleep (outside the measurement window, never prompted)

Two consequences that are requirements, not polish:

1. **The check-in UI must never ask him to label School or Fitness as "noise."** He taps the domain he
   actually spent time on; the *calculation* applies the priority weighting. A button that feels like a
   lie stops being pressed honestly. Domains are neutral in the UI, always.
2. **Noise must be displayed split into `other commitments` vs `wasted`.** Studying and doomscrolling
   both land on the noise side and are nothing alike. Without the split, a legitimate tradeoff
   (a heavy school week) is indistinguishable from a leak, and the metric quietly pressures him to skip
   the gym. Ayman accepted that tradeoff knowingly; the split is what keeps it legible.

## The allocation model — read this before writing any UI

**The window is a quantity to be divided, not a timeline.** The bar shows *how much*, never *when*.
Do not build it as a chronological ribbon — 15-minute chronological precision inside a two-hour window
is beyond what memory supports, and the drag/±15 semantics below are quantity semantics. This is a
deliberate departure from Home's Day Ribbon despite the visual similarity; say so in a code comment so
nobody "fixes" it later.

**Wasted is derived, never directly edited.** This single decision makes Ayman's no-stealing rule fall
out for free:

```
TOTAL   = 120 minutes (8 blocks × 15)
assigned = sum(allocations)          // Deen, Business, School, Fitness, Co-op
wasted   = TOTAL - assigned          // always >= 0, never negative, not an input
```

Every operation clamps against `wasted` — the free pool — so **no operation can ever take minutes from
another domain.** Growing a domain consumes the pool; shrinking one returns to it.

### Operations (pure, tested, no React)

Put these in `lib/checkins/allocation.ts` as pure functions. The component holds no arithmetic.

```ts
const TOTAL_MINUTES = 120;
const STEP = 15;

type DomainKey = "deen" | "business" | "school" | "fitness" | "co_op";
type Allocation = Record<DomainKey, number>;   // every value a multiple of 15

wastedMinutes(a: Allocation): number           // TOTAL - sum, floored at 0

increment(a, domain): Allocation
  // adds min(STEP, wasted). At wasted === 0 returns `a` unchanged — a no-op,
  // NOT an error and NOT a steal.

decrement(a, domain): Allocation
  // subtracts min(STEP, a[domain]). Floors at 0. Freed minutes return to wasted.

setMinutes(a, domain, requested): Allocation
  // drag entry point. Snaps to nearest STEP, then clamps to
  // [0, a[domain] + wasted(a)] — the domain's own minutes plus the free pool.
  // Ayman's rule verbatim: "increase it by whatever it can be increased but
  // stop it off by whatever was extra."
```

**Tests must include:** increment at a full pool is a no-op; `setMinutes` requesting more than
available lands exactly at `own + wasted`; decrementing one domain then incrementing another succeeds
for exactly the freed amount; no sequence of operations makes `wasted` negative or any allocation
non-multiple-of-15; the sum is invariant at `TOTAL` when wasted is counted.

## The UI

```
  ┌──────────────────────────────────────────────┐
  │  2:00 – 4:00 PM                              │
  │                                              │
  │  ████████████████░░░░░░░░▒▒▒▒▒▒▒▒░░░░░░░░    │
  │  └─ drag the selected domain's edge ─┘       │
  │                                              │
  │  ● Deen           15m       [ − ]  [ + ]     │
  │  ● Business     1h 00m      [ − ]  [ + ]     │
  │  ● School          —        [ − ]  [ + ]     │
  │  ● Fitness         —        [ − ]  [ + ]     │
  │  ● Co-op           —        [ − ]  [ + ]     │
  │  ○ Wasted         45m                        │
  │                                              │
  │  Unassigned time counts as wasted.           │
  │                    [ Done ]                  │
  └──────────────────────────────────────────────┘
```

**Stacked proportion bar**, fixed domain order, Wasted always last. Segment width = that domain's
share. Use each domain's existing accent token (`lib/accent-tokens.ts`); Wasted is muted/neutral, never
red — it is information, not an accusation.

**Selection.** Tapping the *domain name* selects it: that row and its bar segment stay at full
strength, all others dim. Tap again to deselect. Selection is what arms dragging.

**Dragging.** Only when a domain is selected, and only its own segment edge. Pointer events (mouse +
touch, one implementation). Live-preview while dragging, commit on release, snap to 15. Clamp exactly
as `setMinutes` does — **the bar must visibly stop at the limit rather than rubber-banding or stealing.**

**± buttons** sit to the right of each domain's total, always visible, and are the primary path — drag
is an accelerator, never the only way. At a full pool `+` renders visibly disabled rather than silently
doing nothing.

**Pre-fill.** Open with allocations already populated from what the app knows about the window: Lock-In
sessions that overlapped it → Business; prayer windows inside it → Deen; a scheduled workout → Fitness.
Fully editable. Most check-ins should be *confirm*, not *enter*. Mark pre-filled rows subtly so he can
tell what the app guessed from what he entered.

**Show minutes, never a live percentage.** Percentages invite tuning the number toward one you like;
minutes just describe what happened. Convert to percentages in reporting only.

**Non-negotiables.** Every control ≥44px — this app has a known sub-44px problem and must not add to
it. The bar is `role="slider"` per selected domain with `aria-valuenow/min/max` and arrow-key support;
±15 must be fully keyboard-reachable. Works at 390px one-handed. `prefers-reduced-motion` respected.

## Schema

New migration. `checkins` keeps its existing rows and shape — legacy point-samples stay valid and
readable.

```sql
alter table checkins add column window_start timestamptz;
alter table checkins add column window_end   timestamptz;
alter table checkins add column kind text not null default 'point'
  check (kind in ('point','allocation'));

create table checkin_allocations (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references checkins(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  domain text not null check (domain in ('deen','business','school','fitness','co_op','wasted')),
  minutes int not null check (minutes >= 0 and minutes % 15 = 0),
  created_at timestamptz not null default now(),
  unique (checkin_id, domain)
);
```

RLS on, `user_id = (select auth.uid())`, indexed on `user_id` and `checkin_id` — match the conventions
in `001_core_schema`. **`default auth.uid()` is required** (a spec omitted it on `sunnah_logs` on
2026-08-18 and produced a type/DB mismatch that typechecked and failed at runtime).

`wasted` **is** persisted as a row here even though it is derived in the UI — the derivation depends on
`TOTAL`, and storing it makes historical rows self-describing if the window length ever changes.

**Verify RLS by real impersonation** (`SET LOCAL ROLE authenticated` + a different `sub` claim), not by
reading the policy back.

## Phases

**Phase 1 — allocation math + schema.** `lib/checkins/allocation.ts` pure functions with full tests, and
the migration applied *and registered* in `supabase_migrations.schema_migrations`. Regenerate
`database.types.ts` from the live schema rather than hand-writing it.

**Phase 2 — the component.** `components/checkin/allocation-checkin.tsx` against Phase 1's functions.
No arithmetic in the component.

**Phase 3 — scheduling and surfacing.** The 2-hour clock across waking hours, prayer-window
suppression, the retroactive queue (ask on next app open, expire after ~4 hours, surface `unknown` as
its own number rather than hiding it), and the hourly one-tap confirm inside Lock-In sessions.

**Phase 4 — recalculate Signal:Noise** under the new definition, with the noise split, and move the
widget off Business — once it counts every domain, sitting on the Business screen misrepresents what it
measures. Home or Insights.

**Phases 1 and 2 are this handoff. 3 and 4 are specified here for context and are not yet assigned.**

## Acceptance

1. No operation, in any sequence, produces negative `wasted`, a non-multiple-of-15 allocation, or a sum
   over 120. Property-test this, don't hand-pick cases.
2. Adding at a full pool is a visible no-op with a disabled `+`, not a silent one and not a steal.
3. Dragging past the limit stops exactly at `own + wasted`.
4. Freeing minutes from one domain makes exactly that many available to others.
5. Keyboard-only completion of a full allocation is possible.
6. 44px minimum on every control, verified by measurement at 390px, not by eye.
7. Pre-fill populates from real Lock-In / prayer-window / workout data and is editable.
8. `tsc`, `eslint`, full `vitest`, `next build` clean; live pass at 1600/1024/390 with a clean console.
9. RLS verified by impersonation; migration registered; types regenerated from live schema.
