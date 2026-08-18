# Business section — brainstorm synthesis

**Status:** synthesis for Ayman's decision. Nothing here is built.
**Author:** Opus Lead, 2026-08-18, from two research tracks and two rounds of engineer critique.

**Inputs:** `2026-08-18-productivity-books-research.md` (Engineer 1),
`2026-08-18-operator-productivity-research.md` (Engineer 2),
`2026-08-18-business-current-state.md`, `2026-08-18-business-lead-position.md`,
`2026-08-18-business-proposals-books.md`, `2026-08-18-candidate-a-cost-sketch.md`.

---

## 1. The finding everything else follows from

`kill_list_items`: **0 rows.** `weekly_goals`: **0 rows.** Neither has ever been used.

Both of those modules present, live at 390px, as **blank forms with no framing copy**: three identical
bordered inputs each demanding its own Save button, and a goal panel that is a blank headline field
plus a blank textarea. Nothing on either screen says what the thing is, gives an example, or explains
why exactly three.

**The two tables that have never been written to are the two modules that present as unexplained
forms.** That correlation is the strongest evidence available about why nothing has been entered, and
it means the problem is entry, not display. Every widget on this screen is downstream of an act that
isn't happening.

## 2. Ayman's design is validated by the research — that's why the fix is activation, not redesign

Kevin O'Leary's stated nightly practice is writing **three** things on Post-it notes for the next
day. `kill_list_items` has exactly three slots, `position` 0–2, capped in the schema.

**The product already implements the practice.** Ayman arrived at the same structure independently.
This matters because it settles what kind of problem this is: the design isn't wrong and doesn't need
rethinking. It has never been started.

Same story for Signal:Noise — O'Leary's own signal-versus-noise framing maps directly onto the widget
that already exists.

## 3. Where the research genuinely disagrees, and how I'd resolve it

**Hours as the lever vs. subtraction as the lever.** Musk (80–100hr weeks) and Hormozi sit on one
side; Jobs ("saying no to a thousand things") and O'Leary (three tasks, nothing else) on the other.
This isn't a nuance — they are opposite claims about what produces output.

**It resolves on the operators' own practiced behaviour** — which is stronger ground than any outside
dataset, and is the correction Engineer 2 made to this section.

Every one of the four operators' **verified, repeated, actual daily mechanics** is subtraction-shaped:
O'Leary's three Post-its, Jobs's say-no filter, Hormozi's non-negotiable sleep floor, and even Musk's
Algorithm, which opens with *question the requirement* and *delete*. Meanwhile the only pro-hours
claims in the entire set are the least-verified and most-viral ones — and Musk's own 2018 tweet
refuting the 5-minute-blocking myth is him rejecting volume-over-protection **in his own words**.

So hours-as-lever has no *practiced* evidence behind it even from the people who advocate it. Their
stated advice and their described behaviour point in different directions, and the behaviour is the
part that's verifiable.

**On Pencavel — demoted, deliberately.** An earlier draft rested this conclusion on his archival
output data (munitions plants, plywood mills). Engineer 2's objection is correct and I'd rather record
it than quietly drop it: **that data is repetitive, physically fatiguing manual labour, and the claim
here is about creative and strategic work.** That's a different domain, not a scaled version of the
same one, and a sharp reader punctures it in one sentence — *"that's factory-floor labour, not founder
work."* It stays as a data point from outside the domain pointing the same direction. It is no longer
what the conclusion rests on.

**Product consequence: the app should never present accumulated hours as an achievement.** Focus time
stays — it is a reasonable proxy for deliberate work versus drift, and the check-ins hang off it —
but as *context for output*, never as a score. An input metric presented as a score rewards sitting
longer.

**A second contradiction, inside one person:** Musk's Algorithm opens with "accelerate cycle time"
while his other stated view is that he needs long uninterrupted stretches to think. Move fast and
protect deep time do not fully agree even within a single operator. Anyone building a system that
tries to satisfy every source at once will satisfy none.

## 4. What the research says is worth *ignoring*

Both tracks spent effort separating real findings from folklore, and the folklore is load-bearing in
popular advice:

- **Musk's "5-minute time blocking" is false.** He publicly refuted it in 2018 — *"I definitely don't
  do this… need long uninterrupted times to think."* It is still republished as fact today.
- **Hormozi's "backward calendar scheduling"** traces to a single TikTok, not to him.
- **The maker/manager schedule is Paul Graham's**, 2009, not Hormozi's.
- **"21 days to form a habit"** traces to a 1960 plastic-surgery anecdote. The real figure is ~66 days
  with an 18–254 day range.
- **Growth mindset** is real but oversold by roughly a factor of ten.
- **The 70%/35% accountability-partner statistic** is not peer-reviewed and has never been replicated.

Not building on any of these is a decision, and it's worth stating as one.

## 5. Recommendations, ranked

### R1 — Frame both empty modules. Say what the thing is.

Neither module explains itself. Add framing to the Kill List and This Week's Goal: what it is, why
three, one concrete example. This is copy, not architecture, and it targets the exact failure the
evidence points at.

**Why it's first:** it is the cheapest change on this list and it addresses the only problem the data
actually demonstrates.

### R2 — One slot open, two behind "+ add another". Permanently, not just on day one.

