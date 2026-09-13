# Three-App Feature Inventory — Implementation Audit

*Cross-referenced "Complete Feature Inventory — CollegeOS · LifeOS · ULM" against the actual `tracking-app` codebase on 2026-09-13, via 8 parallel code-crawling passes (4 this session, plus 6 from an earlier CollegeOS-only pass reused/re-verified here) covering every route, component, library, and migration touching these three feature sets. Every item cites the file(s) that back its verdict. Repo currency: last commit before this pass was 2026-09-10 22:58 CDT — the repo has been quiet for the 3 days since, so all findings below reflect the current live state.*

**Context that matters for reading this doc:** all three "apps" now live in one codebase. CollegeOS and ULM were separate products; both are being merged into what's now sold as the commercial "LifeOS." Git history documents this directly — commits like `feat(school): port CollegeOS's grade engine` and `feat(self-mastery): port ULM's ingestion core` — so "not yet built" in ULM's own header is stale: a real fraction of ULM already exists here as the web "Self-Mastery" feature. CollegeOS, by contrast, is mostly still a vision document — only its grade engine, risk engine, and a deterministic capture parser have actually been ported; the rest (the Hour, Night Plan, Habits, Question Bank, Canvas, Lecture Capture, etc.) is largely unbuilt. LifeOS's own list is different in kind from the other two: it's the product team's description of what's *actually shipped* in the live legacy app, and it checks out almost entirely.

## Scorecard

| App | Fully Implemented | Partially Implemented | Not Implemented | Total |
|---|---|---|---|---|
| CollegeOS | 9 | 17 | 72 | 98 |
| LifeOS | 54 | 4 | 1 | 59 |
| ULM | 22 | 12 | 20 | 54 |
| **Combined** | **85** | **33** | **93** | **211** |

**Headline reading:** LifeOS (the live legacy app) is ~92% built as its own team describes it — the few gaps are a UI-label drift and one missing goals archive. ULM is the most misleadingly-labeled: despite its own brief saying "not yet built," 40% of its checklist is fully implemented and another 22% partially — the ingestion pipeline, FSRS scheduler, and review loop are all real, just switched off in production and missing the proactive/notification layer. CollegeOS is the opposite story: only 9% is fully built; most of the vision (Question Bank, Canvas, Lecture Capture, the whole Day-Structure/Hour/Night-Plan ritual, Habits, Weekly Review) exists only as a spec, onboarding-picker labels, or unwired library code.

---

# APP 1 — CollegeOS

## 1. Day Structure (Work Engine)
- ❌ Start Day tap (idempotent wake mark) — no wake-marking write path exists; `/open`'s "Start day" is just a link to Home.
- ❌ Delta clock — no "Delta" timer concept anywhere; only a plain elapsed-minutes display exists for Lock-In sessions.
- ✅ Per-weekday baselines (0–12, zero=rest) — `app/(app)/settings/weekday-baseline-actions.ts:24-42`.
- ✅ Day Won — `lib/evening-close/day-won.ts:19-60` `dayWonVerdict()`.
- ❌ Morning Routine checklist — no matches anywhere.
- 🟡 Morning check-in — `/open` shows last night's crowned plan read-only; no confirm action, no fresh-MIT fallback.
- ❌ Morning brief (AI 3-line daily summary) — not found.
- ❌ Merged Today surface (Delta·Hours·Efficiency panel) — Home's real panels (`components/home/focus-module.tsx`) don't match this shape; "day_structure"/"efficiency_metric" exist only as unused onboarding-catalogue metadata.

## 2. The Hour (deep work session)
- 🟡 Deliverable-contract-gated timer — Lock-In sessions gate on a duration goal only (`session-setup-dialog.tsx:317-323`); no mandatory "what you'll produce" text.
- ✅ Elapsed time re-derived from wall clock — `lock-in-session.tsx:85`, `lock-in-overlay.tsx:65`.
- 🟡 Distraction counter (+1→6 chips→back, 2 taps) — real 2-step flow, but domain→trigger-list, not a fixed "+1 then six causes."
- ❌ 60:00 completion notification — not found; only generic prayer/check-in push notifications exist.
- ❌ End-of-Hour ritual (recap→card rotation→submit) — "End Session" ends immediately, nothing further.
- ❌ Method Modes (Retrieval/Interleave/Draft/Recite/Compose/Cards) — session kinds are only `deep_work | deep_study | learn`.
- ❌ "N of 4 Hours today" — no fixed daily-hours target anywhere.
- ✅ Ad-hoc Hours — objectives/task-attachment are optional at session start.

