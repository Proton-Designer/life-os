# Fitness redesign — design spec

Date: 2026-08-19
Status: design approved in outline by Ayman; plan contents pending his review
Revision: 2026-08-19 — legs removed from scope per Ayman; §8 rewritten upper-body only
Participants: Opus Lead, Engineer 2 (lorzr3x4, UX/layout), Engineer 3 (jazdm6pt, evidence/data model)

## 1. The finding that drives everything

Queried production directly. Across **both** accounts — Ayman's real account
(`ayman.0704m@gmail.com`) and SEED — the fitness domain has **zero rows, ever**:

| | workout_logs | workout_schedule | active fitness habits |
|---|---|---|---|
| real account | 0 | 0 | 0 |
| SEED | 0 | 0 | 0 |

Meanwhile the real account has 18 check-ins and 9 prayers, the most recent logged
the day before this spec. Deen is in daily use. **Fitness has never been used
once.**

So when Ayman asked "what exactly is this Habits section for," he was looking at
an *empty grid*. Every number on the page is a zero: streak 0, workouts this
month 0, weekly consistency 0%.

**Root cause.** The screen demands a training program as INPUT and returns only
attendance as OUTPUT. Populating the 7-day schedule is an unguided chore — seven
cells, free text, no answer to "what should I even do." For a domain Ayman has
deliberately deprioritised (Fitness is *noise* in the Signal:Noise model), that
trade is never worth initiating. Adoption dies at step zero, before any of the
logging friction is even reachable.

This is not a "improve the widgets" problem. Every decision below follows from
fixing step zero.

## 2. Core structural move: the plan carries the structure

Today a scheduled day is a text string ("Push"). It becomes a real object:
**ordered exercises, each with target sets, reps and load.**

Logging then becomes *confirmation*, not entry. One tap writes a fully
structured record — sets, reps, load — because the plan already held the
structure. Taps are spent only on deviation, and deviation is the interesting
case anyway.

This resolves the central conflict between the two engineers:

- Engineer 3: without sets and load, the screen can never distinguish *showing
  up* from *adapting*. Correct, and evidence-backed.
- Engineer 2: the leaving-the-gym path must be ~2 taps because this is a noise
  domain. Also correct.

Both hold, because the typing moved to a surface visited monthly instead of
after every session.

Two consequences fall out free:

1. **Progressive overload becomes something the app proposes**, not something he
   remembers. Next session's target load pre-increments off the last confirmed
   top set. This is the highest-value single behaviour on the screen: the one
   controlled study on progression found it roughly *doubled* hypertrophy versus
   a non-progressive condition.
2. **Under-dosing is detectable before training**, because weekly sets per muscle
   group is computable from the templates alone.

### 2.1 Does one-tap confirm corrupt the data?

No, and we should not invent a derivation to police it. Engineer 3's argument,
adopted:

> The missed-Lock-In-hours derivation worked because SILENCE was genuinely
> ambiguous (present-but-ignoring vs actually-absent), so we could close a
> loophole by defaulting the ambiguous case to the worse reading. A tap on
> "confirmed as planned" isn't silence, it's an affirmative claim. And the app
> already lives with exactly this trust boundary — nothing stops him tagging a
> Lock-In hour "business" when he was scrolling. Template-confirm is the same
> floor, not a new hole in it.

The real lever is **keeping honest deviation cheaper than false confirmation**:

- Show the actual numbers inline (`3×8 @ 135 — confirm?`). Reading is free.
- Adjusting is one tap on a stepper already on screen, not a separate flow.
- **No bare "Confirm" button** that can be tapped blind.
- **No auto-advance** that would let three confirms happen without his eyes
  landing on a number.

## 3. Screen structure

- **Day-picker strip** — five cells (Mon–Fri; weekends carry no assignment under
  the current ruling and permanently-empty cells convey nothing). This is
  *navigation*, not information display. At 5-of-5 filled a week grid stops
  conveying anything by contrast, so it is demoted from a prominent 7-wide grid
  to a small secondary control.
- **Detail panel** — defaults to today, tappable to any day. Holds the exercise
  list and the confirm action. This is the informational element.
- **Headline stat** — weekly sets per muscle group against target, plus an
  adherence fraction ("4/5 this week"). A *fraction*, never a streak.
