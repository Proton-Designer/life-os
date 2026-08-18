# Operator productivity research — Hormozi, Jobs, O'Leary, Musk

**Author:** Engineer 2 (components/verification), overnight session, 2026-08-18.
**Scope:** Per the overnight brief §2.2 (Agent A) and Opus Lead's follow-up — Ayman's four named examples,
not an exhaustive list. Productivity, focus, and how these four structure a day, not general business
strategy. tiyo5ktl is running the parallel books track
(`docs/superpowers/research/2026-08-18-productivity-books-research.md`) — this file stays on
person-attributed material and doesn't duplicate book summaries.

## Method and how to read this

Lead set two bars: **attribute specifically** (a lot of what circulates under these names is
invented), and **surface where they contradict each other**. So every claim below carries a
confidence tag and, where possible, a primary or near-primary source — not a listicle blog restating
another listicle blog.

- **Verified** — a direct quote or documented statement from the person themselves, traceable to an
  interview, talk, tweet, or biography with named cooperation.
- **Attributed, secondhand** — a specific person (not "sources say") reporting what the operator said
  or did, but not the operator's own words. O'Leary's "Jobs told me" stories are this category — real
  as O'Leary's account, not independently verifiable as Jobs's.
- **Circulating, unverified** — repeated across productivity blogs/TikTok/LinkedIn with no traceable
  primary source. Included only where flagged, because knowing what's *not* real is part of the ask.

Every practice is also tagged **[solo]** or **[org]** — see the dedicated section at the bottom for
why that split matters more than the practices themselves.

---

## Alex Hormozi

**Six-day, 12-hour work weeks.** Verified — Hormozi has said this on his own podcast (*The Game w/
Alex Hormozi*) and publicly proposed normalizing a 72-hour week for young men early in their careers.
**[solo]** — a personal time-allocation choice, not a policy that needs staff to execute.

**Sleep as non-negotiable.** Verified, same source family — 7–8 hours, no screens after 9pm, fixed
wake time (he cites 4am consistently, including weekends). Worth naming the tension directly: this
sits next to the 72-hour-week advice from the same person. Extreme hours and enforced sleep discipline
are not opposites in his own framing — his implicit claim is that recovery is what lets the following
day's 12 hours be real output, not just time at a desk. **[solo]**

**"Maker" vs. "Manager" schedule.** Circulating widely under Hormozi's name (a viral TikTok summary),
but the concept is not his — it originates with Paul Graham's 2009 essay "Maker's Schedule, Manager's
Schedule." Hormozi has referenced and applied it, but the framework itself predates him by over a
decade. Flagging this explicitly because it's the single clearest example of the "half of this is
invented" problem Lead named: the *practice* (protect long blocks for deep work, batch meetings) is
real and worth having, the *attribution* to Hormozi as originator is not. **[solo]**

**"Backward" calendar scheduling** (letting bookable slots fill from the end of the day backward, to
protect the earliest, highest-focus hours). **Circulating, unverified** — sourced to a single TikTok
account restating the strategy, not to Hormozi's own words. The underlying idea is sound and doesn't
need his name attached to be worth adopting; it's listed here so it isn't mistaken for something he
said on record.

**Simple time tracking.** Verified, low-confidence-on-specifics — Hormozi has described tracking where
time actually goes as one of the least glamorous, highest-leverage habits, on the reasoning that most
people are wrong about their own time allocation until they measure it. **[solo]**

---

## Steve Jobs

**"Focus is about saying no."** Verified — Apple's 1997 WWDC developer Q&A, on video: *"Focusing is
about saying no... you've got to say no, no, no, and when you say no, you piss off people."* This talk
is the primary source cited everywhere else this line appears; treat any version that doesn't trace
back to it as secondhand paraphrase.

**"Innovation is saying no to a thousand things."** Verified, same era — Jobs's own framing of Apple's
post-1997 product-line cut (from roughly 15 products down to 4) as the practical result of the
say-no principle, not just a slogan. **[org]** — this specific act (killing product lines) needed
organizational authority to execute; the *underlying discipline* (a real no, not a maybe) is **[solo]**.

**"Simple can be harder than complex — you have to work hard to get your thinking clean to make it
simple."** Verified — quoted directly in Walter Isaacson's authorized biography, drawn from
Isaacson's direct interviews with Jobs. **[solo]**