## 3. Night Plan (evening ritual)
- ✅ Brain dump → star 3 → crown MIT — `lib/night-plan/night-plan.ts:96-140`, `components/evening-close/close-plan-stage.tsx`.
- 🟡 Dump pre-seeded from School/War-Map/worries — the engine (`composeDump`) fully supports this, but has zero live callers; no "War Map" feature exists at all.
- ❌ Habit vote rows in close-out — not found.
- 🟡 Close-out stats (Hours/Delta/Efficiency) — only Hours + Day-Won shown; no Delta, no Efficiency number (code comment admits the rest "aren't built yet").
- ❌ Sleep intent — zero hits anywhere.
- ❌ 9:30 PM nightly reminder toggle — not found.

## 4. Cards & Identity
- ❌ Cards library (Goal/Motivation/Thought Habit/2.0 Trait/10X) — doesn't exist; the only "cards" in the app are Self-Mastery's book flashcards. An "identity_card_ritual" widget id exists only as unused onboarding metadata, explicitly cut for reading as gamification.
- ❌ End-of-Hour card rotation — follows from the above; no such ritual exists.
- ⚪ Honest empty state — N/A, since the feature it would belong to doesn't exist.

## 5. Habits
- ❌ Up to 7 habits with identity statements — `custom_habits` schema has no identity-statement field or cap.
- ❌ Identity votes (tap to vote/retract) — not found.
- ❌ Derived decaying score (0.96/day) — habits track a stored streak + rolling rate instead; "decay" elsewhere belongs to an unrelated feature.
- ❌ Shows "New" for first 7 days — habit staging uses 0-13/14-29/30+ day windows with different labels, no "New."
- ❌ Pause/freeze and resume — only one-way archive exists; the code's own comment admits un-archiving isn't built.
- ❌ Kill-habits with escalation — the only "kill list" in the app is Business's 3-slot daily task list, unrelated to bad habits.

## 6. Worries
- 🟡 Worry List, mark Handled — worries save as generic tasks (`dump_source='worry'`); no dedicated list screen, no "Handled" status.
- ❌ Monday Anti-Worry Hour panel — the concept appears only in code comments describing intended future behavior; nothing reads/displays it.