- **Body module** (§6) and **two daily checks** (§7).

### 3.1 Where fitness lives OUTSIDE this screen

The win condition is that he rarely opens `/fitness`.

- **Home** carries the one-tap confirm for the on-plan case, the daily rep-target
  bars (§5), and the passive weight-entry affordance.
- **A post-session notification** carries confirm when he isn't in the app. It
  must be killable globally and per-plan, and absent entirely when no schedule
  exists — a notification for a deliberately deprioritised domain reads as
  nagging, which fights the entire premise.
- **The Fitness page** becomes plan setup/editing, the deviation and free-log
  fallback, and history.

## 4. Workout library

Sub-page at `/fitness/workouts`, reached from a prominent "My Workouts" entry at
the top of Fitness. **Not** new top-level nav — Fitness should not win primary
real estate — but not buried in Settings either. Precedent: Business keeps kill
list, goal card and Lock-In inside one page without separate nav items.

- **Build**: exercise picker into the library, with "add new exercise" inline
  (his cable machine does things no fixed list anticipates). Drag to reorder, set
  targets per exercise, name, save.
- **Manage**: duplicate, rename, **archive — never hard-delete**, matching the
  existing `custom_habits.archived` convention. Hard-deleting would orphan
  history.
- **Editing must never rewrite history.** Confirming a session **copies** the
  current exercise/sets/reps/load values into the session record at that moment.
  Editing a template changes only what is offered next time; every logged session
  keeps its own frozen snapshot forever, even if the template is later edited,
  archived or deleted. Same stored-row-always-wins shape as `prayer-status.ts`
  and the missed-Lock-In-hours work.
- **Muscle-group tags are a LIVE reference, not a snapshot.** A tag is a taxonomy
  fact about the exercise, not an assertion about what happened in a session.
  Retagging correctly updates past volume maths.
  - *Carry-forward caveat (Engineer 3):* if a point-in-time volume REPORT is ever
    built ("your September numbers were X"), a later retag will silently shift
    that number after the fact. This is correct behaviour — fixing a
    categorisation error should update past rollups — but needs a one-line
    comment wherever such a report ships so it doesn't read as a bug.
- **Tagging is optional, not blocking.** Multi-select (most cable moves hit 2+
  groups); saving untagged is allowed. Untagged exercises simply don't contribute
  to volume, surfaced as a quiet passive note, never a nag. Blocking save on
  tagging is exactly the unguided-input friction that killed this screen once.
  Precedent: `bucketAllocationMinutes` ignores unrecognised domains rather than
  miscounting — better a gap than a wrong total.
- **Quick-add / odd-moment logging.** A session need not belong to a named
  workout: a bare single-exercise entry is valid. Scattered same-day entries stay
  **separate** and volume maths sums across them — forcing "which session am I
  adding to" mid-push-up is pure friction for no data benefit. Reachable from
  Home, not only Fitness, since these happen between other things.

### 4.1 First run

Two **equal-weight** entry points, neither reading as the fallback:

- "Create your own workout" → opens the builder empty.
- "Start from one of these" → the three plans (§8) as pick-a-card.

Below both, a smaller tertiary "or just log something now." The blank 7-cell grid
is replaced by a single "+ Build your week" affordance opening the same choice.

Ayman's ruling: **authoring his own workouts is the default path**; the plans are
the assist, not the primary.

## 5. Daily rep target (the starting plan)

Ayman's ruling, verbatim: *"For the starting workout plan just include 30 pull
ups and 100 pushups everyday for 5 days (on the weekdays)."*

**This is the entire starting plan**, not a wrapper around session-shaped
content. Therefore:

- It is **orthogonal** to the day-picker and the workout library. A standing
  weekday goal, always on Home, independent of whether any day-slot has an
  assignment. Do not force one day-slot to hold two content types — that is
  schema damage taken on to preserve a visual metaphor, and the metaphor loses.
- **Model**: a lightweight goal row (exercise id, daily target, active days),
  structurally closer to This Week's Goal's `GoalCard` than to a workout
  template. The progress bar is a thin view over the sum of today's existing
  bare single-exercise quick-add entries — same rollup maths as weekly volume,
  windowed to today, keyed to raw reps instead of sets×load. **No new event
  type.**
