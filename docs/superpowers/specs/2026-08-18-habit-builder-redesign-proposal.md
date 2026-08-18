# Habit Builder — redesign proposal

**Status:** proposal, pending Lead review — do not implement without sign-off.
**Author:** Engineer 1 (Sonnet), 2026-08-18.
**Grounded in:** `docs/superpowers/research/2026-08-18-habit-formation-research.md` (read that first —
every recommendation below cites a section of it) and the overnight brief §1.4.
**Mechanical bugs already fixed tonight, separately:** hidden add-habit control, no cancel, invisible
stage timeframes. This proposal is about what the module becomes next, not those three fixes.

## What Ayman actually asked for

> "Much better user experience — specifically one that incentivizes completing habits and marking them
> done. Add an accountability aspect, including seeing progress for specific habits over time (he drew
> the parallel to the graph beneath Reflection — but done properly, unlike that one)."

Three concrete asks: **(1)** incentivize completion, **(2)** accountability, **(3)** real per-habit
progress-over-time, explicitly modeled on whatever the Reflection graph becomes done right.

## A scoping fact that shapes everything below

**This is a single-user app.** Most of tonight's accountability research — Gail Matthews' study, the
whole "accountability partner" genre — assumes a *second person* checking in on you. That doesn't exist
here, there's no multi-user infrastructure, and building one just for this would be a large, unasked-for
project. So "accountability" in this proposal means **self-accountability**: commitment devices, visible
consequences, and structured self-check-ins — the parts of the research that don't require another
human. Worth stating explicitly rather than silently reinterpreting the word.

---

## Diagnosis: why the current module doesn't do any of the three things asked

- **Zero implementation-intention capture.** A habit is just a name. The single best-evidenced lever in
  the entire research doc — Gollwitzer & Sheeran's if-then plans, d=0.65 across 8,000+ participants
  (research doc §4) — isn't represented anywhere in the data model or the UI.
- **The only progress signal is a hard-reset streak integer.** Per the research doc §9, this actively
  contradicts what's known: missing one day barely dents real habit formation (Lally 2010), and a lapse
  is a re-engagement opportunity, not proof of failure (Verplanken's discontinuity hypothesis; Milkman's
  fresh-start effect). A streak that goes to zero on one miss is the same failure shape the Lead just
  diagnosed and fixed in Reflection — full stop, no memory, no partial credit. Habit Builder has the
  identical bug, just not yet named as one.
- **No accountability mechanism of any kind** — not even a weekly check-in. `deen_weekly_focus` already
  exists and already has a weekly cadence; nothing reads it for reflection/review, only for "what's
  featured this week."
- **"Incentivize completion" has no answer yet**, and the honest one isn't free: research doc §8 lays
  out a real, unresolved scientific disagreement about whether streak/points-style extrinsic rewards
  help or actively undermine the intrinsic motivation that makes a habit self-sustaining. Whatever gets
  built here has to pick a side of that knowingly, not by accident.
- **Stage promotion (Active Build → Stabilized → Locked) is purely time-based**, with an explicit
  existing comment in `habit-stage.ts` that streak "does NOT gate promotion." That was a deliberate
  prior decision — flagged below as an open question, not silently reversed.

---

## Proposal

### 1. Implementation intentions — the highest-leverage single addition

Add an optional **anchor** to each habit: *"After [existing routine], I will [this habit]."*

- New nullable column: `deen_habits.anchor_cue text`. Additive, no migration risk beyond the usual.
- Captured at creation, in the same form that already exists (`HabitFocusPicker`'s "start a new habit"
  field) — one more optional input, not a new screen. Optional, not required: forcing it would add
  friction to the very add-habit flow just fixed for being too hard to find.
- **Displayed on the habit row itself, every time it's seen**, not just once at creation — a quiet
  caption under the habit name ("After Fajr"). This matters specifically because implementation-intention
  research shows the plan's *effect* comes partly from repetition/rehearsal of the cue-response link, not
  just the one-time act of writing it down.
- Existing habits with no anchor just show none — no backfill needed, no forced migration of behavior.

This is the one change in this proposal backed by the strongest evidence in the whole research
document. Everything else here is either moderate-confidence or actively about *avoiding* a
contested/weak mechanism.

### 2. Replace the hard-reset streak with a rolling-window rate as the primary signal

Per research doc §9 and the Lead's own Reflection-redesign reasoning (which I agreed with and it's the
same underlying math): **a rolling window ages data out; a streak resets to zero.** One bad day costs a
thirtieth of a rolling rate, not the whole accumulated effort.