## 7. Goals (War Map Lite)
- ❌ Top 5 ranked goals with number+reason, ceiling enforced — `weekly_goals` is one flat headline+milestones row per week/domain; no ranked list, no cap, no "War Map" naming anywhere.
- 🟡 One milestone per goal per month — exists, but weekly (not monthly) cadence, and one flat array under a single headline, not per-goal.
- 🟡 Unfinished milestones seed Night Plan — the engine supports it (`night-plan.ts`'s `DumpSource`), but has zero callers.

## 8. Weekly Review
- ❌ Sunday review screen (Hours + category bars) — Insights page has zero matches for "hour"/"category"/"closed"; its real content is a different feature entirely.
- ❌ Distraction Pareto — exists only as an unrendered onboarding-catalogue label.
- ❌ Efficiency by day (closed/open) — no "closed day" concept exists in code at all; only described in a design spec referencing a function that doesn't exist.
- ❌ Habit scores summary — no habit "score" concept exists.
- ❌ Load forecast — onboarding-catalogue placeholder only, never consumed.
- ❌ Weekly narrative (AI recap) — the real weekly recap is purely deterministic arithmetic, no text generation.

## 9. Efficiency
- ❌ Efficiency = Hour time ÷ time awake — no such computation exists anywhere; only an onboarding placeholder label.

## 10. School Core (S1)
- 🟡 Courses with code/term/weight categories/policies — code/room/instructor exist; explicitly no `term` column and no late-work/attendance/grade-boundary policies (a migration header says so directly); weight is a flat per-assessment %, not categories.
- ❌ Deliverable types (assignment/exam/quiz/discussion/admin) — the type constraint is `quiz | exam | midterm_final` only.
- 🟡 Grade Ledger (current/projected/target%, required-score, ScenarioPlanner) — the ledger and required-score verdict are real and wired; the "ScenarioPlanner" what-if calculator is built but has zero callers (dead code).
- 🟡 DeadlineRadar — risk-ranking exists inside one class's assessment list only; no cross-class ranked dashboard exists.
- ❌ School Today feed → Night Plan — typed/spec'd (`DumpSource` includes `"school_risk"`, exact format found in a test fixture) but zero production code ever creates such a seed; the day-level risk aggregator is explicitly commented "not wired to a caller."
- ❌ Timeboxing (planned start times) — no such field or feature exists.
- ❌ Duration calibration (estimate-vs-actual) — explicitly and repeatedly commented as deliberately excluded ("NO estimated_minutes, EVER").

## 11. Syllabus & Announcement Parsing (S2)
- ❌ Syllabus upload → AI extraction → staged items with confidence — upload is file storage only; a code comment states outright "extraction is Phase 2."
- ❌ Announcement paste → AI parse → staged diff — zero matches for "announcement" anywhere in the codebase.
- ❌ No-guessing rule for ambiguous dates — nothing to apply it to, since no parser exists.
- 🟡 "Nothing schedulable" success state — an analogous pattern exists for the syllabus-upload step, not for an actual parser concluding nothing is schedulable.
- ❌ Confirm pipeline (atomic/idempotent/CAS-guarded) — the pattern exists elsewhere in the app (proving the team knows how), but nothing analogous exists for School.
- ❌ Per-course announcement history — doesn't exist.

## 12. Question Bank & Study System (S3)
- ❌ Per-course questions (prompt/answer/anchor/tag) — a `questions` table with exactly this shape exists in the schema but is dead: zero rows in production, zero application code anywhere writes to it.
- ❌ Question origins (self/AI/missed) — same dead table.
- ❌ Manual creation flow — no route/component/action exists.
- ❌ AI drafting from notes/slides/transcripts — the real drafting pipeline only targets book cards, never questions.
- ❌ SM-2-lite spaced scheduler — explicitly drafted then formally withdrawn (`_withdrawn/096_school_attempts.sql`) in favor of folding into the shared FSRS system, which was never actually wired to serve questions.
- ❌ Daily due queue, cross-course interleaving — the live scheduler query never selects question rows, despite a schema column that would allow it.
- 🟡 Calibration taps (Sure/Think so/Guessing) — real and working, but for book flashcards only, never wired to a question flow.
- ❌ Illusion-of-competence rule — no matching logic exists.
- ❌ Web Bank + Drill — doesn't exist; the only "Drill" hit in the codebase is an unrelated book-provenance UI.

## 13. Exam Prep Intelligence (S4/Tier 5)
- ❌ Backward-planned retrieval curves (D-21/D-14/D-7/D-3) — no matches anywhere.
- ❌ Practice tests at D-7/D-2 — no practice-test assembly logic exists.
- ❌ Practice-vs-real benchmark rule — no exam-related benchmark logic exists (only an unrelated fitness feature uses that word).
- ❌ Load forecasting with overflow warnings — `lib/school/` has only grade/risk engines, nothing session-load related.

## 14. Canvas Integration (I1) — all seven items ❌ Not Implemented
Deliberately stubbed, not merely missing: onboarding's "Connect Canvas" toggle is an explicit no-op, with a code comment stating "Canvas is offered but deliberately not built." No API client, course mapping, announcement poll, grade sync, ICS reconciliation, token-expiry state, or sync screen exists anywhere.

## 15. Lecture Capture — all five items ❌ Not Implemented
No lecture concept, audio import, transcription (Deepgram or otherwise), transcript library, or "draft questions from transcript" pipeline exists anywhere; no relevant dependency in `package.json`.

## 16. Voice Capture
- ✅ Speak/dictate a task via deterministic parser — real and test-pinned against the spec's own example (`"remind me to submit my econ homework tomorrow at 6pm"`).
- ✅ No API cost / no guessing on ambiguity — enforced by design and by test ("an ambiguous 'at 6' stays UNPARSED").
- 🟡 Confirm-before-persist preview with default category — the preview is real, but the parsed time is shown then silently dropped on save (the task only gets a date, never a time).
- 🟡 /capture on mobile, modal on web — one responsive modal serves all breakpoints; no distinct mobile route, no native app.
- 🟡 Reminder ≡ task — architecturally true (no separate reminders table), but undermined by the same dropped-time bug above.

## 17. AI Layer (infrastructure)
- ❌ LLM gateway (model tiering, prompt caching, structured retry) — a single hardcoded provider behind a bare fetch call; no tiering, no caching, no retry logic.
- ❌ Monthly budget ceiling — no spend-tracking code exists; the one AI feature is BYOK, so there's no platform spend to cap.
- ❌ Usage log (hashed prompts, cost) — no such table or code exists.
- ✅ Deterministic-first pattern — real, for the one AI feature that exists (a genuine rule-based fallback with zero broken states when no key is set).
- ❌ Nightly analysis cron — only two cron jobs exist in the entire system, neither is this.
- ❌ Weekly synthesis cron — same evidence as above.

## 18. Accounts & Platform
- ✅ Email auth, RLS everywhere — confirmed via self-testing scripts, one documented exception (`migration_ledger`, intentionally policy-free).
- 🟡 Account export and delete — export exists but covers only 20 of 68 tables (a hand-maintained allowlist); account delete doesn't exist as a user-facing feature at all.
- ❌ Whoop OAuth + webhook — zero matches anywhere.
- ❌ RescueTime sync — zero matches anywhere.
- ❌ Web + iPhone (Expo) app — this is a web-only Next.js app; no Expo/React Native config or dependency exists at all.
- ❌ TestFlight/EAS deployment — follows directly from the above; nothing to deploy.

---

# APP 2 — LifeOS (the live legacy app)

## 1. Home Dashboard
- ✅ This Week's Focus (Deen+Business side-by-side, editable) — `components/shared/weekly-goals-header.tsx`.
- ✅ Sector progress chips — `components/home/domain-status-stack.tsx`.
- 🟡 "Now" item (next prayer + count, e.g. "Fajr, 0/1") — shows prayer name + relative time, not the "0/1" count format described.
- ✅ Focus panel (Deep Work/Study minutes + Lock In buttons + counts) — `components/home/focus-module.tsx`.
- 🟡 Distractions counter + Action Plan button on the global top bar — this actually lives in the Home Focus panel, not the top bar; the top bar's distractions element has no live count.
- ✅ "The day's shape" timeline — `app/(app)/page.tsx` (`computeDayRibbon`).

## 2. Deen Module — all ten items ✅ Fully Implemented
Prayer times (calc method + Asr method configurable), Salah tracker with per-prayer On-time/Qada/Missed counts, prayer streak, 7-day Qada catch-up view, Qur'an sessions with weekly count + streak, Reflection intensity (verbatim "resets daily at midnight — history is never deleted"), monthly L/M/H calendar, time-of-day pattern, 30-day×5-prayer consistency heatmap, and Habit Builder are all real and wired — see `app/(app)/deen/page.tsx` and `components/deen/*`.

## 3. Business Module
- ✅ Focus time today + Lock In shortcut — `components/business/focus-time-card.tsx`.
- ✅ Incompleted tasks list — `components/business/incomplete-tasks-module.tsx`.
- ✅ Today's kill list (3 slots, 0/3) — `lib/business/kill-list-slots.ts`.
- ✅ This week's goal (headline + milestones) — shared `GoalCard`.
- ❌ Completed goals archive — no archive/history view exists anywhere; a same-named component is dead code, not wired to anything.

## 4. Fitness Module — all five items ✅ Fully Implemented
Workout plans ("My Workouts," activate a plan), daily log, weekly confirmed-sets view (Sun–Sat), cycle progress (weight/waist logs), and the body-composition guidance note are all real — see `app/(app)/fitness/*` and `components/fitness/*`.

## 5. School Module
- ✅ Due Today/Overdue/Due This Week cards with View buttons.
- ✅ Completed tasks view.
- 🟡 Task list filters + buckets — filters are real, but bucketing has drifted from "Today/This Week/This Month/Future" to "Due Soon (This week/Next week) / Upcoming / Future" as of a 2026-09-10 revision.
- ✅ Add/Edit tasks.
- ✅ This week's classes, per-day Sun–Sat, add/edit.

## 6. Work Module — all three items ✅ Fully Implemented
Work shift schedule (Sun–Sat, editable), Targets ("Set your first target"), and a Completed goals archive all exist and work — `components/work/work-schedule-week.tsx`, `components/co-op/targets-strip.tsx`.

## 7. Lock-In Sessions
- ✅ Two session types (Deep Work/Study) tracked separately.
- ✅ Minutes accumulate per day per type.
- 🟡 Distraction counting during sessions — capture is available with domain auto-inferred from the active session, but distractions aren't linked to a session ID and there's no visible "N distractions this session" counter in the overlay.
- ✅ Distraction Action Plan — real rewrite-rules/ranking engine, wired end to end.

## 8. Check-ins (Signal:Noise engine) — all four items ✅ Fully Implemented
This section's wording happens to match the *current* system closely even though the originally-built "point-sample" check-in flow it may have described was deliberately deleted as dead code on 2026-09-10 — the live system is a 2-hour, 15-minute-increment allocation model (`lib/checkins/schedule.ts`, `allocation.ts`) with "unassigned time counts as wasted" shown verbatim on screen, an optional 2-hour nudge, and a configurable window in Settings.

## 9. Insights — all ten items ✅ Fully Implemented
Day/Week toggle, check-in coverage %, most-focused domain, noise share %, weekly trend chart, 6-week Signal:Noise trend, baseline-aware stat cards, week-over-week small-multiple charts, Focus Map, and per-domain time breakdown are all real — `app/(app)/insights/page.tsx`, `lib/insights/focus-map.ts`. (One stale code *comment* calls Focus Map "point-sample-based" — that's an outdated comment, not a functional gap; the underlying query was converted to the allocation model back on 2026-08-19.)

## 10. Weekly Planning — ✅ Fully Implemented
The "This week" modal (weekly goals + hourly Sun–Sat grid) exists both as a topbar dialog and a standalone `/calendar` page, sharing the same `WeekCalendarView` component.

## 11. Settings & Platform — all six items ✅ Fully Implemented
Profile, prayer calc/Asr method, location, check-in window, Notifications/Security/Data sections, and Vercel deployment are all confirmed present and working.

---

# APP 3 — ULM (billed as "not yet built" — actually partially live as web "Self-Mastery")

## 1. Book Ingestion Pipeline
- 🟡 PDF upload (text-layer; OCR/EPUB fast-follow) — real extraction code exists, but the entire pipeline is currently gated off in production (no worker consumes the queue).
- 🟡 Async processing, visible progress, push notification when ready — a progress bar exists but jumps straight from 0 to 100 at the very end (no incremental updates); no push notification is wired to a finished book at all.
- ✅ Text extraction preserving page numbers.
- ✅ Chapter/section structural parse from headings + table of contents.
- 🟡 Chunking with embeddings (pgvector) — chunking itself matches spec exactly (3000 tokens, 150 overlap, section-aligned); the `pgvector` schema is real, but nothing ever computes an embedding, so the column sits permanently empty.
- 🟡 Per-chunk AI extraction, cheap-triage → mid-model — extraction is real; there's no triage tier at all, every chunk goes straight to one model.
- 🟡 Whole-book merge/dedupe, rank, top 30-60 — ranking and selection are real (though capped at 60, floored at 6, not 30 as described); dedup is structurally broken because there's no embedder to compare against, and the code itself documents this as "a defined, expected degradation."
- 🟡 Quality gate (ungrounded lessons dropped) — the verbatim-quote check is enforced by a DB constraint; a separate semantic grounding-verification stage computes a verdict but currently discards it rather than acting on it.
- ✅ Extraction favors actionable/testable claims — a real scoring function drives this.
- ❌ Batch API ingestion at a cost target — no batch API usage anywhere; only per-request calls, no cost tracking against a dollar target.

## 2. The Lesson Card
- ✅ Title, ✅ Core claim, ✅ Mechanism, ✅ Claim-to-task, ✅ Evidence strength label, ✅ 2-4 retrieval prompts (recall/application/cloze/why) — all real and rendered, see `lib/self-mastery/ingestion/cards.ts`, `components/self-mastery/lesson-card.tsx`.
- 🟡 Provenance (chapter/page/quote, tappable) — page number and a tappable verbatim quote are real; the chapter/section link exists as a schema column but is never actually populated by the extraction code, so only the page number ever surfaces.

## 3. Daily Session
- ✅ 5-10 minute session, completable daily.
- ✅ Warm-up: one easy due card.
- ✅ Due reviews interleaved across books, not blocked by book.
- ✅ New lessons 2-5/day, adjustable, only after due cleared.
- 🟡 Closer: application prompt tied to the user's day — a closer slot is real, but it's a generic repurposed application card, not a distinct "connect this to today" prompt.
- 🟡 Free recall before reveal, typed/dictated — typed recall with genuine reveal-only discipline is real; there's no dictation/speech-to-text option at all.
- ✅ Self-grade Again/Hard/Good/Easy.
- 🟡 AI grading assist — a real, working feature, but gated entirely behind the user's own API key; with no key configured it's simply absent rather than a built-in default.
- ✅ Self-explanation prompts every few cards, ungraded by design.

## 4. FSRS Scheduling — all four items ✅ Fully Implemented
A real, standard `ts-fsrs` library (not hand-rolled) drives per-card stability/difficulty/due-date/reps/lapses state; desired retention defaults to 0.9 and is user-adjustable; the review log is genuinely immutable (DB triggers block update and delete).

## 5. Engagement Layer
- ✅ Daily streak with repair (one freeze per completed week) — real gap-day streak logic with freeze earn/consume mechanics.
- 🟡 Celebrate effortful wins — three of the four described win-moments are wired (recovered card, comeback, hard-won recall); the fourth (a book crossing 80% retention) is explicitly deferred/not emitted.
- ✅ Session-complete moment (close message + "N cards due tomorrow" preview).
- ✅ Memory strength visualization — real per-book/lesson retrievability bars, computed from actual FSRS state.
- ❌ Daily notification referencing a real due card — no self-mastery-specific notification exists anywhere; the notification system is entirely unaware of this feature.
- ❌ Weekly recap (cards reviewed, retention, strongest/weakest book) — the app's one real weekly recap is scoped to prayer/kill-list/Qur'an data only; a self-mastery-specific version was explicitly never built (only mentioned in a "do-not-port" comment).

## 6. Teach-Back Mode — all three items ❌ Not Implemented
What exists is an ungraded, free-text "put this in your own words" interstitial with no AI involvement — not the described "AI plays curious student, gives feedback on gaps" flow.

## 7. Tech Choices (native-app plan)
- ❌ Native Swift/SwiftUI client — this is a web app; expected mismatch, not a gap.
- 🟡 Supabase Auth/Postgres/pgvector/Storage — all genuinely used; the one divergence is that ingestion runs as a Next.js/Vercel API route rather than a dedicated worker or Edge Function, and nothing currently drives repeated calls to it.
- ❌ Anthropic API, tiered models — no Anthropic or OpenAI SDK anywhere; the ingestion providers are DeepSeek/Ollama/a dev-shim/a heuristic fallback. An "AI feedback" column exists in the schema but the app always writes `null` to it — inert plumbing, not a working feature.
- ❌ On-device speech-to-text for recall answers — doesn't exist; a browser dictation feature exists elsewhere in the app but isn't connected to review sessions.
- ❌ APNs notification — the app uses web-push/VAPID, not APNs, and (per section 5) no self-mastery notification exists regardless of transport.

## 8. ULM Full Vision (out of scope, checked for completeness) — all ten items ❌ Not Implemented
No agent council, accountability engine, behavioral data layer, Apple Health/WHOOP/Calendar integration, attention control, judgment suite, real-world-experiments tracker, journal cross-referencing, contradiction detector, or per-user FSRS parameter optimization exists anywhere — consistent with these being explicitly out of MVP scope in the source document itself.