- **UI**: two thin bars on Home ("Pull-ups 18/30", "Push-ups 60/100"),
  auto-hidden on non-active days. Each bar *is* its own quick-add entry point —
  tap the bar, exercise prefilled, enter this bout's reps.
- **Week one, his entire fitness interface is those two bars.** The day-picker
  has nothing to point at. This is acceptable and in fact the strongest
  expression of the win condition: a plan requiring zero visits to `/fitness`.
- **Concurrency is supported; staggering is recommended.** Because the rep target
  and session plans occupy different objects and surfaces, the app can run them
  simultaneously and must not forbid it. But the *training* advice is to run the
  starter alone for 2–4 weeks first — see §8.3. The architectural point still
  matters: the starting plan trains only vertical pulling and horizontal
  pushing — no horizontal pull, no direct side or rear delt, no direct core — so
  it cannot serve the goal alone and must be able to stack rather than replace.
  (Legs are out of scope entirely by Ayman's ruling — see §8.)

### 5.1 Grease-the-groove parameters

His specification matches an established protocol. Mountain Tactical runs an
assessment-based 5-week push-up/pull-up plan on exactly this structure — five
days Mon–Fri, weekends off — and their own mini-study found it beat their
density progression.

The parameter that makes it work versus injure:

- **Each set is 40–60% of max reps, never to failure**, 4–8+ sets/day spaced
  15–60 min apart. If his max is 8 pull-ups: six sets of four. **Not** three sets
  of ten.
- The number is not the risk; **the distribution is**. 30 pull-ups as 6×5 is
  grease-the-groove. 30 pull-ups as 3×10 to failure is how elbows break in week
  three.
- **Assessment-based, not hardcoded.** Test max, derive per-set reps from it,
  retest, ramp the daily total toward 30/100. Ayman's numbers are the destination
  and are not negotiable; the schedule of arrival is ours.

**The ramp protocol** (Engineer 3):

1. **Day 1**: test max unbroken strict pull-ups (`Pmax`) and push-ups (`Hmax`),
   fresh, not fatigued.
2. **Per-set target = ~50% of max**, distributed across 6–8 bouts/day spaced
   through the day.
3. **Retest every 2 weeks** (matching Mountain Tactical's assessed-and-retested
   model); raise per-set reps and/or bout count until the daily total reaches
   30/100.

*Illustrative only — real numbers depend entirely on his Day-1 test, which we do
not have.* If `Pmax`=6: week 1 = 3 reps × 6 sets = 18/day; week-3 retest (`Pmax`
likely ~8–9 from fast neural adaptation) → 4–5 reps × 7 sets ≈ 28–35/day, hitting
30 around week 4–5. Push-ups ramp faster: if `Hmax`=20, week 1 = 10×8 = 80/day,
week 2 = 10×10 = 100/day.

**The ramp's entire job is ensuring he never has to test 30/100 as a single
near-failure attempt.**

### 5.2 Joint load — the actual mechanism

Tendon adaptation runs on a weeks-to-months timeline (meaningful stiffness change
~2 weeks, full remodelling 18–24 months) while early strength gains are mostly
*neural* and arrive fast. **The contractile system gets stronger before the tendon
catches up, and that gap is where overuse injury lives** — specifically
medial/lateral elbow from high-rep pulling and wrist extensor strain from repeated
push-up loading.

What the plan must carry:

- **The ramp itself is the primary protection.** This is the mechanism, not a
  nice-to-have.
- **A deload every 4–6 weeks** (~40–50% volume reduction for a few days).
  ⚠️ This modifies "5 days on" as Ayman specified it, so it is surfaced as a
  recommendation for his decision, **not inserted silently**. See §10.
- **A wrist-position cue** for push-ups (neutral / handles / fingers-forward
  options).
- **An explicit stop-rule**: sharp *localised joint* pain — as distinct from
  ordinary muscular fatigue — means cut that day's volume.
- **Honest boundary**: grease-the-groove works on the neural/strength side.
  Volume-equated, frequency alone does not drive hypertrophy (Schoenfeld/Grgic
  2019 vs Grgic 2018). It raises his pull-up and push-up numbers; it is not the
  hypertrophy driver. This is why it runs *alongside* a session plan.

## 6. Body metrics

Ayman ruled both IN: bodyweight **and** waist.

**Designed as ONE module with two lines always shown together** — never one
without the other, so the pairing is structurally enforced rather than a UI
convention that could drift:

```
Weight — 158 lb (7-day avg)
Waist  — 32.5 in (Aug 6)
```

**Why the pairing is mandatory.** Ayman is a textbook recomposition candidate: 19,
genuinely untrained (zero logged history), skinny-fat. Barakat et al. 2020 puts
untrained individuals at 1–1.5% of bodyweight per month in lean mass gain while
simultaneously losing fat. But **during a successful recomp, scale weight can sit
flat for months** — lose 9 lb of fat, gain 9 lb of muscle, the scale sees
nothing. Weight alone would tell him he is failing during the exact period he is
succeeding. Waist is the number that actually moves.

Display is always the **7-day rolling average**, never the raw daily reading —
day-to-day variation is ±1.5–3 lb of water even during active fat loss.

**Entry mechanisms differ deliberately** (Engineer 2's distinction: *a prompt
interrupts and demands a decision; an affordance just sits there available*):

- **Weight → passive affordance.** No push, no badge, no notification. A small,
  low-visual-weight entry point in Home's ribbon, present whenever he opens the
  app for any other reason. Justification: he is on Home daily (the usage data
  confirms Deen is in daily use on that same screen), and the rolling average
  degrades gracefully with sparse entries — which is an argument we never needed
  to prompt at all, not merely a mitigation for when prompting fails.
- **Waist → active nudge, ~every 14 days** from the last entry, quiet in
  between. Justification: unlike stepping on a scale, there is no organic
  occasion that would make him think to measure his waist, so it is a genuine
  blind spot without a reminder.

Display lives on Fitness; entry lives mostly on Home.

## 7. The two daily checks (Habits panel, revived)

The Habits panel is deleted **as it exists** and revived with a real job. The
underlying `custom_habits` / `domain='fitness'` machinery stays intact (Deen and
Home have independent call sites; there is no shared-code blast radius).

**The visualisation changes, not just the content.** Two one-tap checkboxes —
**not** a 30-day `ConsistencyGrid`. A grid was the wrong shape for "did I hit two
intentions today," and reviving the old visualisation risks reviving the old
"what is this for" confusion.

1. **"Hit protein target"** — with the numeric target (~130–150 g) shown **once**
   as a small non-interactive reference caption.
2. **"8,000+ steps"** — target user-adjustable in a settings affordance.
   **Promoted to load-bearing by the no-legs ruling (§8):** with no leg sessions
   in any plan, walking is the only lower-body loading and a large share of daily
   energy expenditure. Its copy should read as a real training input, not a
   wellness nicety.

**Hard copy constraints** (not style preferences):

- The gram number appears **once, as a caption**. Never inside a progress bar,
  never phrased "X of Y g". It is an *intention-check*, not a measurement — a UI
  implying it tracks actual grams would be the self-deceptive version.
- Nothing anywhere sums or logs grams.
- The step checkbox must not imply a synced pedometer reading.

**Why these two and not others.** Both are daily behaviours a workout log
structurally cannot see, both are single-tap, both sit on real evidence for his
specific goal. Step floor 8,000: evidence clusters 7,000–10,000, with the
sharpest marginal gain at ~8k and near-zero additional benefit 8k→10k.

**Rejected third: sleep duration** (Engineer 3's argument, which the Lead would
have missed)**.** Evidence for sleep's effect on MPS and
fat-loss success is at least as strong as steps. Excluded anyway because the
codebase already treats sleep as deliberately outside the measurement window
(`sn-ratio.ts` excludes it from Signal:Noise by design), and a third checkbox
works against the minimum-time constraint defining this redesign. It is the
natural next add, not a gap.

**One static sentence** that body fat is mostly a diet outcome, placed near the
Body module (it explains why weight and waist behave as they do). One line. Never
its own card, never recurring.

Evidence anchor: Longland et al. 2016 — identical training, identical deficit;
high-protein group gained lean mass, moderate-protein group gained **none**.

## 8. The three plans

Ayman's ruling: *"i should workout at least 5 days a week, for at least 30
minutes"* and *"put together 3 optimized workout plans."*

**Time model** (applies to all three): set = 40s execution; antagonist-pair rounds
alternate with 15s transition; 60s rest after each full round. Rest of ≤60s is
defensible, not a corner cut — >60s gives only a trivial hypertrophy edge
(SMD=0.08), mediated mostly by preserved volume-load rather than a growth
mechanism.

One pair × 3 rounds = 3 × (40+15+40+15+60) = 510s ≈ 8.5 min.
Three pairs + 3 min warm-up ≈ **28.5 min**. **18 working sets/session, 90/week.**

**Equipment**: pull-up bar (pull-ups, dips, dead hangs, push-ups, hanging ab
work) and a multi-use cable machine. **No barbell, no bench, no free weights.**

**Set crediting**: fractional — primary mover = 1 set, secondary = 0.5. This
method best predicted both hypertrophy and strength in the 2025 dose-response
meta-regression (Pelland et al.).

**Scope ruling (2026-08-19, Ayman): NO LEG TRAINING.** All three plans are
upper-body and core only. This was an explicit instruction, not an oversight, and
it supersedes the earlier equipment-gap discussion about loading quads and
hamstrings without free weights — that problem no longer needs solving because
the muscle group is out of scope.

**The tradeoff, stated once and then accepted.** Legs are roughly half of total
muscle mass. Removing them:
- slows the *muscle gain* half of recomposition, since the largest available pool
  of new tissue is off the table;
- removes the highest per-session energy cost in the program, so **the fat-loss
  half now leans almost entirely on diet and daily steps** rather than training.

Two design consequences follow, and both are already in this spec rather than
being new asks:
1. The **step floor (§7) is promoted from a nice-to-have to the primary
   lower-body and NEAT stimulus.** With no leg sessions, walking is the only
   lower-body loading and a meaningful share of daily energy expenditure. Its
   copy should reflect that it is load-bearing, not decorative.
2. The **protein check (§7) matters more, not less** — with less total training
   stimulus, the diet side is a larger fraction of the outcome.

**Set crediting**: fractional — primary mover = 1 set, secondary = 0.5. This
method best predicted both hypertrophy and strength in the 2025 dose-response
meta-regression (Pelland et al.).

### 8.1 The stacking constraint (now the dominant constraint)

500 push-ups + 150 pull-ups per week ≈ 40 sets of chest and 33 sets of back. The
optimal range is 12–20 sets/muscle/week. **The starter plan alone puts the upper
body at roughly double the top of that range.**

Qualifier: grease-the-groove sets are submaximal and the set-volume literature
comes from sets near failure, so these do not credit 1:1 toward hypertrophy. But
they are unambiguously real joint and tendon load.

**Removing legs makes this constraint sharper, not softer.** Previously a legs
pair absorbed a third of every session's volume. With legs gone, the entire
5×30min budget lands on a smaller number of muscles that the starter plan is
*already* hammering. A naive "same sessions, minus the legs pair" would push
chest, back and arms far past useful.

**Therefore the plans below do NOT redistribute the freed leg volume into more
chest and back.** They spend it on the parts push-ups and pull-ups do not train:
side and rear delts, horizontal pulling, and direct core. Sessions also drop from
three pairs to a mix — see each plan's time note.

### 8.2 The three plans

All differ by **organising principle**, not by dose — they share an identical
5×30min budget, so a dose axis would make them reskins.

Muscle buckets in play: chest, back (lats), back (mid/traps), side delt, rear
delt, biceps, triceps, core. Front delt is a synergist-only bucket — it is a
secondary mover in every press, so its isolated number always undercounts true
stimulus and should not be read as a gap.

**Provenance note (2026-08-20).** The tables below are computed output from
`lib/fitness/seed-plans.ts` via `lib/fitness/volume.ts`'s `weeklyVolume`, not
hand arithmetic — and that is a change from how this section originally read.
The first version of these tables was hand-computed during the brainstorm
rounds, across several hours, before `weeklyVolume` existed as a tested
function, with inconsistent secondary-muscle crediting between exercises (a
press sometimes credited two secondary muscles, sometimes one). When
`weeklyVolume` was built (Phase 2) and actually run against anatomically
tagged versions of the same exercises (Phase 6), none of the three plans'
totals matched the original tables — Plan C came out nearly identical in
total (118.5 vs 117) but redistributed across muscles, while Plan A and B's
totals diverged outright, which is what pinned the cause on inconsistent
hand-tagging rather than a flaw in the new function. Two real errors were
also caught in the same pass: `overhead_press` was originally tagged
side-delt-primary (anatomically wrong — overhead pressing is
anterior-deltoid/front-delt dominant), and Plan B and Plan C each had at
least one muscle bucket computing over the evidence-backed 12–20
sets/muscle/week optimum once the arithmetic was actually run — a real
over-dosing risk given these plans are meant to stack against the starter
plan's 500 weekly push-ups and 150 pull-ups, not a rounding difference to
shrug off. The tags in `seed-plans.ts` are now the source of truth; the
tables below are derived from them and that derivation is enforced by
`lib/fitness/__tests__/seed-plans.test.ts` — a future edit to a tag that
makes that test disagree with these tables means regenerate the tables, never
retune the tag to force a match.

#### Plan A — Rotating Upper (uniform frequency, low per-session dose)

Every session touches push, pull and delts. Two alternating templates: A ×3/week,
B ×2/week. Three pairs, 3 rounds, ≈28.5 min.

*Session A* — cable chest press 3 ↔ pull-ups 3 · lateral raise 3 ↔ face pull 3 ·
triceps pushdown 3 ↔ hanging knee raise 3
*Session B* — incline-angle cable press 3 ↔ seated cable row 3 · lateral raise 3 ↔
rear-delt fly 3 · cable curl 3 ↔ cable crunch 3

Weekly: chest 15, back (lats) 9, back (mid/traps) 10.5, side delt 15, rear delt
18, triceps 16.5, biceps 13.5, core 15, front delt 7.5.

Rationale: highest frequency, lowest per-session fatigue — suits a beginner with
no accumulated training fatigue. Every bucket sits at or under the 20-set
ceiling; back (lats) at 9 and front delt at 7.5 sit under the 12 floor other
plans hit, which is fine here — Plan A was already inside every constraint on
the first computed pass and needed no trim.

**Ramp**: two rounds per pair for weeks 1–3 (~10 sets/muscle), then three.

#### Plan B — Push / Pull / Delts+Core / Push / Pull (segmented, high per-touch dose)

Fewer, bigger touches: each muscle ~2×/week at higher volume per touch, with one
dedicated day for the parts that are usually an afterthought. Two trim passes
on top of the first draft, both driven by the computed numbers rather than the
original hand estimate:

- **Mon Push** — chest press 3 + incline press 3 · dips 3 + pushdown 3 · lateral raise 3 + overhead press 3
- **Tue Pull** — pull-ups 3 + chest-supported row 3 · seated row 3 + face pull 3 · curl 3 + cable crunch 3
- **Wed Delts + Core** — lateral raise 3 ↔ rear-delt fly 3 · overhead press 3 ↔ face pull 3 · hanging leg raise 3 ↔ cable crunch 3
- **Thu Push** — chest press 3 + cable fly 3 · pushdown 3 + lateral raise 3 · overhead press 3 + hanging knee raise 3
- **Fri Pull** — pull-ups 3 + wide pulldown 3 · seated row 3 + face pull 3 · curl 3 + straight-arm pulldown 3

Weekly: chest 13.5, back (lats) 12, back (mid/traps) 13.5, front delt 15, side
delt 13.5, rear delt 15, biceps 15, triceps 18, core 12.

- *First trim* (over the 20-set ceiling): the original draft had Thu Push
  running dips again and Fri Pull running hammer curl again — both redundant
  with an exercise already hitting the same muscle earlier in the week — which
  put triceps at 22.5 and biceps at 21. Thu Push's dips became cable fly (no
  triceps secondary); Fri Pull's hammer curl became straight-arm pulldown (no
  biceps secondary). Triceps landed at 19.5, biceps at 18, both back under 20.