**Extreme hours / workaholic reputation.** Attributed, secondhand and general — well-documented across
Isaacson's biography and contemporaneous reporting (TIME's 1996 "Steve's Two Jobs," on running Apple
and Pixar simultaneously) that Jobs worked very long hours and was known for late-night calls to
employees. No single verified quote pins an exact weekly number the way Musk's does — this is
reputation-level, not a specific self-reported figure. Included because it matters for the
contradiction below, not because it's a clean number to build on.

---

## Kevin O'Leary

**Three tasks, written the night before.** Verified — O'Leary has described this repeatedly across
interviews (CNBC, Yahoo Finance among them): every night, he writes exactly three must-do tasks on a
Post-it, and does them first the next morning, before calls or email. **[solo]** — this is the most
directly actionable, zero-infrastructure practice in this whole set. It is also, concretely, the exact
shape of this app's existing `kill_list_items` schema (three slots per day, `position` 0–2) — see the
solo-operator section below.

**"80% signal, 20% noise" — attributed to a conversation with Steve Jobs.** Attributed, secondhand —
O'Leary's own retelling (CNBC, 2017–2018 interviews) of Jobs personally telling him to distinguish
"the signal" (the day's three real tasks) from "the noise" (everything else). This is O'Leary's
account of a private conversation; there is no independent Jobs-side verification it happened in these
words. Treat the phrase as O'Leary's operating principle, sourced to Jobs by O'Leary alone, not as a
verified Jobs quote in its own right — a distinction worth being precise about given Lead's bar.
**[solo]**

**ROI self-check ("Am I making money doing this?").** Verified, O'Leary's own stated framing for
recognizing he's drifted off-task. **[solo]** — though note this is a business-specific filter
(literally asks about money), narrower than a general focus check; it maps well onto work sessions,
not onto every domain of a personal system.

**Weekly/monthly/quarterly journaling as a check-in and strategy-adjustment habit.** Verified,
O'Leary's own stated practice. **[solo]**

---

## Elon Musk

**80–100 hour weeks, "nobody changed the world on 40 hours a week."** Verified — posted directly on
Twitter/X, November 26 2018, reported contemporaneously by Bloomberg. Musk also quantified it further
when pressed: *"Varies per person, but about 80 sustained, peaking above 100 at times. Pain level
increases exponentially above 80."** That second line matters — even Musk's own framing treats extreme
hours as having a real, named cost, not as free upside. **[solo]** in the sense that it's a personal
choice, but the pain-scaling caveat is worth carrying into any design that would encourage this
pattern rather than just glorify it.

**The "5-minute time-blocking" productivity hack — false, debunked by Musk himself.** This is the
single cleanest example of invented content circulating under one of these four names. A 2018 post
claimed Musk scheduled his entire day in 5-minute blocks; Musk replied directly on Twitter: *"I
definitely don't do this 5 minute thing. Need to have long uninterrupted times to think. Can't be
creative otherwise."* The real, verified position is close to the opposite of the viral version —
protect long blocks, not fragment the day into 5-minute units. Worth stating plainly: this is exactly
the kind of "half of what circulates is invented" case Lead flagged, and it's still being republished
as fact by productivity blogs as of this research.

**"The Algorithm" — a 5-step process, in order: question every requirement; delete what you can (if
you don't restore ≥10% of what you cut, you didn't cut enough); simplify what's left; accelerate cycle
time; automate last.** Verified — laid out by Musk directly to Tim Dodd (Everyday Astronaut) in a
recorded interview at the SpaceX Starbase facility, explaining a specific engineering failure (rocket
grid fins). The order is the point — Musk is explicit that simplifying or automating a step that
shouldn't exist at all is worse than doing nothing, because it locks in waste instead of removing it.
**[org]** as originally stated (an engineering-process discipline for a team), but the first two steps
— question every requirement, then delete — translate directly to a single person's daily task list:
before optimizing *how* something on a list gets done, ask whether it needs to be on the list at all.
**[solo]**-adaptable.

---

## Where they contradict each other

Naming this directly, per Lead's bar — a system built to satisfy all four literally at once would be
incoherent, so the design has to pick a stance rather than average them.

**Hours-as-the-lever vs. subtraction-as-the-lever.** Musk (80–100 hrs, explicitly the "way") and
Hormozi (72 hrs, publicly proposed as a norm) both frame extreme output primarily as a function of time
committed. Jobs ("no to a thousand things") and O'Leary (three tasks, everything else is noise) frame
it primarily as a function of what gets cut, independent of hours worked. These aren't fully opposed —
Musk's own Algorithm starts with deletion, not hours — but the *public-facing advice* each gives
leads with a different lever. A system that just says "work more" and a system that just says "do
less" are different products; this app already leans toward the second (a 3-item kill list, a focus
timer, not a timesheet), and that's worth stating as a deliberate choice, not an oversight.

