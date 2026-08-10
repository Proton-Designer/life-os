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

**Edge cases:**
- **Tie-breaking:** when two items are due at the same moment, order falls back to a fixed domain priority: Deen > Business > School/Co-op > Fitness.
- **Empty states:** a genuine "all clear, nothing due" day gets distinct copy/treatment from a fresh-install-with-no-data-yet state — they are not the same situation.
- **Overdue pile-up:** the "Right Now" list is never truncated/capped — hiding overdue items behind a "+N more" would defeat the screen's purpose.

## Domain Screens

### Deen
- **Salah:** all 5 daily prayers, each markable On-time / Qada / Missed. Jummah replaces Dhuhr tracking on Fridays (not tracked separately).
- **Qada backlog:** a running counter (e.g. "127 qada owed") for older missed prayers being made up over time, separate from today's 5-prayer tracker — increment/decrement manually.
- **Adhkar:** two checkboxes, morning + evening (not a sub-checklist); ability to add/edit/remove additional custom dhikr/dua habits alongside them.
- **Qur'an:** log reading sessions (pages), track current surah/juz position, weekly page goal, reading streak (hard reset on a missed day for v1 — no freeze mechanic).
- **Traveling toggle:** a manual switch that relaxes on-time/qada reminder strictness while traveling. No automatic qasr/jam' (shortening/combining) logic — that fiqh is easy to get subtly wrong via automation, so it's left to manual judgment.
- Weekly goal (e.g., pages/week target, qada catch-up target) is set during the weekly planning ritual, editable anytime.
- Prayer calculation method and Asr madhab (Hanafi vs. Shafi/Standard) are confirmed explicitly during onboarding (pre-filled with a sensible suggestion, one tap to accept or change) — this is the one setting worth surfacing upfront rather than silently defaulting, since it affects religious correctness, not just UI preference.

### Business
- **Weekly goal:** set during weekly planning, editable mid-week.
- **Daily kill list:** the 3 highest-leverage tasks for the day — add/edit/reorder/complete. Resets fresh each day (unfinished items are not auto-carried to tomorrow — forces a deliberate re-prioritization each morning rather than accumulating carry-over debt). Editing a task's text after check-ins have already referenced it does not retroactively change those check-ins — each check-in snapshots the task label at the time it was logged.
- **Weekly Signal:Noise ratio:** business-specific view of the universal check-in data (see below), shown as a ratio (e.g., "4.2 : 1"), not a percentage. Displays "All Signal" instead of dividing by zero when Noise = 0 for the week; displays "No data" rather than a misleading ratio if there were zero check-ins all week.
- **Analytics entry point:** link into the shared Insights view, scoped to Business.
- If no kill list is set yet for the day, the check-in prompt includes a "Set kill list now" quick-add option rather than only offering Other work/Noise.
- A one-tap "skip check-ins today" toggle (for a rest day or travel day) is available from Home, separate from the permanent check-in window in Settings.

### Fitness
- **Daily habit checkmarks:** customizable list (add/edit/remove habits), no exercise-level detail by design. Adding a new habit mid-week only affects consistency % from its add-date forward — it doesn't retroactively look incomplete for prior days.
- **Workout schedule (optional):** assign a named workout type (e.g., Push, Pull, Legs, Cardio, Rest, Full Body — user-defined names, not exercises/sets/reps) to specific days of the week, optionally with a time. Editable weekly recurring pattern. A scheduled workout automatically appears as a due item on Home and as a check-in tag option when its time window is active. A missed scheduled workout shows as missed for the day and affects the weekly "X/5 scheduled" count, but doesn't drive a separate punitive streak mechanic. An ad-hoc workout can always be logged even on a scheduled "Rest" day, and still counts toward the weekly total.
- Streaks are computed/read-only.

### School
- Unified task list with due dates (add/edit/remove/complete).
- Class schedule / calendar view (recurring class times + one-off events like exams). Supports single-date exceptions (a cancelled or rescheduled class) without editing the whole recurring pattern. Semester on/off is a manual toggle for v1, not date-driven.

