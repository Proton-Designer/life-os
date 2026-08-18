# Business section — current state, before the brainstorm

**Author:** Opus Lead, 2026-08-18
**Purpose:** factual input to the Business brainstorm. This is what the data says, independent of any
research on productivity or operators.

## The finding that should reframe the brainstorm

Live row counts, queried directly against production:

| Table | Rows |
|---|---|
| `kill_list_items` | **0** |
| `weekly_goals` | **0** |
| `work_sessions` | 3 |
| `checkins` | 23 |

**The Kill List has never been used. A weekly goal has never been set.** Those are the two modules
Ayman put at the top of his proposed Business layout, and they are the two with no data behind them.

This means the Business screen today renders essentially nothing: an empty kill list, an empty goal
card, a focus timer at zero, and charts of a 23-row check-in history. Ayman's own words earlier
tonight — *"I haven't really started using the app, I have to make it usable to actually start using
it"* — are confirmed by the database.

**So the question the brainstorm has to answer is not "which widgets show this data best."** There is
no data. The question is: **what makes him write three kill-list items in the morning and close them
at night, and what makes him set a weekly goal on Saturday?** Everything else on the screen is
downstream of those two acts. A better chart of nothing is still nothing.

This also means any widget proposal justified by "it visualizes X well" is unfalsifiable right now —
we cannot see whether it would be useful, because X doesn't exist yet. Proposals should be judged
primarily on whether they drive **entry and completion**, and only secondarily on what they display.

## What data exists, which bounds what is buildable

Four tables feed this section. Any widget must be derivable from these or it needs new schema.

**`kill_list_items`** — `date`, `text`, `position` (0–2, so exactly three slots per day),
`completed`, `created_at`.
Derivable: today's three, completion per day, days fully cleared, time-of-day of completion,
per-position completion rates, streaks of cleared days. **Not** derivable: effort, category, carry-
over between days (there is no link between an item today and the same item tomorrow — each day's
list is independent, and an uncompleted item simply disappears at midnight).

**`work_sessions`** — `started_at`, `ended_at`.
Derivable: focus minutes per day/week, session count, session length distribution, time-of-day of
sessions, active-session state. **Not** derivable: what the session was spent on, except through
check-ins.

**`checkins`** — `checkin_time`, `tag_type`, `tag_label`, `tag_ref_id`, `answered`,
`work_session_id`.
Derivable: signal vs. noise ratio, what a session was actually spent on, unanswered rate, time-of-day
of noise. This is the richest table in the section and the most under-used by the current UI.

**`weekly_goals`** — `headline`, `milestones` (jsonb array), `locked`, `week_start_date`, `domain`.
Derivable: the goal, its milestones, whether it was locked. **Not** derivable: milestone completion —
`milestones` is an array of strings with no per-item done state. **A milestone cannot currently be
checked off.** That is a structural gap, not a display choice, and it is worth naming: a weekly goal
you cannot make progress against is a poster, not a system.

## Observations on the current widgets

- **`sessionsThisWeek`** — Ayman asked for its removal. Worth noting it was derivable from
  `work_sessions` and duplicated information already implied by focus time; removing it is consistent
  with the one-metric rule.
- **Signal:Noise** is the section's most interesting number and the only one derived from a rich
  source, but it is presented purely as a retrospective ratio. Nothing acts on it.
- **The kill list is capped at three** by `position` (0–2). That is a real product decision already
  embedded in the schema, and a good one — it should be defended in the brainstorm, not quietly
  widened.

## Questions the section cannot answer today

Listing these because they are candidate widget territory, and because each one either has data
behind it or needs schema:

1. Did I do the thing I said I'd do this week? — **needs schema** (milestone completion).
2. What actually eats my time? — **has data** (`checkins.tag_label`), not surfaced.
3. When am I most likely to lose the day to noise? — **has data** (`checkin_time` + `tag_type`), not
   surfaced.
4. Am I clearing the kill list more or less often than a month ago? — **has data**, not surfaced.
5. What did I not finish yesterday? — **needs schema** (no carry-over between days).