- *Second trim* (core under the floor): with the ceiling fixed, core sat at 6
  — the lowest number in the whole set, against Ayman's stated goal of visible
  abs, on the plan explicitly recommended once the starter plan is retired
  (§8.3). Tue Pull's redundant second biceps isolation (hammer curl again)
  became cable crunch; Thu Push's third chest movement (incline press, on top
  of chest press and cable fly in the same session) became hanging knee raise.
  Core reached 12, the floor.
- *Third change* (fixing the real gap, not an arbitrary number): back
  (mid/traps) sat at 10.5, just under 12 — but the reason it mattered isn't the
  floor, it's that 150 weekly pull-ups under the starter plan is already
  enormous **vertical**-pull volume with **zero** horizontal pulling, so
  back (lats) at 15 here was doubling down on what the starter plan already
  over-supplies while back (mid/traps) — the genuinely undertrained postural
  muscles that do more for "stops looking soft" than lat width does — sat
  low. Tue Pull's wide-grip pulldown (vertical, lats) became a second
  chest-supported row (horizontal, mid-back). Back (lats) dropped from 15 to
  12 — correct, not a loss, since the starter plan already covers it — and
  back (mid/traps) rose to 13.5.

Standalone this is the most conventional and most balanced of the three. **The
right pick once the daily rep targets are retired.**

