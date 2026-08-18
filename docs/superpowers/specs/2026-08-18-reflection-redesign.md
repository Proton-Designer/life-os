# Reflection module — redesign

**Status:** design, approved for build after team critique
**Author:** Opus Lead, 2026-08-18, revised after critique from both engineers
**Brief:** `docs/superpowers/briefs/2026-08-18-overnight-brief.md` §1.2, §1.3

## What Ayman said

> "It's very ambiguous. I have no clue what it means… you have to click a certain spot for it to
> populate… to remove one you have to click a very specific hidden minus sign in the top right
> corner… after two seconds that thing actually populates. The entire experience for this entire
> module is very bad."

> "Just a simple counter doesn't make any sense. Does the counter reset? If so, when? Where does it
> get stored? How does the data become useful? What is the operating system layer on top of that?…
> especially when it deals with something like sin, [it] needs to be optimized in a very careful and
> especially helpful way that actually makes it helpful, not just some feature that soon becomes
> negligible or ignored over time because it just doesn't have use."

On privacy he **relaxed** the earlier rule: it no longer has to be unreadable. A passerby glancing at
it shouldn't be able to tell what it is; the name stays "Reflection"; but **the symbols have to mean
something to him.**

## Why it fails today — diagnosis before design

**The lag is a real bug, not a perception.** `ReflectionTracker` uses `useTransition` + a Server
Action + `revalidatePath("/deen")` with **no `useOptimistic`**. It is the only interactive component
in this codebase without it — `PrayerRow`, `PriorityList`, `NextActions`, and `HabitBuilder` all have
it. Every tap waits on a full server round trip. That is the two seconds.

**The tap target is the inner button, not the tile.** The `<button>` wraps only the glyph and count,
so surrounding padding is dead space — hence "you have to click a certain spot."

**Undo is a 12px `−`** at `absolute top-1 right-1`, `text-xs`, `opacity-30` when disabled, and it is
the only way to correct a misclick.

**The glyphs carry no meaning.** `○ ◐ ●` were chosen so a passerby couldn't read them. They succeeded
so completely that the owner can't read them either. Under the relaxed privacy rule that trade is no
longer worth making.

**The counter only ever delivers bad news.** The number's only direction is up, up means failure,
there is no response available after logging, and nothing ever resolves. A tally that exclusively
records failure and offers no path forward is one a person stops opening — precisely the "becomes
negligible" outcome he named.

**The graph is three flat monochrome sparklines** with no axis, labels, scale, or dates. His
description — "one line with some bumps that mean nothing" — is accurate.

## 1. Meaning — name the weights

Replace `○ ◐ ●` with three named weights: **Light · Moderate · Heavy**.

This satisfies the relaxed privacy rule exactly. A passerby sees three severity levels of *something
unspecified* under a heading called "Reflection." The owner sees an unambiguous scale. Keep the
escalating red tint as reinforcement, not as the sole signal.

## 2. Interaction — fix the three concrete complaints

- **The whole tile is the tap target**, minimum 44px.
- **`useOptimistic`**, as every other interactive component here already does. The count moves on tap.
- **Undo is visible, labeled, and persistent** — a full-size control on the tile whenever that tile's
  count is above zero.

  **It must not be an ephemeral toast.** An earlier draft proposed a brief "Logged — undo"
  affordance. Engineer 2's objection is decisive: a control that vanishes on a timer, or on a network
  hiccup, recreates the original complaint wearing a different hat and puts the user under time
  pressure to fix a misclick. A persistent control has no timing failure mode. `decrementReflectionEntry`
  already does the right thing (deletes only the most recent entry of that tier today).

## 3. The "return" mechanic — designed, deliberately NOT in this pass

The idea: mark an entry as turned-back-from, converting a tally into a cycle and yielding
time-to-return as the metric. **Both engineers independently argued against shipping it now, and they
are right.** Recorded here so it isn't re-derived from scratch, and so Ayman can rule on it.

- **It isn't load-bearing.** §5B already answers "how does the data become useful" on its own. The
  return mechanic is additive value on top of a complete answer, not the thing that makes it work.
  (Engineer 2)
- **It's the same decision I made about quick capture, three hours earlier.** Zero usage data — one
  row in the table — and adding a *second* interaction on the same pass whose entire purpose is
  removing friction from the *first*. I applied "don't design ahead of observed pain" to quick
  capture and then violated it here. (Engineer 2)
- **It can recreate the failure mode it's meant to cure.** An accumulating pile of unclosed entries
  is a second thing to remember and arguably *more* discouraging to look at than a flat count — the
  module gains a second way to appear to be failing him. (Engineer 2)
- **Neither timing of the mark is honest.** Marked in the same sitting, it's self-attestation before
  anything has actually happened. Marked later, it depends on memory — the same failure mode as the
  lag bug, moved to a different day. (Engineer 1)
- **It is underspecified as scope**, needing its own surface for listing and selecting open entries —
  net-new UI landing in the same change as three bug fixes. (Engineer 2)

**If Ayman wants it later:** the control belongs inline on the same tile with zero navigation
(Engineer 1), and the schema addition is one nullable column, `returned_at timestamptz`. It is a
judgment call about whether he wants explicit self-attestation at all — an engineering opinion should
not settle that, which is why it goes to him rather than being decided here.

## 4. Answer the open questions explicitly, in the UI

