---
id: domain.insights
title: Insights
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - app/(app)/insights/**
  - lib/insights/**
related:
  - domain.business-lockin
  - domain.distractions-checkins
  - domain.home-arbiter
  - arch.system-overview
answers:
  - "where do metrics and trends live"
  - "how is the legacy/domains signal:noise divergence computed"
covers: "The analytics hub — everything Home deliberately excludes: metrics, trends, history"
excludes: "Home's own current-day view (see domain.home-arbiter); raw check-in/allocation mechanics (see domain.distractions-checkins)"
tokens_est: 886
source_hash: 9e0d77b43c56bf6beaa704e6bb5aec88fb3eb0d7020e13503af079f4d98ec8e2
---

# Insights

## Purpose

The analytics hub — metrics, trends, and history that Home deliberately excludes live here instead.

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Entrypoint | `app/(app)/insights/page.tsx` | 562 lines |
| Focus/KPI logic | `lib/insights/{focus-map,insights-kpis,ratio-display}.ts` | |
| Signal:Noise | `lib/business/{sn-ratio,sn-trend,domain-weights,domain-classification}.ts` | Reused from Business, not duplicated |
| Weekly recap | `lib/weekly-planning/weekly-recap.ts` | |
| Completion chart | `lib/home/get-weekly-completion.ts` | Same function reused for Home's "this week" chart — not a duplicate query |

## How it works

Day/week toggle via `?range=`. One `Promise.all`: Focus Map segments, KPIs (check-in coverage %, most-focused domain, noise share delta), weekly completion trend, 6-week Signal:Noise allocation, current-range Signal:Noise, a 6-week recap (prayers-on-time, kill-list-days-cleared, Qur'an pages), previous week's Qur'an target, domain weights. `computeTrackingFloorDateStr` distinguishes "genuinely zero" from "before tracking started" throughout.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depends on | Business | Signal:Noise donut + 6-week trend — the single most complex cross-domain read here |
| Depends on | Deen | Prayers-on-time, Qur'an pages/target |
| Depends on | Distractions/Check-ins | Sole source for check-in coverage %, Focus Map, all Signal:Noise figures |
| Reuses | Home | `getWeeklyCompletion` (same function) |

## Constraints & gotchas — legacy/domains Signal:Noise divergence (verified, high confidence)

`getUserDomainWeights` returns `null` whenever a user has zero active `user_domains` rows, **with no check on `onboarding_completed`**. `classifyDomain` then falls back unconditionally to the hardcoded legacy split (`deen`+`business`=signal) — "zero regression for the one account this matters most for." Net effect: an account with `onboarding_completed===false` and zero rows is `mode:"domains"` (empty arrays) for **navigation**, but **legacy-classified for Signal:Noise** everywhere — a real, live, documented divergence during the onboarding window.

## Not covered here

- Home's current-day view → `domain.home-arbiter`
- Check-in allocation mechanics → `domain.distractions-checkins`

## Unverified

- None outstanding — the legacy/domains divergence was independently re-derived from source, not merely cited from docs.