#### Plan C — V-Taper Priority (asymmetric frequency, weak point favoured)

Organising principle, and the reason this is not a reskin: **push-ups and pull-ups
train the chest, lats and arms heavily and train side delts, rear delts,
horizontal pulling and direct core almost not at all.** Frequency is spent
deliberately on that deficit — a delt pair and a core movement appear in *every*
session, while chest and lat volume is held deliberately low.

This also serves the stated aesthetic goal directly: **visible abs plus shoulder
width is the V-taper that makes a skinny-fat frame read as fit**, and it is
achievable without touching legs.

1. chest press 3 ↔ seated row 3 · lateral raise 3 ↔ face pull 3 · cable crunch 3 ↔ pushdown 3
2. pull-ups 3 ↔ incline press 3 · lateral raise 3 ↔ rear-delt fly 3 · hanging leg raise 3 ↔ curl 3
3. seated row 3 ↔ chest press 3 · lateral raise 3 ↔ face pull 3 · cable woodchop 3 ↔ pushdown 3
4. pull-ups 3 ↔ incline press 3 · lateral raise 3 ↔ rear-delt fly 3 · hanging leg raise 3 ↔ curl 3
5. seated row 3 ↔ lateral raise 3 · face pull 3 ↔ overhead press 3 · cable crunch 3 ↔ hanging leg raise 3

