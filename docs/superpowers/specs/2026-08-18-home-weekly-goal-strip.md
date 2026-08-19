# Home: weekly goal as a thin frame above "Now"

**Status:** design, approved by Ayman 2026-08-18 22:23 CDT — build it
**Author:** Opus Lead

## The decision and the reasoning

Ayman: *"Every time you pull up the app, the first thing you see and the first thing you kind of
always have at the back of your mind is your overall weekly goal. Wouldn't this be optimal?"*

He's right, and the current layout is wrong here. Home was ordered by "time horizon widens as you
scroll" — now, today, this week. That organized the screen around a concept rather than around what
he needs first, and it put the weekly goal below the fold on a phone, where most opens never reach it.

**The data agrees with him:** `weekly_goals` has **0 rows**. He has never set one. A thing you must
scroll to, which shows a blank form when you arrive, doesn't get used.

**But not as a top block, which is what we're explicitly not building.** A weekly goal isn't
actionable — you can't do anything *to* it at 7am. A non-actionable thing in the most valuable slot
gets scrolled past and becomes wallpaper within a week: the "a goal you can't make progress against is
a poster" failure already named in the Business synthesis. Putting it on top would just make it a
bigger poster. Worse, with no goal set, Home would open onto an empty form — the exact pattern that
correlates with both unused tables in this app.

**So: top position, frame treatment.** One line above `Now`, not a panel. The action list sits
directly beneath it so today's actions visibly read as being in service of the week's goal. That
goal→action connection does not exist anywhere in the product today and is the biggest structural gap
the Business analysis found.

## Build

New server component `components/home/weekly-goal-strip.tsx`, rendered in `app/(app)/page.tsx`
immediately after `<PageHeader title="Home" />` and **before** the first grid row.

- **Not a `Panel`.** No card, no border, no title. It is a frame: small, muted, low-contrast. If it
  reads as another widget, it's wrong.
- Content: a `This week` label, then Deen's and Business's `headline`, each linking to
  `/weekly-planning`.
- Per domain, if that goal is unset, its slot reads `Set this week's Deen goal →` (same for Business)
  rather than being omitted — an empty slot should recruit, not hide.
- If **neither** is set, collapse to a single `Set this week's goals →` line rather than two prompts.
- Headlines truncate with ellipsis; the strip is one line at `lg`, and may wrap to at most two lines
  at 390px. It must never push `Now` off the first screen.
- Reuse the existing domain accent classes from `weekly-focus.tsx` so Deen/Business read as themselves.
- Tap targets ≥44px on the links — do not repeat the app's existing sub-44px problem in new code.
- `prefetch` on its links, consistent with `2026-08-18-navigation-prefetch-fix.md`.

**The lower `This week's focus` panel stays**, unchanged, with milestones, Qur'an pages against
target, and the Saturday-evening planning nudge. The headline appearing in both places is deliberate,
not duplication to be flagged: headline at the top for constant salience, detail lower down where
there's room. Do not delete the panel and do not move the milestones up.

`page.tsx` already queries both goals — pass `deenGoal`/`businessGoal` down. **No new query.**

## Acceptance criteria

1. Home opens with the week's goals visible without scrolling at 390px, above `Now`.
2. `Now` is still visible on the first screen at 390px — measure it, don't eyeball it.
3. With no goals set: one recruiting line, no empty form, no blank space where a headline would go.
4. With one of two set: the set headline plus a prompt for the missing one.
5. A long headline truncates and never wraps to a third line.
6. It reads as a frame, not a widget — screenshot at 1600/1024/390 and judge it honestly. If it
   competes with `Now` for attention, it's too heavy; say so rather than shipping it.
7. Links ≥44px, `prefetch` present, clean console at all three widths.
8. `tsc`, `eslint`, full `vitest` (new tests for the three goal states), `next build` clean.
