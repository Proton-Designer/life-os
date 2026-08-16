# Life OS — Power Architecture (post-refactor roadmap)

**Date:** 2026-08-16 (drafted overnight while Ayman is asleep)
**Status:** DRAFT — architect's proposal, **not authorized to build**. Requires Ayman's review.
**Relationship to current work:** the structural refactor (`2026-08-15-frontend-structural-refactor.md`, phases A–H) continues unchanged and finishes first. Nothing here starts until that lands and Ayman approves this direction.

## Why this document exists

Ayman's instruction, given as he went to sleep: *"keep restructuring and optimizing all of the elements and brainstorming, make this into the most powerful personal app and productive as possible."*

Normally a brief this open-ended would start with a brainstorming session — exploring intent before proposing solutions. He's unreachable, and the standing overnight rule is no clarifying questions. So this is written as a **proposal to be argued with**, not a plan to be executed: every judgment call is stated explicitly so he can reject individual pieces without discarding the whole.

## The thesis

**Life OS records well and decides poorly.**

Every screen answers *what happened*. Almost nothing answers *what should I do now* beyond Home's priority list, which is a due-date sort — and urgency is not importance. The structural refactor is making the recording legible and, after tonight, genuinely good-looking. But a more beautiful ledger is still a ledger.

Power, for a personal operating system, is not more tracking. It is:

1. **Capture** — getting something out of your head into the system at near-zero cost.
2. **Decide** — turning what's in the system into the next right action.
3. **Learn** — turning accumulated history into self-knowledge you didn't have.

Life OS today is strong on a fourth thing — *record* — and weak on all three of these. That's the gap.

---

## Gap 1 — Capture

**The problem.** There is no way to add anything without navigating to the correct domain screen and filling a form. Nine screens, no global "add," no keyboard entry point. A thought during a lecture, an idea mid-workout, a task mentioned in a co-op standup — all of it requires a context switch the moment it occurs, so in practice it doesn't get captured at all. It lives in his head or in some other app, which is the failure mode that kills personal systems.

There is also **no inbox**. The kill list deliberately resets daily with no carry-forward (a good decision — it forces re-prioritisation). But that means an undone item simply evaporates. There is nowhere for "not today, but real" to live.

**Proposal.**

- **Command palette (`⌘K` / `Ctrl+K`).** One keystroke from anywhere. Does three jobs: navigate (jump to any screen), act (mark a prayer, start a Lock-In, log pages), and capture (type anything → it lands in the Inbox). This is also the honest answer to the search field I rejected during the refactor — I was right that a generic text search over nine screens is filler, but wrong that there's nothing to reach for. The palette is the retrieval surface; it just isn't a search box.
- **Mobile quick-capture.** A persistent affordance on the floating island — press to capture text, hold for voice-to-text via the Web Speech API. Phone-first capture is where most real capture happens.
- **Inbox.** A single undated list, plus a triage surface: each item gets sent to a domain, promoted to today's kill list, scheduled, or dropped. Home surfaces an inbox count only when non-empty. This is the missing half of the kill list's daily reset — reset stays ruthless, but ideas stop evaporating.
- **Offline capture queue.** The service worker currently caches nothing. Capture that fails on a bad connection is worse than no capture, because it silently loses trust. Writes queue in IndexedDB and flush on reconnect. This is the one piece of offline work worth doing; full offline-first for the whole app is not.

**Why this is first.** Every other idea in this document depends on data existing. Capture friction is upstream of everything.

---

## Gap 2 — Decide

**The problem.** Four distinct failures:

1. **Urgency ≠ importance.** `getPriorityItems` sorts by due time with a fixed domain tie-break. A trivial task due in an hour outranks the one thing that actually moves the week. There is no importance signal anywhere in the model.
2. **The weekly goal is inert.** It's set during Weekly Planning, displayed on a card, and then referenced by nothing. It doesn't shape the kill list, doesn't appear during a Lock-In, doesn't influence Home. A goal that nothing consults is a note.
3. **No conflict detection.** A class at 2pm and a workout scheduled at 2pm coexist happily. Nothing notices, so the schedule silently lies.
4. **No daily review.** The original design spec describes the app as *"a twice-daily dashboard — morning planning, night review."* Weekly Planning exists; the nightly half was never built. There is no moment where the day gets closed, nothing to convert a day's data into tomorrow's plan.

**Proposal.**