Fogg's ability principle (🟡, moderate) says the first instance of a new behaviour should be shrunk to
the smallest possible unit. The three-slot cap says the constraint *is* the point — you have to decide
what is **not** on the list.

**The cap is defended by O'Leary's verified practice, not by Essentialism.** He writes three, nightly,
by his own repeated account. That is a practised behaviour, firmer ground than a book's argument;
Essentialism is 🔴-tier and supports the same shape without carrying it.

**An earlier draft of this recommendation was "first-ever ask of one, permanent cap of three."
Engineer 2 showed it solves the wrong shrinkage,** and the objection is decisive: the cap's entire
justification is that choosing three forces a trade-off. **One item has no trade-off.** That isn't a
smaller version of the exercise — it's a different, easier exercise. So day one would teach a habit
that doesn't resemble the one the cap exists to build, then demand a discontinuous jump to the real
thing on day two. It also left a mechanism question unanswered: do slots two and three appear the
instant slot one is saved (making the "smaller ask" cosmetic, five seconds of staggering) or the next
day (genuinely teaching the wrong exercise)? Unanswerable as stated, which made it a slogan.

**The better shape, and the recommendation: don't special-case the first time at all.** Render slot 1
open and required, with slots 2 and 3 behind a small collapsed "+ add another" affordance — **every
day, permanently.** This lowers the ability floor exactly as Fogg wants (one required field, far less
upfront density) while keeping all three slots visible and available, so the trade-off framing
survives rather than being hidden until day two. No first-run detection, no one-day-only UI, and no
quiet change to which habit is being formed.

It also reuses the same collapsed-affordance pattern the cost sketch already proposed for the
trigger-cue field — a known-cheap pattern rather than a new one.

### R3 — Yesterday's unfinished items resurface instead of vanishing.

Today an incomplete kill-list item simply disappears at midnight. Surfacing yesterday's leftovers
reuses the Qada backlog pattern exactly and **needs no schema** — a correction I owe Engineer 1, since
my own analysis wrongly marked this "needs schema" by conflating *showing* leftovers with *linking*
rows across days.

Justified by entry psychology, not display: knowing an item resurfaces rather than evaporating lowers
the cost of writing it down at all.

### R4 — Make Signal:Noise something you check during the day, not after it.

`checkins` is the richest table in the section and the only one with real volume, and the widget built
on it is purely retrospective. O'Leary's framing is a live discipline — signal or noise, right now —
not a scoreboard. A ratio you can only read afterwards and never act on is a scoreboard.

**Mechanism** (Engineer 2 — this was the vaguest item on the list until they scoped it): check-ins
already fire during an active Lock-In session, so the live moment already exists. Surface **today's
running signal:noise ratio inline in the Lock-In panel itself**, updating after each check-in, rather
than only in the weekly chart further down the page. No new table, no new action — it reads today's
check-ins where the session UI already lives. Each check-in becomes a feedback moment you can see
move, instead of a silent write whose only readout is a chart you consult later.

A smaller v1 is available if scope tightens: today's ratio as a static number in the Lock-In panel,
without live updating. Still a real improvement over "visible only in a weekly aggregate," and cheap.

### R5 — Deferred, deliberately.

- **Connecting the weekly goal to the kill list.** Real leverage from the *second* cycle onward, but
  worthless on the morning we're trying to unblock, because there is no goal yet either. I originally
  billed this as the highest-leverage change; Engineer 1 showed it solves a steady-state problem while
  claiming to solve a cold start.
- **If-then cues on kill-list items.** The strongest evidence in either track (Gollwitzer, d=0.65),
  but the cost sketch found the real density picture: all three slots already open in edit mode
  simultaneously on an empty day, so a second field per slot means six inputs and three Save buttons
  on a phone at 7am. Collapsing it behind a toggle protects density but may suppress the very uptake
  the evidence depends on. Worth doing **after** entry is actually happening.
- **Milestone completion.** `weekly_goals.milestones` is a jsonb array of plain strings with no
  per-item state, so a milestone cannot be checked off. A weekly goal you cannot make progress against
  is a poster. This is a schema change and is named as one rather than smuggled in.

## 6. What I am explicitly not recommending

**More widgets whose burden of proof is display quality.** Two of four tables are empty, so any
proposal justified by how well it visualizes patterns is unfalsifiable tonight. (Sharpened from my
original "add no widgets," which Engineer 1 correctly showed was broader than my own test and would
have excluded R3, an entry mechanism that merely renders as a list.)

**Widening the three-slot cap.** It is the product's spine, it matches an operator's real practice,
and it is the one place the section already says no on Ayman's behalf.

## 7. Open questions for Ayman

**R2 changes a screen he designed.** Two of three kill-list slots would sit behind a "+ add another"
control rather than being open by default. The cap stays three and all three stay visible — but the
default shape of the panel changes, permanently, not just on day one. His call.

**We are partly overruling advice he asked for.** He named Musk and Hormozi among the operators to
learn from. The synthesis concludes that the hours-as-lever position they represent isn't supported —
not even by their own practised behaviour — and that the app should never present accumulated hours as
an achievement. That conclusion is defensible and it is still a disagreement with people he chose. He
should know we reached it rather than find it embedded in the product.

**Three deferrals are judgement calls, not blockers**, and any of them can be pulled forward: the
goal↔kill-list connection, if-then cues on kill-list items, and milestone completion (the only one of
the three that needs a schema change).
