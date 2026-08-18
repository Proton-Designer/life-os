# Home: subtract the redundancy, add the day's shape

**Status:** design, approved by Ayman 2026-08-17
**Author:** Opus Lead, with review from both Sonnet engineers
**Supersedes parts of:** `2026-08-17-home-restructure.md`

## The brief

Ayman, verbatim in intent: Home should show **what he needs to see**, plus **doorways** into the
domain screens when he wants detail — not everything, just the convenient thing. Metrics belong in
Insights, not Home.

One constraint governs every decision here: **he has not really used the app yet.** So we design for
obvious value and against invented pain. Anything justified by "he'll probably need…" is out.

## What Home is for

Three jobs, in priority order:

1. **What do I do now** — the Now module.
2. **Where am I in the day** — currently nothing does this.
3. **How do I get to the detail** — the sector rows are the doorways.

Anything that isn't one of those three is a candidate for removal.

## Subtractions

### 1. Delete the "Right now / Later today" panel

It was the complete cross-domain queue back when it was the only such module. The Now module (shipped
tonight) reads the same source and shows the head of each domain's queue; this panel shows the whole
queue. With prayers as the only recurring auto-generated item, both render the same five rows. Once
prayer windows land, only the currently-due prayer is `pending`, so the panel collapses to roughly one
row and is redundant either way.

`components/home/priority-list.tsx` becomes orphaned. Leave it and its tests in place — it joins the
standing orphan list awaiting Ayman's call, same treatment as `day-ribbon` got.

### 2. Delete the Signal:Noise donut. Move the "This week" chart.

These two were specified together and they are **not** the same case. Engineer 2 checked the actual
data sources rather than assuming:

- **Signal:Noise donut → delete.** Home's version (`getWeeklySignalNoiseRatio`) and Insights' version
  (`insights-kpis.ts`) read the same `checkins` table with the same `kill_list`/`noise` split, and
  Insights' is strictly more capable (day/week toggle vs. Home's fixed week). Moving it would create a
  duplicate, not relocate a feature. Nothing is lost by deleting Home's.
- **"This week" completion AreaChart → genuine move to Insights.** Nothing in Insights currently shows
  a daily completion-percentage trend; the Focus Map is check-in-tag-based, not completion-based. This
  is new ground there, so it must actually land in Insights, not be quietly dropped.

## Addition: "The day's shape"

Revive `DayRibbon` as a full-width row — **but not as a restore.** Both engineers independently
concluded that a straight bring-back would be worse than nothing, for two different reasons. Both are
binding requirements, not nice-to-haves.

### Requirement A — spans, not points (Engineer 1)

`RibbonPrayerMarker` is currently a single point (`time`, `pct`). Phase 1's entire thesis is *windows,
not instants*; rendering a point marker in the one module whose job is showing the shape of the day
throws that away. Each prayer renders as a **span** from `window.start` to `window.end`, so the ribbon
can show "you are currently inside Asr's window, unlogged" as a live highlighted band.

And the hard constraint: `markerState(status)` currently guesses missed/upcoming/logged from a raw
status string — pre-window logic with the same blind spot everything else had, where a
closed-and-unlogged prayer renders as "upcoming" forever. **Feed it derived `EffectivePrayerStatus`.**
Shipping the old raw-status logic would be a regression wearing a bring-back's clothes, on the most
prominent module on Home. If time forces a cut, points-with-derived-status is an acceptable interim;
old raw-status logic is not acceptable under any time pressure.

### Requirement B — the overlay is the point (Engineer 2)

If it ships with only the five prayer markers, it is thin and redundant — Deen's own page already
shows prayer times, so a bare-prayers ribbon on Home tells Ayman nothing he can't get there. **The
value is specifically the overlay:** the scheduled workout, today's timed tasks across School/Co-op,
and logged focus sessions on the same timeline as the prayers. That assembly is the only place "here's
my whole day's shape" exists anywhere in the app, and it is genuinely cross-domain — which is exactly
what Ayman asked Home to be.

This is real net-new data assembly, not a re-render. Do not underscope it to "get the ribbon showing
again."

The existing empty-state copy ("Check-ins and Lock-In sessions will show up here") is stale for the
wider scope and needs rewriting regardless.

## Change: the Deen doorway surfaces outstanding qada

With the derived-status ripple, a missed-and-unlogged prayer correctly drops out of
`getPriorityItems` — it isn't actionable, it's qada. Engineer 1 named the consequence: **Home then
has zero visibility into "you have missed prayers to log."** Not de-emphasized — invisible. The only
discovery path is opening Deen for an unrelated reason.

Their recommendation was to leave it for v1 on the "don't design ahead of observed pain" principle.
The fix adopted here is smaller than a module and doesn't violate it: the **Deen row in Sector
progress** already exists as a doorway and already carries a metric (`X/5 prayers`). When outstanding
qada is non-zero, surface it there. No new element, no invented module — a doorway telling you there
is something behind it. We are not hiding a state we already compute.

**Implementation note (Engineer 1):** the number is `buildQadaBacklog(resolved).derivedCount`. The
wiring cost is that `get-domain-snapshots.ts`'s deen section has no access to a resolved-statuses
window today — only `get-priority-items.ts` and the Deen page perform the 60-day resolve. Give the
snapshot's deen section that access rather than duplicating the resolve.

## Resulting layout

```
Row A   Now (col-8)                    | Focus (col-4)
Row B   The day's shape (full width)
Row C   This week's focus (col-8)      | Sector progress (col-4)
```

Panel count goes from six-plus-stack to **five**. Engineer 2 flagged re-bloat as the thing to watch on
this page — Now and the ribbon are not redundant with each other ("what do I do" vs. "where am I"),
but the page has been cut once tonight already and should not quietly grow back. This layout is a net
reduction, and that is deliberate.

## Explicitly deferred

**Quick capture** — one Home input that files a task / kill-list item / Qur'an pages. Held until
Ayman has actually used the app. Engineer 2 sharpened the reason beyond "wait and see": a generic
capture box needs either a domain picker (which kills "quick") or a guess at which domain a typed
string belongs to — and a wrong guess silently files something where he will never think to look,
which is worse than not having the feature. Resolving that well needs observed usage, not a guess.

## Acceptance criteria

1. Home shows exactly five panels in the layout above; the priority list and the S:N donut are gone.
2. The completion trend chart is **visible in Insights** — verified by looking at Insights, not by
   confirming it left Home.
3. The ribbon shows prayers as spans with derived statuses, and a prayer whose window is currently
   open reads as such. A closed-and-unlogged prayer never renders as "upcoming."
4. The ribbon shows non-prayer blocks — workout, timed tasks, focus sessions — on the same timeline.
5. Outstanding qada is visible from Home via the Deen sector row when non-zero.
6. `tsc --noEmit`, `eslint`, full `vitest`, `next build`, full e2e, and a live browser pass at
   1600/1024/390px with a clean console.