- **Daily Review (evening ritual).** The missing half of the app's own stated design. A short, fixed flow: what got done, what didn't and why (one tap: no time / low energy / deprioritised / forgot), tomorrow's three kill-list items chosen now rather than tomorrow morning, and one line on the day. Triggered by a notification inside the check-in window's tail. It's also the highest-quality data source in the whole system — self-reported *reasons* are what make Gap 3 possible.
- **Goal linkage.** When setting a kill-list item, optionally tag it to this week's goal. Then the goal card shows real progress ("4 of 7 kill-list items this week served the goal"), and Weekly Planning's review has something honest to review. Optional, never mandatory — forced tagging is how systems die.
- **Importance as a first-class field.** A single boolean is enough: *leverage* (this compounds) vs everything else. Home's sort becomes urgency-within-importance rather than pure urgency. Deliberately not a 1–5 scale — granularity nobody maintains.
- **Conflict detection.** Cross-domain overlap check across `schedule_events`, workouts, and class times, surfaced on Home and at Weekly Planning. Cheap to compute, and it's the kind of thing that erodes trust in a schedule when missing.

---

## Gap 3 — Learn

**The problem.** Months of prayer, focus, workout, and check-in history exist, and the app tells him nothing he didn't already know. Insights shows a Focus Map and Signal:Noise ratios — descriptive statistics, not self-knowledge. The system has never once told him something about himself.

This is the largest untapped asset in the app, and the one thing a *personal* OS can do that no general tool can, because the data is unified across domains that normally live in separate apps.

**Proposal — a Patterns engine, no AI required for tier one.** Simple correlations over local data, stated in plain language, with the evidence attached:

- *"Your kill list gets cleared on 78% of days you Lock In before 10am, and 24% of days you don't."*
- *"Asr is your weakest prayer — missed 11 of the last 30. Every other prayer is above 80%."*
- *"Weeks where you set a Deen goal average 4.1:1 Signal:Noise. Weeks where you don't average 2.3:1."*
- *"You've logged zero workouts on 6 of the last 7 Thursdays."*

Design rules, because this is easy to do badly:
- **Only surface a pattern with enough support** (a minimum sample and a real effect size). A spurious correlation shown confidently destroys trust in the whole feature permanently.
- **Always show the evidence** — the counts, not just the claim. It's a mirror, not an oracle.
- **Never moralise.** Especially around Deen and Reflection. State the number, never a judgement. The Reflection tracker's privacy constraint extends here absolutely: **Reflection data never appears in Patterns, ever** — not aggregated, not correlated, not as an input to any other insight. It is the one dataset that exists purely for him.
- Patterns get their own surface on Insights, capped at the top few, refreshed weekly rather than live.

**Later tier (only if he wants it):** an LLM summary over the same aggregates for the weekly review. Explicitly not tier one — the statistical layer must stand on its own first, and sending personal religious and behavioural data to an API is a decision only he can make. Not proposing it now.

---

## Sequencing

Each block is independently valuable and shippable. Ordered by leverage per unit of work, not by ambition.

| # | Block | Why here |
|---|---|---|
| 1 | Command palette + Inbox + quick capture | Upstream of everything; immediately useful on day one |
| 2 | Offline capture queue | Makes capture trustworthy on a phone, which is where it happens |
| 3 | Daily Review | Closes the loop the original spec always described; generates the reason-data Patterns needs |
| 4 | Importance field + Home sort | Small change, directly improves the app's most-used screen |
| 5 | Goal linkage + conflict detection | Makes existing features consult each other instead of coexisting |
| 6 | Patterns engine | Needs 3 to have been running long enough to have data worth reading |

## What is deliberately not proposed

Named so it's clear these were considered and rejected, not overlooked:

- **Full offline-first sync.** Enormous complexity, conflict resolution, and this is a single user on two devices with good connectivity. The capture queue gets 90% of the value for 5% of the work.
- **Calendar import (.ics / Google).** Real value, but it's an integration project with its own auth and sync failure modes. Worth doing eventually; not competing with the six above.
- **Multi-user anything.** Explicitly out of scope since the original spec.
- **Gamification** — points, badges, levels. Wrong register for a system that tracks religious practice, and it corrupts the honesty of the data the moment a number becomes a score to protect.
- **A general LLM chat surface.** The references have one; it would be decoration here. A specific, well-shaped weekly summary is worth more than a chat box.

## Open questions for Ayman

Not blocking — the sequencing above is buildable as proposed if he simply says go. These are where his answer would change the design:

1. Is the **Inbox** something you'd actually triage, or would it become a graveyard? If the latter, capture should route straight to a domain instead and skip the inbox entirely.
2. Would you do a **nightly review** in practice? It's the highest-value block but it's also the one that demands a daily habit. If not, drop it and Patterns gets weaker but survives.
3. **Voice capture** — genuinely useful, or a novelty you'd use twice?
4. How do you feel about the app **telling you things about yourself**? Some people find it motivating and some find it intrusive, and the Deen domain makes that question sharper than it would be in a work tool.