Weekly: side delt 16.5, rear delt 19.5, back (mid/traps) 13.5, back (lats) 6,
core 18, chest 12, front delt 9, biceps 13.5, triceps 13.5.

**The table proves the principle**: side and rear delt reach 16.5–19.5 while
chest sits at 12 and back (lats) at 6 — the inverse of what a conventional plan
produces, and the correct inverse given what the starter plan already supplies.
Back (lats) at 6 stays deliberately low — the same under-train-what-the-starter-
already-supplies principle as Plan B's third change above, not an oversight.

- *Trim* (over the 20-set ceiling): the original draft paired face pull with
  rear-delt fly on day 5 — both hitting rear delt in the same session, on top
  of face pull and rear-delt fly each already appearing on three other days —
  which put rear delt at 22.5. The first replacement tried (a second curl) was
  wrong and caught before shipping: Plan C's whole point is under-training what
  the starter plan over-supplies, and a second curl dumped volume straight
  into biceps, which 150 weekly pull-ups already load heavily. The second
  replacement tried (a third core movement in one session — day 5 already ran
  two) pushed core to 21, over the ceiling from the other direction. Day 5's
  rear-delt fly became overhead press instead — it still relieves the
  rear-delt overshoot, adds nothing to biceps, and doesn't stack a third core
  slot into one session. Rear delt landed at 19.5.