- Primary display becomes **"18 of the last 30 days"** (or the habit's full history if younger than 30
  days — same floor-at-inception rule `lib/fitness/consistency.ts`'s `calculateWeeklyConsistency`
  already implements for fitness habits elsewhere in this codebase). This is a genuine reuse of an
  existing, tested pattern, not a new one invented for this proposal.
- **Keep the current-run count as a small secondary indicator**, not the headline — losing the "day
  streak" framing entirely would throw away a real signal (momentum is worth showing), it just shouldn't
  be the *only* signal, and it shouldn't be what a miss destroys.
- This directly serves "incentivize completion" without leaning on the contested extrinsic-reward
  mechanism in §8 below — a rate that's mostly high and just dipped slightly is itself motivating in a
  way a zeroed-out counter isn't.

### 3. Per-habit progress over time — reuse Reflection's graph, don't build a third one

Ayman explicitly named this as "the graph beneath Reflection — but done properly." The Lead's Reflection
redesign is building exactly that: a dated intensity strip with a plain-language headline and no bare
sparkline. **Habit Builder's per-habit history should be the same visual component**, fed the habit's own
daily completion data instead of reflection-entry weights.

- One cell per day, 30-day window, intensity = completed/not (binary for habits, so this simplifies to
  the same shape ConsistencyGrid already handles well for prayers — a single categorical state per day,
  which is a genuinely good fit here, unlike the ordinal-intensity mismatch that ruled ConsistencyGrid
  out for Reflection specifically).
- Headline: *"22 of the last 30 days"* — same rolling-rate number as §2, just visualized.
- This is real code reuse with no forcing: habit completion actually is a discrete on/off categorical
  state per day, which is exactly ConsistencyGrid's native shape (unlike Reflection's ordinal severity
  scale, which is why that one needs a new component). Confirm this reasoning holds before building —
  I believe it does, but it's a claim about a component I read for a different purpose tonight, not one
  I've built against yet.
