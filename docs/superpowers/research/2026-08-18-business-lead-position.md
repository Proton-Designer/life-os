# Business section — Lead's position going into the brainstorm

**Author:** Opus Lead, 2026-08-18, written before the operator research landed
**Status:** a position to be argued with, not a decision

Written down in advance so the brainstorm is an argument between stated views rather than me
improvising and calling whatever I say the conclusion. Both engineers should attack this.

## The diagnosis

**The Business section is a measurement system for work that is never captured.** It measures focus
time, days cleared, and signal-to-noise. It does not *drive* anything. And the two tables it would
measure — `kill_list_items` and `weekly_goals` — are empty in production. Never used, not once.

So the section's problem is not presentation. Every widget on it is downstream of an act of entry
that isn't happening.

## The gap I think matters most

**Nothing connects the weekly goal to today's three things.**

You set a headline goal on Saturday. On Monday morning you open Business and face three blank boxes
that make no reference to it. The weekly goal is a poster on one screen; the kill list is a blank
slate on another. The mechanism that would connect them — "this week I'm doing X, so today's three
things are…" — doesn't exist anywhere in the product.

That gap is exactly where the strongest evidence from both research tracks lands. Gollwitzer's
implementation intentions (d=0.65, ~8,000 participants, reaffirmed across 642 tests) say a specific
plan roughly doubles follow-through. Masicampo & Baumeister's Zeigarnik work says an unfinished
intention keeps intruding on attention **until a specific plan exists** — not until it's done. Two
independent research programs, the same mechanism. Both describe the step this product is missing.

**My lead proposal: the kill list should be written in the presence of the weekly goal, not
independently of it.** Show the goal above the three slots. That is free — the data already exists,
both are already queried on the Business page, and it needs no schema. It converts "what should I do
today?" (a hard question at 7am) into "what moves X today?" (a much easier one).

## Where I think the current design actively works against him

**The kill list's empty state is three simultaneous edit forms.** `KillListSlot` starts in edit mode
when it has no text, so with zero rows all three open at once — three inputs, three Save buttons.
That is what he sees the first time he ever opens the screen, and every morning until he starts using
it. A blank form array is paperwork. Three items you're invited to name is a decision. Same data,
different feeling, and the difference is plausibly part of why the table is empty.

**Nothing on the screen says what a kill-list item is.** He designed the concept, so it's obvious to
him — and he still hasn't used it once. Obvious-to-the-designer is not the same as actionable at 7am.

**Both confirmed live at 390px against the real empty state** (Engineer 1, 2026-08-18). The panel is
three identical bordered inputs placeholdered "Priority 1/2/3", each with its own adjacent Save
button, and no other copy anywhere. Their read: *"the grammar of three separate micro-transactions,
not one framed act… at 7am half-awake, that reads as data entry, not a ritual."* Nothing states what
a kill-list item is, gives an example, or says why exactly three.

**And the same shape appears in the other unused module.** "This week's goal" is a blank headline
input, a blank milestones textarea, a Save button, and zero framing copy. **The two tables that have
never been written to are the two modules that present as empty forms with no explanation.** That
correlation is the strongest evidence available tonight about why nothing has been entered, and it
means the fix is a pattern-level one, not a Kill-List-specific one.

### Corrections to the above, from Engineer 1's critique (2026-08-18)

**The goal↔kill-list connection is not a cold-start unlock, and I mis-billed it.** `weekly_goals` is
*also* empty. So on the exact morning we're trying to unblock there is no goal to display, and "what
moves X today?" becomes a question with no available answer rather than an easier question. The
connection is real leverage from the **second** cycle onward — a relevance and retention mechanism
once both flows have started — not the fix for "nothing has ever been entered." It should be
sequenced after whatever fixes each module's own first-entry moment, not offered as a substitute for
either.

**"Add no widgets" is broader than my own stated test and would kill something I'd want.** My test is
*does it drive entry and completion*. But a structural "no new panels" rule also excludes a widget
that **is itself the entry mechanism** — Engineer 1's "yesterday's unfinished items resurface"
candidate renders as a list, but its justification is entry psychology (knowing an item resurfaces
rather than vanishing lowers the cost of writing it down), not display quality. Sharpened rule:
**no widgets whose burden of proof is display quality.** That still kills the unfalsifiable ones
without killing entry-side mechanisms that happen to render as lists.

**The three-slot cap should be defended as product philosophy, not as evidence.** Essentialism is
🔴-tier in the books research — an author's argument, no independent evidence. The cap is coherent
and matches Ayman's own design intent, and that is a sufficient defence; dressing it as empirically
backed would be overclaiming.

**And the tension Engineer 1 surfaced dissolves rather than resolves.** Fogg's ability principle
(🟡, moderate) says the *first* instance of a new behaviour should be shrunk to the smallest possible
unit. "Three required slots, all open simultaneously" is the opposite of that at precisely the
cold-start moment. But Essentialism is a claim about the **steady-state shape** and Fogg is a claim
about the **first ask** — both can hold at once: permanent cap of three, first-ever ask of one. That
is a concrete design consequence, not a compromise.

## What I want to argue about

**Hours as a headline.** Pencavel's archival output data — real production records, not self-report —
shows productivity per hour falling sharply past ~50 hours a week and additional hours past ~55
producing essentially nothing. "Focus time today" is a headline number on this screen. I don't think
it should be deleted: it's a reasonable proxy for deliberate work versus drift, and it's what the
check-ins hang off. But I want to argue about whether the product should ever present accumulated
hours as an *achievement*, versus as context for output. Input metrics presented as scores reward
sitting longer.

His own layout already puts the Kill List above focus time, which is the right instinct. This is
about framing and copy more than position.

**Signal:Noise is retrospective and inert.** It's the richest data in the section — `checkins` is the
one table with real volume — and nothing ever acts on it. A ratio you look at after the fact and can
do nothing with is a scoreboard, not a system.

**The two contradictions from the books track are live here, and we have to pick.** Drucker/GTD says
plan from measured data; Rework says plans are guesses and you should bias to shipping. Essentialism
promises mastery through ruthless prioritization; Four Thousand Weeks says that promise is itself the
trap. A three-slot kill list is already an Essentialist artifact — the cap is the point. I think that
cap should be defended, not widened, but I want it defended deliberately rather than by inertia.

## What I am against

**Adding widgets.** The section does not need more surface. It needs the entry act to happen. Any
proposal that adds a panel should have to explain why it beats fixing the first thirty seconds of a
Monday morning.

**Building for data we don't have.** Two of the four tables are empty. A proposal justified by how
well it visualizes patterns is unfalsifiable right now.

**Milestone completion as a quiet assumption.** `weekly_goals.milestones` is a jsonb array of plain
strings with no per-item state, so a milestone cannot be checked off. Any proposal depending on
milestone progress is a schema change and must say so.