- *Triceps at 13.5* is the lowest of the three plans and is deliberate: 500
  weekly push-ups already load triceps heavily, so adding direct volume here
  would be the clearest case of double-counting.
- **This is the best companion to a continuing starter plan.**

### 8.3 Which combination to run

**The starter plan should run AHEAD of a session plan for 2–4 weeks, not
simultaneously from day one.** Stacking a cable session's pull-ups and rows on
top of already-substantial daily pulling volume in week one risks real overreach
*before the ramp has done its job*. The starter plan IS the on-ramp.

If both are wanted from day one anyway, the mitigation is trimming the session
plan's pull-focused pairs for the first few weeks — not running both at full
dose.

After the on-ramp, **Plan C is the best companion to a continuing starter plan**
(it deliberately under-trains exactly what push-ups and pull-ups over-train).
Plan A or B are the better standalone picks once the daily rep targets are
retired.

This is a *training* recommendation, not an architectural one: the two objects
are orthogonal (§5) and the app supports running them concurrently. The
staggering is advice, not a constraint the software should enforce.

### 8.4 Honest caveat on plan contents

Exercise prescription has injury stakes. These plans are derived from the volume
and frequency literature cited, not from a certified programming source, and the
per-muscle arithmetic clears the evidence bar — but exercise *selection* deserves
a pass from a reputable published program before this becomes shipped copy. This
is flagged rather than smoothed over.