- Answer the same four questions Reflection's redesign now states explicitly, applied to habits: does
  the rate reset (no — rolls over 30 days, history isn't deleted), where's it stored (`deen_habit_logs`,
  already exists), how does it become useful (the rate itself, plus §4's check-in), what's the OS layer
  (§4).

### 4. Accountability layer — self-accountability, not social (see scoping note above)

Three complementary pieces, each mapped to a specific evidence tier so the confidence is explicit:

**a. A weekly check-in surfaced in Weekly Planning** *(moderate confidence — the cadence idea, not the
specific accountability-partner number)*. `deen_weekly_focus` already has a weekly cadence and a
featured-habit concept. Extend Weekly Planning (which already exists as a screen) with one line per
active habit: *"Fajr habit: 4/7 this week. Still the plan?"* — no new surface, no new screen, reusing
data and a review moment that's already part of the user's routine. This is the closest analog to what
was actually well-supported in the accountability research (structured periodic review), without
importing the specific unreplicated statistic.

**b. An optional commitment note at creation** *(strong confidence — Ariely & Wertenbroch)*. When
starting a habit, an optional free-text "why" (e.g., "so I don't miss Isha again"). Self-imposed
commitment devices have real experimental backing; a written reason is the lowest-cost version of a
commitment device this app can build without payment/social infrastructure. Shown back on the habit row
or its detail view as a quiet reminder, not enforced or graded.

**c. Honest, non-punitive struggling-habit surfacing** *(directly answers "how does it become useful,"
same principle as Reflection's open/closed reframe)*. If a habit's rolling rate drops below a threshold
(e.g., <30% over 14+ tracked days), say so plainly rather than silently letting it decay: *"Fajr habit:
3 of the last 14 days — worth reconsidering the anchor, or whether this is still the right habit."* This
reframes a struggling habit as a plan to revisit (per Fogg's "which link in the ability chain is
actually broken" framing, research doc §3) rather than a personal failure to feel bad about. No shame
language, no red alert styling — same restrained tone the Reflection redesign is adopting.

### 5. "Incentivize completion" — pick the low-risk side of the contested research explicitly

Given §8's real, unresolved disagreement about extrinsic rewards, I'd recommend **not** building
points/badges/leaderboards, and instead:

- **Immediate, cheap positive feedback on toggle** — a brief visual "celebration" beat (a checkmark
  animation, a color pulse), costs nothing, isn't an extrinsic token exchange, and is consistent with
  Fogg's celebration mechanism even though that specific mechanism is itself unverified (research doc
  §3) — low-risk regardless of whether it's the "real" reason it works.
- **Reward competence and autonomy, not raw compliance** — the rolling rate (§2) and the graph (§3) are
  themselves the reward: visible proof of a real pattern, which SDT (research doc §5) predicts sustains
  motivation better than an extrinsic token that stops meaning anything once given.
- Explicitly **not** recommending: streak-based public leaderboards, external currency/points, or
  anything that makes completing the habit *for the reward* rather than *for the habit*. This is a
  judgment call on genuinely contested science, stated as such — reasonable to override if Ayman wants
  gamification more literally, but I'd want that to be a deliberate choice, not a default.

### 6. The stage thresholds say something the research doesn't support — flagged for Ayman, not changed

`habit-stage.ts` calls a habit "Locked" at day 30. Research doc §1 puts median automaticity at ~66 days,
range 18–254, with only 48% of participants even fitting the model. **"Locked" at day 30 is a confident
claim of "formed" at roughly half the actual median** — the same shape of false signal Ayman has been
complaining about all night in Reflection and elsewhere: a number that states something the underlying
process doesn't actually support.

This is Ayman's own three-stage design, stated in his own words tonight, and I'm not overriding it
unilaterally while he's asleep. But I'd put a concrete option in front of him rather than leave it as an
abstract question: **keep the three stages exactly as they are, but change what "Locked" claims** — from
"formed" (which the evidence doesn't support at day 30) to **"30+ days of practice"** (which is simply
true, regardless of whether automaticity has actually set in for that specific habit). Pair it with the
real per-habit rolling-rate curve (§3) shown alongside the stage badge, so the honest performance signal
and the honest elapsed-time label sit next to each other instead of one silently standing in for the
other. Elapsed time and formed-ness are different facts; the fix is separating them, not deleting either.

I lean toward this option over changing the day-boundaries themselves or making promotion
consistency-gated (which would turn the stage badge into a performance judgment — a different kind of
risk, adjacent to §8's contested-reward territory). But this is Ayman's call, not mine or the Lead's to
settle at 12:30am.

---

## What's explicitly not changing

- `deen_habits`/`deen_habit_logs` schema stays backward-compatible — one additive nullable column
  (`anchor_cue`), everything else is computed at read time, same pattern as the rest of this app's
  derived-data philosophy tonight (prayer windows, qada backlog, reflection redesign).
- The existing optimistic-toggle interaction pattern is correct already and isn't touched.
- No social/multi-user accountability — out of scope per the scoping note above, and out of scope for a
  single-user app regardless of what the research literature assumes.
- Stage day-boundaries (0–13/14–29/30+) stay as-is; only the open question in §6 is on the table, not a
  decision.

## Acceptance criteria (if approved)

1. Adding a habit can optionally capture an anchor cue; it displays on the habit row.
2. The primary progress number for a habit is a rolling 30-day rate, not a resettable streak; a current
   run is still visible as a secondary signal.
3. Each habit has a real dated 30-day history strip, reusing ConsistencyGrid, with a plain-language
   headline — no bare sparkline.
4. Weekly Planning surfaces a one-line check-in per active habit.
5. Creating a habit can optionally capture a short commitment note.
6. A habit whose rolling rate is low for 14+ tracked days says so, plainly, with a suggested action
   (reconsider anchor/habit) rather than silence or shame styling.
7. Completing a habit gives immediate, low-cost positive feedback with no points/badges/external
   currency.
8. `tsc`, `eslint`, full `vitest`, `next build`, live pass at 1600/1024/390 with a clean console — same
   bar as everything else tonight.

## Suggested phasing (once approved — not starting without sign-off)

1. Schema: add `anchor_cue`, wire it into the create form and habit row display.
2. Rolling-rate calculation (mirrors `calculateWeeklyConsistency`'s existing pattern) + swap the
   headline number.
3. Per-habit history strip, once Reflection's intensity-strip/ConsistencyGrid-reuse question is settled
   by whoever builds that first — this piece is sequenced behind it on purpose, not blocked by anything
   else.
4. Weekly Planning check-in line.
5. Commitment note + struggling-habit surfacing (these two are independent of each other and of the
   phases above; either can move earlier if there's a reason to).

## Questions for Ayman, routed through the Lead — not decided here

- §6: does "Locked" get relabeled to "30+ days of practice" (my recommendation), or does he want the
  day-boundaries themselves changed, or the badge left exactly as it reads today? His call — it's his
  system, his words tonight.
- Is the "no badges/points" recommendation in §5 the right call, or does he want more literal
  gamification even given the contested evidence? I'd rather this be an explicit choice than my default.
- Should the commitment note (§4b) ever surface anywhere other than the habit's own row — e.g., quoted
  back during the weekly check-in as a reminder of why the habit was started?
