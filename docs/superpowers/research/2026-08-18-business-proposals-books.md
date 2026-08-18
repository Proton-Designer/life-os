# Business section — candidates from the books research

**Author:** Engineer 1, 2026-08-18. Companion to `2026-08-18-productivity-books-research.md` and
`2026-08-18-business-current-state.md` (read second one first — I have).
**Framing, taken directly from the current-state doc:** `kill_list_items` and `weekly_goals` are both
empty in production. Every candidate below is judged first on whether it plausibly drives **entry and
completion**, second on what it displays. A widget that only renders data better is not on this list —
there's no data to render.

Four candidates. Each names its mechanism, its evidence tier (from the books doc), and whether it's
buildable from the four existing tables or needs schema — labeled explicitly, never smuggled in as free.

---

## A. If-then entry for the kill list — needs schema (one nullable column)

**Mechanism:** Gollwitzer & Sheeran implementation intentions — 🟢🟢, the strongest evidence in either
research doc (d=0.65 across 94 studies, reaffirmed at 642 tests). Also the Zeigarnik/Masicampo-Baumeister
finding — 🟢 — that a *specific plan* quiets an unfinished task's pull on attention even before it's
done. Both point the same direction: the moment of writing a task down is where the leverage is, and a
bare task text is the weak form of that moment.

**The change:** at kill-list entry, prompt for a trigger alongside the text — not "what," also "when/
where" ("before lunch," "after this call," "when I sit back down"). Structurally identical to the
`anchor_cue` pattern already shipped tonight in Habit Builder: one nullable text column
(`kill_list_items.trigger_cue`), optional, shown as a small subordinate tag on the item — same
implementation, same migration shape, already proven tonight to not bloat the entry flow.

**Why it's an entry lever, not a display lever:** this doesn't visualize anything — it changes what
happens at the moment of typing. The evidence claims roughly double follow-through from adding the
if-then structure to a bare goal. If entry is genuinely the problem (0 rows), this is the single
highest-leverage change on this list, evidence-wise.

**Constraint respected:** the 3-slot cap (`position` 0–2) stays untouched — this is a field on the
existing row shape, not a change to how many items exist.

---

## B. Yesterday's leftovers, surfaced — no schema needed

**Mechanism:** Zeigarnik again, but the failure mode it predicts, not the fix: an unfinished item
currently just *vanishes* at local midnight (no carry-over, confirmed in the current-state doc). That's
close to the worst option available — an unresolved task doesn't stop intruding just because the UI
stopped showing it, and silent disappearance offers neither the completion nor the plan that would
actually resolve the pull.

**The change:** don't touch today's 3-slot cap. Add a compact, separate "yesterday, unfinished" list —
directly reusing the Qada backlog pattern shipped tonight (oldest-first, one-line-per-item, an action to
resolve it: mark done retroactively, or re-add as today's item). This is a **query over data that
already exists** — `kill_list_items` rows for past dates aren't deleted, just never surfaced past their
own day. No schema change.

**Why it's an entry lever:** the current-state doc frames the real question as "what makes him write
three items in the morning." Part of the answer may be that writing something down currently means it
either gets done today or is gone without a trace — no partial credit, no resurfacing. Knowing an
unfinished item will resurface rather than evaporate lowers the cost of writing it down honestly, which
should, if the mechanism holds, increase willingness to enter items at all — not just complete them.

**Answers current-state Question 5 directly** ("what did I not finish yesterday"), and does so without
the schema change the current-state doc assumed it would need — the "carry-over" it flagged as
needing new schema is one specific implementation (literally re-linking the same row across days); a
separate resurfaced-backlog view sidesteps that and needs none.

---

## C. Surface the noise clustering, not just the ratio — no schema needed

**Mechanism:** the current-state doc's own finding — Signal:Noise is "the richest source, purely
retrospective, nothing acts on it." The actionable version of this is time-of-day clustering, the same
principle behind the Reflection redesign's time-of-day view: a raw ratio ("2:1 this week") tells him
nothing he didn't already sense; "noise clusters 2–4pm" is a fact he can act on (block that window,
schedule low-stakes work there). This is judged as a **weaker entry lever than A or B** — it doesn't
touch kill-list writing at all — and I'm saying so rather than overselling it. It's a completion/
protection mechanism: it doesn't get the list written, but it may keep a started Lock-In session from
getting derailed before the list gets cleared.

**The change:** bucket `checkins` by `checkin_time` × `tag_type`, same computation shape as the habit
research's "not enough data yet" honesty rule (§5 of the habit doc, adopted by Reflection tonight) — say
so plainly below some minimum sample size rather than drawing a pattern from noise. Buildable entirely
from `checkins`, no schema change, and directly answers current-state Question 3.

---

## D. Weekly goal as a plan, not a headline — two tiers, one needs schema

**Mechanism:** Gollwitzer once more. A goal headline with no if-then structure is the documented-weak
form; the effect size gap between "I want to hit this goal" and "if X, I will do Y toward it" is the
same evidence as candidate A. The current-state doc's own framing — *"a weekly goal you cannot make
progress against is a poster, not a system"* — is exactly the failure mode this evidence predicts.

**Tier 1, buildable now, no schema:** change the entry prompt itself. Instead of a bare "What's your
goal this week?" headline field, prompt for the goal *and* a first concrete trigger ("this week, when
X happens, I'll work on this") — still just text in the existing `headline`/`milestones` fields, no new
columns, purely a copy/UX change to what's elicited at entry. Weaker than tier 2 because nothing
enforces the structure — it's asking better, not requiring better.

**Tier 2, the real fix, needs schema — flagged exactly as instructed:** `milestones` is a plain
string-array jsonb column with no per-item completion state, so a milestone cannot be checked off. Making
a weekly goal genuinely trackable (not just statable) requires converting it to a structured shape — an
array of `{text, completed}` or a normalized child table, same additive-migration philosophy used for
`anchor_cue`/`commitment_note` tonight. I'm not proposing which shape without your call, since it's a
real design decision (jsonb-with-shape vs. a real table changes what other code, if any, reads
`weekly_goals.milestones` today) — just naming that the dependency exists and is real, not implicit.

---

## Not proposed, and why

I have one more research-backed mechanism (Pencavel's diminishing-returns hours data) that bears
directly on whatever framing Focus Time gets — you flagged you're bringing this to the brainstorm
yourself, so I'm not designing around it here to avoid stepping on that. Available if useful: the
finding is that output per hour drops sharply past ~50hrs/week and additional hours past ~55 return
essentially nothing, from archival production-output data, not self-report — see the books doc's
bedrock section for the full citation.
