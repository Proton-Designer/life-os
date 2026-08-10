# Life OS — Personal Productivity App Design Spec

**Date:** 2026-08-09
**Owner:** Ayman (single-user personal app)

## Overview

A personal productivity web app (installable PWA, responsive for desktop + mobile) unifying five areas of the owner's life: **Deen** (Islamic practice), **Business** (hustle/ventures), **Fitness**, **School** (CS sophomore), and **Co-op** (work). The app is used both as a twice-daily dashboard (morning planning, night review) and for continuous lightweight logging throughout the day. It is single-user — no multi-tenant auth, no accounts beyond the owner.

## Goals

- One place to see "what needs me right now" across all 5 life domains, sorted by actual urgency rather than domain.
- Each domain gets a full dedicated screen for its own tracking, with domain-appropriate depth (Deen and Business are structurally rich; Fitness/School/Co-op stay deliberately simple).
- A cross-domain "pulse" check-in system that produces an honest, low-friction picture of where time actually goes across the whole day — not just during business hours.
- Fast, frictionless logging: everything actionable is checkable inline, without forced navigation.
- A dark, premium visual identity — not a generic flat dark mode.

## Non-goals

- No multi-user support, no social/sharing features.
- No exercise-level fitness tracking (sets/reps/weight) — fitness stays at the habit/schedule level by design.
- No full time-tracking app — the check-in system is periodic self-report sampling, not continuous tracking.

## Information Architecture

**Screens:** Home, Deen, Business, Fitness, School, Co-op, Insights (analytics), Weekly Planning, Settings.

**Navigation:**
- **Desktop:** top menu bar — logo left, links (Home / Deen / Business / Fitness / School / Co-op) center, avatar/settings right.
- **Mobile:** floating "liquid glass" island nav, bottom-anchored, translucent/blurred pill design. Shows **Home, Deen, Business, School, More** (5 items — the comfortable max for this style of nav). Fitness and Co-op live under **More**. Island should be compact/short (not vertically tall) — a slim pill, not a large bar.

## Home Screen

Home is the unified daily-priority view, not a domain-grouped dashboard — urgency/time is the organizing axis, since that's how attention actually needs to be allocated across mixed domains. It has three layers:

1. **"Next Up" hero card** — the single most time-critical item across all domains (next prayer, next check-in, next deadline), large and unmissable, with a one-tap primary action (e.g., "Mark prayed"). This also surfaces the next universal check-in prompt when due.
2. **Domain pulse strip** — one small progress ring per domain (Deen, Business, Fitness, School — Co-op can share School's ring or get its own, to be finalized during implementation) for a quick full-picture status read, used mainly for the morning/night review use case. Tapping a ring jumps to that domain.
3. **Unified action list, grouped by time-window** ("Right Now" / "Later Today"), not by domain. Each row shows a small domain tag, is inline-checkable, and tapping opens the domain screen only if more detail is needed. A collapsed "This week" teaser at the bottom shows the current week's S/N ratio and links to the weekly plan.

Business kill-list items may roll up as a single "check-in" line on Home rather than exploding into 3 separate rows, to keep the list scannable — full detail lives on the Business screen.

## Domain Screens

### Deen
- **Salah:** all 5 daily prayers, each markable On-time / Qada / Missed.
- **Adhkar:** default morning + evening checklist items; ability to add/edit/remove custom dhikr/dua habits.
- **Qur'an:** log reading sessions (pages), track current surah/juz position, weekly page goal, reading streak.
- Weekly goal (e.g., pages/week target, qada catch-up target) is set during the weekly planning ritual, editable anytime.

### Business
- **Weekly goal:** set during weekly planning, editable mid-week.
- **Daily kill list:** the 3 highest-leverage tasks for the day — add/edit/reorder/complete.
- **Weekly Signal:Noise ratio:** business-specific view of the universal check-in data (see below), shown as a ratio (e.g., "4.2 : 1"), not a percentage.
- **Analytics entry point:** link into the shared Insights view, scoped to Business.

### Fitness
- **Daily habit checkmarks:** customizable list (add/edit/remove habits), no exercise-level detail by design.
- **Workout schedule (optional):** assign a named workout type (e.g., Push, Pull, Legs, Cardio, Rest, Full Body — user-defined names, not exercises/sets/reps) to specific days of the week, optionally with a time. Editable weekly recurring pattern. A scheduled workout automatically appears as a due item on Home and as a check-in tag option when its time window is active.
- Streaks are computed/read-only.

### School
- Unified task list with due dates (add/edit/remove/complete).
- Class schedule / calendar view (recurring class times + one-off events like exams).

### Co-op
- Unified task list with due dates (add/edit/remove/complete).
- Work schedule / calendar view (recurring meetings like standups/1:1s + one-off events).

## Universal Check-in System ("Pulse Check-ins")

Originally scoped to Business only, this was reframed to be app-wide: a periodic self-report time-audit (same principle behind tools like TagTime — periodic sampling gives an honest picture of time allocation with far less friction than continuous tracking).

- **Trigger:** fires on a configurable interval (default every 2 hours) within a configurable active window (e.g., 8am–10pm), set in Settings. Not domain-specific — lives at the app-shell level.
- **Prompt:** "What'd you spend the last 2 hours on?" Options are **context-aware**, pulled from whatever's actually active right now: the current Business kill-list item, a workout scheduled in this window, Deen, etc. Less-central domains (School/Co-op) are available under a "Something else" expansion rather than cluttering the main prompt. Always-available generic options: **Other work** (necessary but not top-priority) and **Noise/distraction**.
- **No separate "Rest & Recovery" bucket** — deliberately cut for simplicity. Genuine rest/downtime is handled by the existing missed-check-in rule below, so it doesn't need its own category.
- **Missed check-ins are excluded from the ratio, not counted as Noise.** This was an explicit choice to avoid penalizing time you weren't at your phone, and also organically covers rest without added UI.
- **Single-tap, single-select.** Tagging a check-in against a domain item double-duties as progress logging for that item (e.g., ticks kill-list progress, marks workout engagement) — nothing gets logged twice.
- **Roll-up:** feeds a shared **Insights** view with a "Focus Map" (a day/week segmented breakdown of time by domain + Noise) and both a **global Signal:Noise ratio** and **per-domain ratios** (e.g., Business-specific S:N).

## Weekly Planning Ritual

A lean, once-a-week session — **only Deen and Business get new weekly goals.** Fitness/School/Co-op run on recurring schedules and ongoing task lists that don't need weekly re-goaling. Flow: review last week's numbers (Deen prayer/adhkar/Qur'an consistency, Business S:N and goal completion) for context, then set this week's Deen goal and Business goal. Reuses the same goal-card UI pattern already established on the domain screens rather than a distinct wizard.

## Visual Design Direction

- **Dark-first**, not a generic flat dark mode: a rich near-black base with a deep oxblood/ember radial glow accent (per the reference image provided) and subtle cool slate dividers — a moody, premium feel rather than pure black.
- **Vibrant per-domain accent colors** sit on top of the dark base (established in mockups: gold/amber for Deen and Fitness, emerald for Business/Signal, blue for School, red for Noise).
- Mobile nav is a "liquid glass" floating island: translucent, blurred, pill-shaped, compact height.
- Exact polish (glassmorphism tuning, spacing, typography, animation/motion) is intentionally deferred to the frontend-implementation phase — this spec locks structure and identity, not pixels.

## Settings

- **Check-in window & interval** (start time, end time, interval — default every 2 hours, 8am–10pm).
- **App lock:** optional PIN/passcode or biometric lock on opening the app, **default OFF** (relies on device-level lock unless explicitly enabled).
- Theme (dark-first; light mode support is a later "nice to have," not required for v1).
- Prayer time source/calculation method and location (needed to drive Deen's prayer schedule and Home's "Next Up" hero — calculation method choice to be finalized during implementation).

## Notifications

Push notifications are a **must-have**, not optional — prayer times, check-in prompts, and deadline reminders all depend on reaching the user even when the app is closed. This requires the app to be an installable PWA with a service worker and Web Push. This has real implementation weight (service worker setup, push subscription handling, a backend to schedule/send pushes) and should be scoped explicitly in the implementation plan rather than assumed trivial.

## Technical Notes for Implementation Planning (non-binding)

- Single-user app: no multi-tenant auth system needed; the optional app lock (PIN/biometric) is a local client-side gate, not a backend auth system.
- Needs persistent data storage (tasks, check-ins, prayer logs, workout schedule, etc.) and a scheduling mechanism for recurring push notifications (prayer times shift daily by location; check-ins fire on an interval).
- Given the project's existing Vercel context, a Next.js PWA on Vercel with a Marketplace-provisioned database (e.g., Postgres) is a reasonable default direction — to be confirmed in the implementation plan.

## Summary of Key Decisions From This Session

| Area | Decision |
|---|---|
| Home organizing axis | Time/urgency, not domain |
| Mobile nav | Floating glass island: Home, Deen, Business, School, More (Fitness, Co-op) |
| Desktop nav | Top menu bar, all 6 |
| Check-in scope | App-wide, context-aware, not Business-only |
| Check-in categories | Domain item, Other work, Noise/distraction (no Rest bucket) |
| Missed check-in | Excluded from ratio, not penalized |
| Weekly planning scope | Deen + Business only |
| Fitness depth | Habit checkmarks + optional named workout schedule (no exercise detail) |
| App lock | Optional, default off |
| Theme | Dark-first, oxblood/ember accent on near-black, vibrant per-domain colors |
| Notifications | Push required (PWA + service worker) |