- **Does it reset?** The *count* is per-day, rolling at local midnight like every other daily metric.
  **History is never deleted.** The module states this in one line rather than leaving him to infer it.
- **Where is it stored?** `reflection_entries`, his own database, RLS-scoped to his user, never
  aggregated into Patterns, Insights, or any review surface. Pre-existing absolute constraint.
- **How does it become useful?** §5 — the pattern, not the count.
- **What is the OS layer?** §6.

## 5. The graph — replace all three sparklines

### A. 30-day intensity strip — a new component, not `ConsistencyGrid`

The headline metric is **"22 of the last 30 days clear."** Promoted from caption to headline on
Engineer 1's recommendation: it's a rolling-window count, so one bad day costs a thirtieth rather
than everything, and it ages out naturally instead of needing a reset. **Deliberately not a streak** —
`computeHabitStreak` is a hard walk-back-and-reset, so one Heavy entry would zero a 45-day run and
discard the whole accomplishment. For data this emotionally loaded that is the worst available
feedback shape, and discouragement is the exact failure mode being designed against.

**Do not reuse `ConsistencyGrid`.** An earlier draft specified it for visual consistency with the
prayer grid; Engineer 1 read the component and identified why it doesn't fit:

- Its contract is `statusStyle: Record<string, {colorVar, treatment, label}>` — a map from **discrete,
  unordered categories** to distinct hue+texture pairs, built for prayers' three genuinely different
  states, each needing its own hue for the accessibility contrast floor. Reflection's data is an
  **ordinal intensity scale**, which wants a single-hue saturation ramp. Forcing an ordinal scale
  through a categorical map reads as "four unrelated things" rather than "one thing at four
  intensities" — actively undermining what the strip is meant to show.
- `ConsistencyGrid` assumes **one status per cell**, true for prayers (unique per day+prayer) and
  false here: nothing stops several entries of different weights on one day.

Build a small intensity-strip component instead. It is less code than the styling gymnastics of
forcing four categories through a categorical map. Do **not** refactor `ConsistencyGrid` into a shared
primitive — that cost is only worth paying if we're touching it for another reason, and we aren't.

**Aggregation rule** (needed before a cell has a value at all, and absent from the current code):
a day's weight is the sum of its entries' tiers (Light 1, Moderate 2, Heavy 3), bucketed for display —
`0` clear · `1–2` low · `3–5` mid · `6+` high. A **clear day** is weight 0. Put this in a pure,
tested function; it is a real product decision, not an implementation detail.

### B. Time-of-day distribution

`created_at` is already captured, so this costs no new data. Buckets across the day showing when
entries cluster.

**This is where the module earns its place.** "You logged 4 this week" tells him nothing he didn't
know. "This clusters between 11pm and 1am" is a fact he can act on.

Two honest qualifications, both from Engineer 2:

- It is **not the only** new axis available. Day-of-week clustering is equally free from `created_at`
  and equally actionable. We are not building it now — the same restraint applied elsewhere — but the
  claim should not be overstated, and day-of-week is the obvious next addition if this proves useful.
- Below roughly 8 entries it must say **"not enough yet"** rather than draw noise. That is the exact
  failure the current sparklines commit.

## 6. The OS layer

What makes this an operating system rather than a diary is that the pattern connects to the rest of
the app. When a clear time-of-day cluster exists, the module offers **one action**: commit a Deen
habit aimed at that window, using the Habit Builder that already exists. Surfaced as an observation
with a suggested response, never a verdict.

That is the minimum viable OS layer and it reuses systems already built. Anything more ambitious
waits for real usage.

## 7. Known gaps — named, not silently assumed away

- **It will look empty on first open.** With one row in the table, §5A shows almost nothing and §5B
  correctly reports "not enough yet." That is honest behavior, not a bug, but the most interesting
  parts of this redesign will be empty states the first time Ayman sees them. (Engineer 2)
- **Visual weight against its neighbour.** The layout change puts a deliberately shorter, narrower
  Reflection beside a Habit Builder that is getting a richer redesign tonight. "Shorter and narrower"
  must not be allowed to imply "quieter" — its visual weight needs a deliberate decision rather than
  falling out of the size change. (Engineer 2)
- **Nothing re-engages him.** This fixes the module's interaction, not its discoverability, and push
  notifications have never worked in production. Fixing the tap does not fix retention. Out of scope
  tonight; recorded so it isn't mistaken for solved. (Engineer 2)

## Explicitly unchanged

- Reflection data never enters Patterns, Insights, reviews, or any aggregate.
- **No free-text notes.** A glance at an expanded note leaks content in a way a count never can. The
  relaxed symbol rule does not touch this.
- The module keeps the name **"Reflection."**

## Acceptance criteria

1. Tapping anywhere on a weight tile logs it and the count moves immediately.
2. Undo is visible without hunting, persistent while the count is above zero, and never time-limited.
3. The three weights are legibly named; nothing on screen names the subject matter.
4. The three sparklines are gone. The 30-day strip has a dated axis, a single-hue intensity ramp, and
   "N of the last 30 days clear" as its headline.
5. The time-of-day view shows a real distribution or honestly says there isn't enough data.
6. The module states its own reset and retention behaviour in one line.
7. The day-weight aggregation rule is a pure, separately tested function.
8. `tsc`, `eslint`, full `vitest`, `next build`, live pass at 1600/1024/390 with a clean console.
