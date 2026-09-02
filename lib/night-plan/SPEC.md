# Evening close — the Night Plan half

**Engine:** `lib/night-plan/night-plan.ts` (pure, tested, no clock / no Supabase / no React).
**Surface owner:** LifeOS lead. **Engine owner:** CollegeOS lead.
**Source:** CollegeOS `packages/api/src/day/nightPlan.ts` + migration `0005`'s `mit_rank`
contract. Governed by BOSS-VISION §4.6.

This file is what the engine cannot enforce on its own: the schema it needs, the copy that
must survive verbatim, and the two places the surface can silently break the ritual.

---

## 1. The schema this needs, and why it is not optional

Numbering is the LifeOS lead's (R5); this states the shape, not the number.

LifeOS `tasks` today has **no rank concept at all** — no `mit_rank`, no `planned_date`, and
`completed boolean` rather than a status enum. Three additions:

```sql
alter table public.tasks add column mit_rank smallint check (mit_rank between 1 and 3);
alter table public.tasks add column planned_date date;

-- THE SCARCITY CONSTRAINT. This is the one that matters.
create unique index tasks_mit_rank_per_day_idx
  on public.tasks (user_id, planned_date, mit_rank)
  where mit_rank is not null;
```

**The index is the feature, not a safeguard on it.** Crowning is scarce because the database
refuses a second crown, not because the UI draws one button. Ship the columns without the
index and the failure is *silent*: two crowned items render perfectly, and the day quietly
stops having a single most important thing. Nobody sees an error.

`mit_rank` is nullable and most tasks will never have it. **Null is a real state** — "written
down, not chosen" — and is not missing data.

**Its authoritative writer is the night before.** The morning open is confirm-and-start, never
a second writer. CollegeOS's `submitCheckin` clears stale ranks rather than accumulating them;
whatever writes ranks here must do the same, or a task starred on Monday still carries rank 2
on Thursday.

---

## 2. Copy and behaviour that must survive verbatim

- **Dump → star three → crown one.** Crowning is a *separate act* from starring. Collapsing
  them into "pick your top item" loses the two-stage narrowing that makes the crown cost
  something. `crown()` refuses an unstarred id rather than starring it for you; the surface
  must not paper over that with a convenience tap.
- **A fourth star is refused, not absorbed.** No silent eviction of the oldest — a cap that
  quietly drops something turns a deliberate choice into a queue.
- **Removing a seeded line is a planning act.** Persist dismissals and pass them to
  `composeDump`. Re-seeding on every open makes removal meaningless.
- **The batch default category is SHOWN, never invented silently.** The ritual has a two-to-
  three-minute budget; a category picker on every dumped line is exactly the friction that
  ends a nightly habit. One default, applied to the batch, visible.
- **Sleep intent is re-closeable; latest wins.**
- **"What does this serve?" stays optional.** Unanchored is the default, not a lapse. Forcing
  it makes the plan unusable on the ordinary night when something urgent is the honest answer,
  and trains people to attach a lie.

---

## 3. Two ways the surface can break this without any error appearing

**(a) Writing a duration estimate onto a dumped task.** Duration calibration trains on
estimate-vs-actual pairs, and the arbiter's `cost` signal reads it downstream. A dump that
injects estimates nobody made poisons both, and nothing will report it — the numbers just
drift. `DumpItem` has no estimate field; do not add one at the adapter.

**(b) Seeding retrieval as rows.** Tomorrow's due items are a **count** —
`state.dueRetrievalCount`, rendered as "14 cards, ~8 min". Forty dumped cards destroys a
two-minute ritual. A count is context; a row is a commitment. Do not convert one into the other.

---

## 4. The seeding set

Exactly three sources produce rows: **risk-ranked school deliverables**, **unfinished goal
milestones**, **parked worries**. Retrieval contributes the count above and nothing else.

Each seeded row carries its `source`, so the surface can show *why* a line is there. A seeded
line the user cannot explain is a line they will delete without reading.

---

## 5. Sleep intent — and the trap that is not in this engine

Sleep intent closes the day and settles Efficiency: `computeEfficiency` returns `settled:
false` until it lands, and before then the ratio falls all day simply because the denominator
grows.

**It must be settable in one tap outside this ceremony**, and the day must auto-settle at a
boundary with `settled_by: 'user' | 'auto'` recorded. If a 3–5 minute ritual is the only way to
settle a scalar, a user who skips the close for a week leaves seven days permanently reading
"so far" — never resolving, and indistinguishable from seven closed days unless the provenance
is stored. That is the null-is-never-zero rule applied to the settling act itself.

---

## 6. What is NOT in this engine

No persistence, no clock, no notification scheduling, no habit-vote rows, no close-out stats.
Those compose *around* this at the surface. The engine holds exactly the invariants that are
expensive to rediscover: crown scarcity, the star ceiling, one-shot seeding, and the absence
of a duration estimate.