### Co-op
- Unified task list with due dates (add/edit/remove/complete).
- Work schedule / calendar view (recurring meetings like standups/1:1s + one-off events). The Co-op tab stays permanently in the nav; when off-rotation it simply shows an empty state ("No active co-op — nothing scheduled") rather than being hidden or relabeled.
- Calendar entry is manual for v1 — no .ics/Google Calendar import (candidate for a later version).

## Universal Check-in System ("Pulse Check-ins")

Originally scoped to Business only, this was reframed to be app-wide: a periodic self-report time-audit (same principle behind tools like TagTime — periodic sampling gives an honest picture of time allocation with far less friction than continuous tracking).

- **Trigger:** fires on a configurable interval (default every 2 hours) within a configurable active window (e.g., 8am–10pm), set in Settings. Not domain-specific — lives at the app-shell level.
- **Prompt:** "What'd you spend the last 2 hours on?" Options are **context-aware**, pulled from whatever's actually active right now: the current Business kill-list item, a workout scheduled in this window, Deen, etc. Less-central domains (School/Co-op) are available under a "Something else" expansion rather than cluttering the main prompt. Always-available generic options: **Other work** (necessary but not top-priority) and **Noise/distraction**.
- **No separate "Rest & Recovery" bucket** — deliberately cut for simplicity. Genuine rest/downtime is handled by the existing missed-check-in rule below, so it doesn't need its own category.
- **Missed check-ins are excluded from the ratio, not counted as Noise.** This was an explicit choice to avoid penalizing time you weren't at your phone, and also organically covers rest without added UI.
- **Single-tap, single-select.** Tagging a check-in against a domain item double-duties as progress logging for that item (e.g., ticks kill-list progress, marks workout engagement) — nothing gets logged twice. Multi-tasked blocks still get one tag (whichever felt most significant) — no multi-tag escape hatch, to keep this friction-free.
- **Timing:** check-ins fire on fixed clock times within the active window (e.g. 8/10/12/2/4/6/8/10), not relative to when the app was last opened — more predictable.
- **Snooze:** a one-tap "remind me in 15" option handles being mid-prayer/class/meeting when a check-in fires.
- **Grace period:** a check-in can still be answered late, right up until the next one fires — after that it locks in as missed/excluded.
- **Notification tap:** opens the app to the prompt rather than answering inline from the notification/lock screen (inline actionable notifications aren't reliably available across PWA platforms, notably iOS).
- **Roll-up:** feeds a shared **Insights** view with a "Focus Map" (a day/week segmented breakdown of time by domain + Noise) and both a **global Signal:Noise ratio** and **per-domain ratios** (e.g., Business-specific S:N).

## Weekly Planning Ritual

A lean, once-a-week session — **only Deen and Business get new weekly goals.** Fitness/School/Co-op run on recurring schedules and ongoing task lists that don't need weekly re-goaling. Flow: review last week's numbers (Deen prayer/adhkar/Qur'an consistency, Business S:N and goal completion) for context, then set this week's Deen goal and Business goal. Reuses the same goal-card UI pattern already established on the domain screens rather than a distinct wizard.

- **Goal format:** one headline goal text, plus an optional freeform bullet list of milestones underneath — preserves the "goal + milestones" idea without a rigid structured system.
- **Week boundary:** weeks run Sunday–Saturday.
- **Availability:** the ritual unlocks Saturday evening; Home nudges you to complete it until you do, but there's no hard deadline/lockout.
- **Missed week:** if a week passes without planning, last week's goal carries forward as an editable draft rather than silently reused or lost.
- **First week ever:** shows an empty "no history yet" review state instead of a broken/blank comparison.
- **Past weeks are locked/read-only** once the week ends, to keep the historical S:N and consistency trend data honest.

## Visual Design Direction

- **Dark-first**, not a generic flat dark mode: a rich near-black base with a deep oxblood/ember radial glow accent (per the reference image provided) and subtle cool slate dividers — a moody, premium feel rather than pure black.
- **Vibrant per-domain accent colors** sit on top of the dark base (established in mockups: gold/amber for Deen and Fitness, emerald for Business/Signal, blue for School, red for Noise).
- Mobile nav is a "liquid glass" floating island: translucent, blurred, pill-shaped, compact height.
- Exact polish (glassmorphism tuning, spacing, typography, animation/motion) is intentionally deferred to the frontend-implementation phase — this spec locks structure and identity, not pixels.

## Time & Calendar Fundamentals

- **Week boundary:** Sunday–Saturday, used consistently everywhere "weekly" applies (Business kill-list week, weekly planning, Fitness's weekly schedule).
- **Day boundary:** midnight local time — simplest option; prayer tracking has its own time windows regardless of this, so it doesn't need a special "prayer day" cutoff bleeding into tasks/kill-lists.
- **Location/timezone:** GPS auto-detected with a manual city override, required (not optional) for accurate prayer times — this is a hard requirement, not a nice-to-have, given the app's role in Deen tracking.

## Data, Sync & Backup

- **Multi-device sync is a hard requirement**, not local-only storage — the app is used across both desktop and mobile in real day-to-day use, so state must be consistent across sessions/devices.
- **Manual export:** a simple "export my data" option (JSON/CSV) in Settings, given this holds meaningful personal history (prayer consistency, business numbers). Not a full automated backup subsystem — just an on-demand safety net.

## Onboarding

Minimal first-run flow — only what's required for Home to be usable is asked upfront; everything else is set up lazily the first time you touch that domain:
1. Location/timezone (for prayer times).
2. Prayer calculation method + Asr madhab confirmation (pre-filled suggestion, one tap to accept or change).
3. Notification permission request.
4. On iOS Safari specifically: an explicit "install this app to your home screen" step, since push notifications don't function on iOS PWAs unless installed — this is a real platform constraint, not just a suggestion.

Kill list, habit list, workout schedule, class/co-op schedule, and optional PIN are all configured later, the first time the user visits that screen/setting — not forced into onboarding.

## Settings

- **Check-in window & interval** (start time, end time, interval — default every 2 hours, 8am–10pm).
- **App lock:** optional PIN/passcode or biometric lock on opening the app, **default OFF** (relies on device-level lock unless explicitly enabled).
- Theme (dark-first; light mode support is a later "nice to have," not required for v1).
- Prayer time source/calculation method and location (needed to drive Deen's prayer schedule and Home's "Next Up" hero — calculation method choice to be finalized during implementation).

## Notifications

Push notifications are a **must-have**, not optional — prayer times, check-in prompts, and deadline reminders all depend on reaching the user even when the app is closed. This requires the app to be an installable PWA with a service worker and Web Push. This has real implementation weight (service worker setup, push subscription handling, a backend to schedule/send pushes) and should be scoped explicitly in the implementation plan rather than assumed trivial.

- **Permission denied/unavailable fallback:** if push permission is denied or silently fails (a known iOS PWA failure mode), the app falls back to in-app badges/visual cues only — this fallback state needs explicit design, not just an assumption that push always works.
- **Quiet hours:** handled by a single setting — the check-in active window (Settings) — rather than a separate redundant quiet-hours config.

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
| Notifications | Push required (PWA + service worker); in-app badge fallback if denied |
| Week/day boundaries | Week = Sun–Sat; day = midnight local time |
| Prayer method | Confirmed explicitly at onboarding, not silently defaulted |
| Qada | Separate running backlog counter, distinct from today's 5-prayer tracker |
| Travel (Deen) | Manual "Traveling" toggle relaxes reminders; no auto qasr/jam' logic |
| Kill list carry-over | Resets daily, does not auto-roll unfinished items |
| Check-in cadence | Fixed clock times, 15-min snooze, grace period until next check-in |
| Weekly planning goal format | Headline text + optional milestone bullets |
| Missed weekly planning | Prior goal carries forward as an editable draft |
| Sync | Multi-device sync required; manual JSON/CSV export available |
| Onboarding | Location, prayer method, notifications (+ iOS install step); rest deferred |