**Deep, uninterrupted time vs. rapid iteration.** Musk on creativity ("need long uninterrupted times to
think, can't be creative otherwise") and Jobs on simplicity as something you "work hard" toward both
point at slow, protected, singular focus. Musk's own Algorithm, by contrast, is explicitly about speed
— "accelerate cycle time" is one of the five steps, and Tesla's production-hell context that produced
it was about compressing iteration time under pressure, not protecting long unhurried blocks. Even
within one person's stated philosophy, "protect deep time" and "move fast" sit in real tension — this
isn't only a cross-person contradiction.

**Public extremity vs. private discipline.** Musk and Hormozi's most quotable, most-repeated advice is
the extreme-hours framing — the part that goes viral. But the concrete, actually-repeatable daily
mechanics from this research (O'Leary's Post-it, Hormozi's non-negotiable sleep window, Jobs's habit of
saying no) are all modest, boring, and about constraint rather than volume. The loud advice and the
practiced advice aren't the same advice. Worth being honest that a habit-building feature modeled on
what these people are *famous for saying* would look different from one modeled on what they're
*verified to actually do daily.*

---

## Solo operator vs. requires-staff — why this split matters here

Per Lead's note: `kill_list_items` and `weekly_goals` are both empty in production (0 rows, confirmed
in `docs/superpowers/research/2026-08-18-business-current-state.md`). Ayman has never used either.
Advice premised on delegation, a team, or an assistant is real advice, but it's not actionable in this
account today — so the split above isn't academic, it determines which of these findings are worth
building toward first.

**Directly usable by one person tomorrow morning, no infrastructure required:**
- O'Leary's three-tasks-the-night-before — and notably, this app's `kill_list_items` schema (three
  slots, `position` 0–2) is *already shaped exactly like this practice*. The schema isn't waiting on a
  new feature; it's waiting on the habit that fills it. That's the single strongest concrete link this
  research surfaced between a named operator's stated practice and something already built here.
- Jobs's "say no" as a real daily filter (does this survive being questioned, not "does this sound
  reasonable") — cheap to apply to a kill-list entry or a weekly-goal headline before it's written
  down, costs nothing to build.
- Hormozi's sleep-window discipline and simple time-tracking — both purely personal, no team needed.
- O'Leary's own "signal vs. noise" framing maps directly onto this app's existing Signal:Noise ratio
  widget (`checkins.tag_type`) — that widget already measures the exact distinction O'Leary describes;
  today it's presented as a passive retrospective number (per the current-state research: "nothing
  acts on it"). The operator-research angle argues for making it something you check *during* the day
  the way O'Leary does, not just something you're shown after.
- Musk's Algorithm, steps 1–2 only (question the requirement, then delete) — adaptable to a single
  person's task list without needing an engineering org to execute the rest of the steps.

**Requires staff, delegation, or organizational scale to execute as originally practiced:**
- Hormozi's "backward calendar scheduling" as described (someone else is doing the booking).
- Jobs's 1997 product-line cuts (killing entire product lines needs the authority and the org beneath
  it) — the *discipline* generalizes, the *act* doesn't.
- Musk's Algorithm as a five-step whole — steps 3–5 (simplify, accelerate cycle time, automate) are
  meaningful at the scale of a manufacturing line or an engineering process; applied literally to a
  single person's day they're a stretch.
- Any advice that assumes someone else screens the calendar, triages email, or executes the "automate"
  step on your behalf.

The practical takeaway for the eventual Business brainstorm: the four names Ayman gave lean hard
toward company-builder advice in their *public reputation*, but the specific, verified, repeatable
mechanics underneath that reputation are almost all solo-executable. That's the material worth
building from — not the 80-hour-week headline, but the Post-it note underneath it.