## 9. What gets deleted

**Current streak.** Ayman called it good; the Lead disagreed and the evidence
backs the disagreement. Volume-equated, 2×/week performs the same as 4×/week —
rest days are a designed feature, not a lapse. A daily streak punishes exactly the
correct behaviour and pushes toward junk frequency. It is not a neutral vanity
metric, it is an **anti-signal**.

**Workouts this month.** Blind to the only variable that matters. Two sessions of
3 sets and two of 15 sets both read as "2."

**The Habits panel as it exists.** Replaced per §7.

**The standalone "Log a workout" text input.** Absorbed into the detail panel and
quick-add.

## 10. Open items

1. **⚠️ DECISION FOR AYMAN — deload weeks.** Engineer 3 recommends a deload every
   4–6 weeks (~40–50% volume cut for a few days). This modifies "5 days a week"
   as he specified it, so it is *not* being inserted silently. His call.
2. **⚠️ DECISION FOR AYMAN — starter/plan sequencing.** §8.3 recommends running
   the starter plan alone for 2–4 weeks before adding a session plan. The Lead
   originally told him they could run concurrently from day one; that is true
   *architecturally* but is not the better training advice. Correction issued.
3. **Superseded (2026-08-19).** Two defects were open against the previous
   leg-inclusive plans — Plan C's chest/triceps imbalance and Plan B's rear delt
   at 7. Both plans were replaced wholesale when Ayman ruled legs out of scope.
   Superseded again (2026-08-20) along with item 4 below when §8.2's tables
   were regenerated from `weeklyVolume` — see §8.2's provenance note for why
   the numbers moved a second time. Recorded so the history is legible rather
   than silently dropped.
4. **Resolved (2026-08-20).** Core at 6 in Plan B was the lowest number in the
   set and the Lead overruled treating it as an acceptable pre-existing item —
   "a number being pre-existing is not a reason to ship it," specifically
   because Plan B is the standalone recommendation once the daily rep targets
   retire, and it would have shipped with the weakest number on the thing
   Ayman actually asked for. Fixed in the same pass that regenerated §8.2's
   tables: core is now 12. See §8.2's Plan B trim notes for what was cut.
5. **Plan exercise selection** wants a pass from a published program (§8.4).
3. **`workout_logs` has no duration column at all** — duration exists only on
   `workout_schedule` (added 2026-08-19 in `023`). A structured session record
   makes this moot but the migration path needs stating in the implementation
   plan.
4. **`workout_logs` has no unique constraint on (user_id, date)** — the same day
   can be logged twice. Pre-existing; decide whether the new session model needs
   one.
5. **Notification killability** (§3.1) must be verified against the existing push
   infrastructure rather than assumed.

## 11. Provenance

- Volume dose-response, fractional set crediting, frequency equivalence: Pelland
  et al. 2025 meta-regression (PubMed 41343037); Schoenfeld/Ogborn/Krieger 2017
  (PubMed 27433992); Baz-Valle et al. 2022 (PMC8884877) — 12–20 sets/muscle/week
  optimum.
- Recomposition in untrained individuals: Barakat et al. 2020.
- Protein in a deficit: Longland et al. 2016.
- Rest interval: PMC11349676.
- Grease-the-groove: Tsatsouline lineage; Mountain Tactical 2020 mini-study;
  Grgic et al. 2018 vs Schoenfeld/Grgic/Krieger 2019 for the
  strength-not-hypertrophy boundary.
- Weight noise and waist as the better recomp signal; daily weighing associated
  with better outcomes when read as a moving average (Wing et al.; NWCR).
