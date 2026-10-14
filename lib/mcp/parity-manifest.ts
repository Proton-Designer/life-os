/**
 * MCP parity manifest (P4-28): one recorded MCP decision for EVERY exported
 * async function in a `"use server"` file under app/ and lib/.
 *
 * Enforced by lib/mcp/__tests__/parity.test.ts, which scans the tree
 * (lib/mcp/parity-scan.ts) and fails if any Server Action is missing here,
 * if an entry here names a function that no longer exists, or if a decision
 * is malformed. The point: a Phase 2/3 feature can't ship a Server Action
 * without someone deciding what an external agent can do with it.
 *
 * Decision shapes (exactly one per key):
 * - `{ mcp: "domain.entity.action" }` — the same capability is reachable via
 *   MCP `write` (checked against WRITE_REGISTRY). `"domain.entity.read"` means
 *   MCP `read` (checked against REGISTRY). `widgets.widget.<list|create|update|delete>`
 *   means the dedicated `widget_manage` tool.
 * - `{ excluded: "<category>: <why>" }` — deliberately never exposed. Category
 *   must be one of EXCLUSION_CATEGORIES (the audit's X column).
 * - `{ read_only: true }` — writes no user data (a getter, a pure helper, a
 *   cache revalidation). Its read coverage, if any, is tracked by the read
 *   registry tests, not here.
 * - `{ pending: "P4-xx" }` — should be exposed; the named task (in
 *   PENDING_TASKS, or any `P4-cov-…` id) will do it. When that task lands, flip the entry to
 *   `{ mcp: … }` (see `flipPendingToMcp` below).
 *
 * `note` is optional free text for partial coverage and caveats.
 *
 * FORMAT RULE: one entry per line, `"<key>": { … },`. `flipPendingToMcp`
 * relies on it.
 *
 * Seeded 2026-09-15 from .claude/overnight/run-20260915-0011/p4-audit/
 * capability-surface.md's write parity matrix, re-verified against source.
 *
 * COVERAGE IS NO LONGER SERVER-ACTION-ONLY (P4-33, 2026-09-19). Until then,
 * a key could only ever be a `"use server"` function path, because that is
 * all `parity-scan.ts` looks at — so a write op reachable ONLY through
 * `write()`, `widget_manage` or `scheduler_manage` needed no decision and
 * the guard still reported clean. The scan is no longer the sole source of
 * keys: `listAllWriteOps()` (write-registry.ts) enumerates every write op,
 * and parity.test.ts now demands a decision for each. Op-name-keyed entries
 * live in their own section at the end of the map.
 */

export const EXCLUSION_CATEGORIES = [
  "hard_delete", // a real DELETE the MCP write path may never do (L6: insert/update/status change only)
  "credential", // API keys, PATs, third-party tokens, or actions that spend them
  "auth", // sign in / sign up / sign out
  "onboarding_wizard", // first-run wizard steps; their OUTPUT is read via the capability map
  "file_upload", // multipart/file/storage bytes
  "llm_spend", // triggers server-side LLM spend the agent can do itself
  "scope_ruling", // excluded by a recorded write-scope ruling doc
  "ui_scaffold", // UI-only bookkeeping (get-or-create session row, notification dismissal)
] as const;
export type ExclusionCategory = (typeof EXCLUSION_CATEGORIES)[number];

/** Named tasks a `pending` decision may name (plus any COV_TASK_ID below). Each must exist on the P4 board. */
export const PENDING_TASKS = {
  "P4-05": "read coverage: Phase-1 tables",
  "P4-06": "write coverage: Faith",
  "P4-07": "write coverage: daily rituals (night plan, worries, day start, goals, identity habits)",
  "P4-08": "write coverage: school depth, question bank, ULM gaps",
  "P4-09": "write coverage: work schedule/areas, Lock-In objectives, check-in hours, distractions, fitness habits",
  "P4-26": "settings write widening (non-credential)",
  "P4-27": "computed decide views",
  "P4-29": "fitness plan-editing writes",
  "P4-cov-P3-14": "lecture capture MCP coverage",
  "P4-cov-P3-15": "lecture transcription MCP coverage",
  "P4-cov-P2-01": "monthly AI spend cap setting MCP coverage",
  "P4-cov-P2-20": "Canvas course mapping + sync trigger MCP coverage",
  "P4-cov-GAP-CHECKIN": "evening close untracked-time answers (allocation check-ins for a stretch of the day) MCP coverage",
  "P4-cov-PLAN-DETAILS": "plan line details (domain, start time, timer, order) + Home plan list start/complete/stop MCP coverage",
} as const;

/**
 * Coverage follow-up ids (INSTRUCTIONS §5: a feature with mcp_surface: yes
 * spawns `P4-cov-<id>`). Any id of this shape is accepted as a `pending`
 * target without editing PENDING_TASKS, so Team A can record a decision in
 * the same commit that creates the cov task. The test checks the task file
 * exists on the board only when PARITY_BOARD_DIR is set (the board is
 * run-scoped and absent from a clean checkout).
 */
export const COV_TASK_ID = /^P4-cov-[A-Z0-9-]+$/;
export type PendingTask = keyof typeof PENDING_TASKS | `P4-cov-${string}`;

export function isAllowedPendingTask(id: string): boolean {
  return id in PENDING_TASKS || COV_TASK_ID.test(id);
}

export type ParityDecision =
  | { mcp: string; note?: string }
  | { excluded: `${ExclusionCategory}: ${string}`; note?: string }
  | { read_only: true; note?: string }
  | { pending: PendingTask; note?: string };

/** Key: `<repo-relative path>#<export name>`. Keep sorted by file, then source order. */
export const PARITY_MANIFEST: Record<string, ParityDecision> = {
  // ── Home / root ─────────────────────────────────────────────────────────
  "app/(app)/actions.ts#delayItem": { excluded: "ui_scaffold: Home's one-tap Delay is a convenience over moving a task's due_date, which school.task.edit / work.task.edit already expose; a kill-list item has no MCP move (the kill list is a per-day 3-slot list)" },
  "app/(app)/actions.ts#markNotificationReadForNow": { excluded: "ui_scaffold: per-day notification dismissal state; no user-authored data" },
  "app/(app)/actions.ts#signOut": { excluded: "auth: ends the browser session" },
  "app/(app)/actions.ts#refreshHome": { read_only: true, note: "PERF-2: data-free cache revalidation scheduled by Home tap controls after a burst of toggleItem calls" },
  "app/(app)/actions.ts#toggleItem": { pending: "P4-09", note: "prayer/kill-list/school-task/adhkar kinds already covered by their own ops; toggle_habit (fitness habit_logs) lands as fitness.habit_log.toggle" },
  "app/(app)/actions.ts#saveWeeklyGoal": { mcp: "business.weekly_goal.save", note: "domain 'business' -> business.weekly_goal.save; domain 'deen' -> deen.weekly_goal.save (P4-06)" },

  // ── Business / Lock-In ──────────────────────────────────────────────────
  "app/(app)/business/actions.ts#setKillListItem": { mcp: "business.kill_list_item.set" },
  "app/(app)/business/actions.ts#toggleKillListItem": { mcp: "business.kill_list_item.toggle" },
  "app/(app)/business/actions.ts#setSessionObjectiveCompleted": { excluded: "ui_scaffold: idempotent setter twin of toggleSessionObjective for the optimistic Lock-In overlay; MCP exposes the toggle" },
  "app/(app)/business/actions.ts#setKillListItemCompleted": { excluded: "ui_scaffold: idempotent setter twin of toggleKillListItem for the optimistic UI; MCP exposes the toggle" },
  "app/(app)/business/actions.ts#refreshBusinessViews": { read_only: true, note: "PERF-2: data-free cache revalidation scheduled by the kill-list control after a burst of taps" },
  "app/(app)/business/actions.ts#saveBusinessWeeklyGoal": { mcp: "business.weekly_goal.save" },
  "app/(app)/business/actions.ts#startWorkSession": { mcp: "work.work_session.start" },
  "app/(app)/business/actions.ts#endWorkSession": { mcp: "work.work_session.end" },
  "app/(app)/business/actions.ts#toggleSessionObjective": { pending: "P4-09" },
  "app/(app)/business/actions.ts#getActiveSessionDetail": { read_only: true },
  "app/(app)/business/actions.ts#getClassTasksDueSoon": { read_only: true },
  "app/(app)/business/actions.ts#getSessionKillListObjectives": { read_only: true },
  "app/(app)/business/actions.ts#getSessionClasses": { read_only: true },
  "app/(app)/business/kill-list-history-actions.ts#getKillListHistory": { read_only: true },
  "app/(app)/business/kill-list-history-actions.ts#getIncompleteByDate": { read_only: true },
  "app/(app)/business/kill-list-history-actions.ts#getKillListDayDetail": { read_only: true },

  // ── Calendar / check-ins ────────────────────────────────────────────────
  "app/(app)/calendar/actions.ts#getWeekCalendar": { read_only: true, note: "calendar.week view is P4-27" },
  "app/(app)/checkin/allocation-actions.ts#saveAllocationCheckin": { mcp: "checkins.allocation.save" },

  // ── Evening close / night plan ──────────────────────────────────────────
  "app/(app)/close/actions.ts#computePlanSeeds": { read_only: true },
  "app/(app)/close/actions.ts#getEveningCloseData": { read_only: true },
  "app/(app)/close/actions.ts#getReplanData": { read_only: true },
  "app/(app)/close/plan-actions.ts#dumpLine": { mcp: "review.night_plan_task.dump" },
  "app/(app)/close/plan-actions.ts#carryOverUnfinished": { pending: "P4-07", note: "close: carry the day's unfinished plan lines to tomorrow; MCP twin follows with the night-plan writes" },
  "app/(app)/close/plan-actions.ts#triageInboxItem": { pending: "P4-07", note: "IA-P1a Inbox triage (plan/task/worry/done); MCP twin follows with the night-plan writes" },
  "app/(app)/close/plan-actions.ts#refreshCloseViews": { read_only: true, note: "PERF-4: data-free cache revalidation scheduled by the plan stage after a burst of dumped lines" },
  "app/(app)/close/plan-actions.ts#claimSeedLines": { mcp: "review.night_plan_task.claim_seeds" },
  "app/(app)/close/plan-actions.ts#savePlanRanks": { mcp: "review.night_plan_task.save_ranks" },
  "app/(app)/close/sleep-intent-actions.ts#getMySleepIntentForToday": { read_only: true },
  "app/(app)/close/sleep-intent-actions.ts#saveMySleepIntent": { mcp: "review.sleep_intent.set" },
  "app/(app)/close/sleep-intent-actions.ts#clearMySleepIntent": { mcp: "review.sleep_intent.clear" },

  // ── Deen ────────────────────────────────────────────────────────────────
  "app/(app)/deen/actions.ts#markPrayer": { mcp: "deen.prayer.log" },
  "app/(app)/deen/actions.ts#refreshDeenViews": { read_only: true, note: "PERF-1: data-free cache revalidation scheduled by the Faith controls after a burst of taps" },
  "app/(app)/deen/actions.ts#unmarkPrayer": { mcp: "deen.prayer.unlog", note: "UI deletes the row; MCP sets the non-destructive 'unlogged' status (migration 143)" },
  "app/(app)/deen/actions.ts#toggleAdhkar": { mcp: "deen.adhkar.toggle" },
  "app/(app)/deen/actions.ts#setAdhkar": { excluded: "ui_scaffold: idempotent setter twin of toggleAdhkar for the optimistic UI; MCP exposes the toggle" },
  "app/(app)/deen/quran-plan-actions.ts#getMyQuranOverview": { read_only: true },
  "app/(app)/deen/quran-plan-actions.ts#logQuranReading": { mcp: "deen.quran_plan.log_reading" },
  "app/(app)/deen/quran-plan-actions.ts#editQuranLogEntry": { pending: "P4-26", note: "QURAN-03 History: change one logged day's date/pages (ledger-validated)" },
  "app/(app)/deen/quran-plan-actions.ts#deleteQuranLogEntry": { excluded: "hard_delete: deletes one Quran log row (its pages become a gap)" },
  "app/(app)/deen/quran-plan-actions.ts#startQuranPlan": { pending: "P4-26", note: "QURAN-01 plan setup (presets/custom date/pace); MCP write widening" },
  "app/(app)/deen/quran-plan-actions.ts#startNextKhatm": { pending: "P4-26", note: "QURAN-01 next khatm at the same pace" },
  "app/(app)/deen/quran-plan-actions.ts#undoLastQuranLog": { excluded: "hard_delete: deletes the last Quran log row" },
  "app/(app)/deen/quran-plan-actions.ts#setQuranBookmark": { pending: "P4-26", note: "QURAN-01 absolute bookmark edit (the only way to move back)" },
  "app/(app)/deen/quran-plan-actions.ts#keepOrMoveFinishDate": { pending: "P4-26", note: "QURAN-01 keep/move the finish date (re-bases the plan)" },
  "app/(app)/deen/quran-plan-actions.ts#pauseQuranPlan": { pending: "P4-26", note: "QURAN-01 pause the plan" },
  "app/(app)/deen/quran-plan-actions.ts#resumeQuranPlan": { pending: "P4-26", note: "QURAN-01 resume the plan" },
  "app/(app)/deen/actions.ts#logQuranSession": { mcp: "deen.quran_session.log" },
  "app/(app)/deen/actions.ts#adjustQadaBacklog": { mcp: "deen.profile.adjust_qada" },
  "app/(app)/deen/actions.ts#setTravelingMode": { mcp: "deen.profile.set_traveling_mode" },
  "app/(app)/deen/actions.ts#logReflectionEntry": { mcp: "deen.reflection_entry.log" },
  "app/(app)/deen/actions.ts#decrementReflectionEntry": { excluded: "hard_delete: DELETEs the latest reflection_entries row (undo-shaped)" },
  "app/(app)/deen/actions.ts#createDeenHabit": { mcp: "deen.habit.create" },
  "app/(app)/deen/actions.ts#toggleDeenHabitLog": { mcp: "deen.habit_log.toggle" },
  "app/(app)/deen/actions.ts#toggleSunnah": { mcp: "deen.sunnah_log.toggle" },
  "app/(app)/deen/actions.ts#setSunnah": { excluded: "ui_scaffold: idempotent setter twin of toggleSunnah for the optimistic UI; MCP exposes the toggle" },
  "app/(app)/deen/actions.ts#setWeeklyFocus": { mcp: "deen.weekly_focus.set" },
  "app/(app)/deen/actions.ts#updateDeenHabit": { mcp: "deen.habit.update" },
  "app/(app)/deen/actions.ts#archiveDeenHabit": { mcp: "deen.habit.archive", note: "soft archive, so allowed" },
  "app/(app)/deen/actions.ts#setDeenHabitFrequency": { mcp: "deen.habit.set_frequency" },
  "app/(app)/deen/actions.ts#setDeenHabitStageOverride": { mcp: "deen.habit.set_stage_override" },
  "app/(app)/deen/actions.ts#setDeenHabitCommittedDate": { mcp: "deen.habit.set_committed_date" },
  "app/(app)/deen/actions.ts#setDeenHabitLogStatus": { mcp: "deen.habit_log.set_status" },
  "app/(app)/deen/actions.ts#getDeenHabitLogRange": { read_only: true },
  "app/(app)/deen/salah-calendar-actions.ts#getSalahMonthSummary": { read_only: true },
  "app/(app)/deen/salah-calendar-actions.ts#getSalahDayDetail": { read_only: true },

  // ── Distractions ────────────────────────────────────────────────────────
  "app/(app)/distractions/actions.ts#listTriggersForDomain": { read_only: true },
  "app/(app)/distractions/actions.ts#listTopTriggersForQuickLog": { read_only: true, note: "cross-domain sibling of listTriggersForDomain (P3-02 quick-log chips)" },
  "app/(app)/distractions/actions.ts#refreshDistractionViews": { read_only: true, note: "PERF-4: data-free cache revalidation scheduled by the capture dialog and review cards after a burst of writes" },
  "app/(app)/distractions/actions.ts#logDistraction": { mcp: "distractions.event.log" },
  "app/(app)/distractions/actions.ts#createTriggerAndLog": { mcp: "distractions.trigger.capture" },
  "app/(app)/distractions/actions.ts#updateTrigger": { pending: "P4-09", note: "distractions.trigger.update" },
  "app/(app)/distractions/actions.ts#saveActionPlan": { mcp: "distractions.action_plan.save" },
  "app/(app)/distractions/actions.ts#recordPlanOutcome": { mcp: "distractions.plan_outcome.record" },

  // ── Fitness ─────────────────────────────────────────────────────────────
  "app/(app)/fitness/actions.ts#refreshFitnessViews": { read_only: true, note: "PERF-3: data-free cache revalidation scheduled by the fitness logging controls after a write" },
  "app/(app)/fitness/actions.ts#addHabit": { pending: "P4-09", note: "fitness.custom_habit.add" },
  "app/(app)/fitness/actions.ts#toggleHabit": { pending: "P4-09", note: "fitness.habit_log.toggle" },
  "app/(app)/fitness/actions.ts#removeHabit": { pending: "P4-09", note: "soft archive: fitness.custom_habit.archive" },
  "app/(app)/fitness/actions.ts#setWorkoutSchedule": { pending: "P4-29" },
  "app/(app)/fitness/actions.ts#assignWorkoutToDay": { pending: "P4-29" },
  "app/(app)/fitness/actions.ts#quickLogExercise": { mcp: "fitness.workout_session.quick_log" },
  "app/(app)/fitness/actions.ts#logWeight": { mcp: "fitness.body_metric.log_weight" },
  "app/(app)/fitness/actions.ts#logWaist": { mcp: "fitness.body_metric.log_waist" },
  "app/(app)/fitness/actions.ts#confirmWorkoutSession": { mcp: "fitness.workout_session.confirm" },
  "app/(app)/fitness/actions.ts#confirmPlanSession": { mcp: "fitness.workout_session.confirm_plan_session" },
  "app/(app)/fitness/actions.ts#logCycleBenchmark": { mcp: "fitness.fitness_benchmark.log" },
  "app/(app)/fitness/workouts/actions.ts#createExercise": { mcp: "fitness.exercise.create" },
  "app/(app)/fitness/workouts/actions.ts#archiveExercise": { mcp: "fitness.exercise.archive" },
  "app/(app)/fitness/workouts/actions.ts#createWorkoutWithExercises": { pending: "P4-29" },
  "app/(app)/fitness/workouts/actions.ts#saveWorkout": { pending: "P4-29" },
  "app/(app)/fitness/workouts/actions.ts#renameWorkout": { mcp: "fitness.workout.rename" },
  "app/(app)/fitness/workouts/actions.ts#archiveWorkout": { mcp: "fitness.workout.archive" },
  "app/(app)/fitness/workouts/actions.ts#duplicateWorkout": { pending: "P4-29" },
  "app/(app)/fitness/workouts/plan-actions.ts#savePlan": { pending: "P4-29" },
  "app/(app)/fitness/workouts/plan-actions.ts#deletePlan": { excluded: "hard_delete: DELETEs a workout plan" },
  "app/(app)/fitness/workouts/plan-actions.ts#activatePlan": { pending: "P4-29" },
  "app/(app)/fitness/workouts/plan-actions.ts#deactivateSlot": { pending: "P4-29" },
  "app/(app)/fitness/workouts/template-actions.ts#createPlanFromTemplate": { pending: "P4-29" },
  // ONB item 6 follow-up: this IS the onboarding fitness step's own effect, the
  // same category as saveDomainSelection/saveSubdomains/completeOnboarding above
  // — an agent should never invoke the wizard's step by name. The real capability
  // it composes (createPlanFromTemplate, deactivateSlot) already carries its own
  // `pending: P4-29` decision, so excluding this wrapper hides nothing.
  "app/(app)/fitness/workouts/template-actions.ts#applyOnboardingFitnessChoice": { excluded: "onboarding_wizard: fitness style step (ONB item 6 follow-up)" },

  // ── Goals / identity habits ─────────────────────────────────────────────
  "app/(app)/goals/actions.ts#getGoalsSheetData": { read_only: true, note: "IA-P3b: Home Goals sheet read; same data as the goals.* MCP reads" },
  "app/(app)/goals/actions.ts#createGoalAction": { mcp: "goals.goal.create" },
  "app/(app)/goals/actions.ts#setGoalStatusAction": { mcp: "goals.goal.set_status" },
  "app/(app)/goals/actions.ts#addMilestoneAction": { mcp: "goals.milestone.add" },
  "app/(app)/goals/actions.ts#setMilestoneDoneAction": { mcp: "goals.milestone.set_done" },
  "app/(app)/goals/actions.ts#refreshGoalViews": { read_only: true, note: "PERF-4: data-free cache revalidation scheduled by the milestone checkbox after a burst of taps" },
  "app/(app)/deen/actions.ts#refreshFaithPracticeViews": { read_only: true, note: "HABITS-01: data-free cache revalidation scheduled by the Home / weekly-reset Faith-practice tick after a burst of taps" },
  "app/(app)/habits/actions.ts#refreshHabitViews": { read_only: true, note: "PERF-2: data-free cache revalidation scheduled by the habit vote control after a burst of taps" },
  "app/(app)/habits/actions.ts#createIdentityHabitAction": { mcp: "habits.identity_habit.create" },
  "app/(app)/habits/actions.ts#setIdentityHabitFrequencyAction": { mcp: "habits.identity_habit.set_frequency" },
  "app/(app)/habits/actions.ts#archiveIdentityHabitAction": { mcp: "habits.identity_habit.archive" },
  "app/(app)/habits/actions.ts#killIdentityHabitAction": { pending: "P4-07", note: "P2-11 escalation-aware kill (habits.identity_habit.archive covers the underlying write; the escalation gate itself is a UI/product concern, not a separate MCP capability)" },
  "app/(app)/habits/actions.ts#pauseIdentityHabitAction": { pending: "P4-cov-P3-07" },
  "app/(app)/habits/actions.ts#resumeIdentityHabitAction": { pending: "P4-cov-P3-07" },
  "app/(app)/habits/actions.ts#castHabitVoteAction": { mcp: "habits.vote.cast" },
  "app/(app)/habits/actions.ts#retractHabitVoteAction": { mcp: "habits.vote.retract" },

  // ── Morning routine (P3-01) ─────────────────────────────────────────────
  "app/(app)/morning-routine/actions.ts#getMyMorningRoutineChecklist": { read_only: true },
  "app/(app)/morning-routine/actions.ts#createMorningRoutineItem": { mcp: "day.routine_item.create" },
  "app/(app)/morning-routine/actions.ts#archiveMorningRoutineItem": { mcp: "day.routine_item.archive" },
  "app/(app)/morning-routine/actions.ts#updateLaunchStep": { pending: "P4-09", note: "IA-P4b: edit a Launch-sequence step in place (day.routine_item.update)" },
  "app/(app)/morning-routine/actions.ts#setLaunchStepDone": { mcp: "day.routine_item.check", note: "IA-P4a absolute setter; MCP check/uncheck share setLaunchStepDoneCore (tick + linked habit vote)" },
  "app/(app)/morning-routine/actions.ts#refreshLaunchViews": { read_only: true, note: "IA-P4a: data-free cache revalidation scheduled by the Launch sequence card" },
  "app/(app)/morning-routine/actions.ts#checkMorningRoutineItem": { mcp: "day.routine_item.check" },
  "app/(app)/morning-routine/actions.ts#uncheckMorningRoutineItem": { mcp: "day.routine_item.uncheck", note: "undo-shaped delete of today's own check only" },

  // ── Onboarding ──────────────────────────────────────────────────────────
  "app/(app)/onboarding/actions.ts#saveDomainSelection": { excluded: "onboarding_wizard: step 1 domain picker" },
  "app/(app)/onboarding/actions.ts#saveSubdomains": { excluded: "onboarding_wizard: subdomain step" },
  "app/(app)/onboarding/actions.ts#saveSubdomainConfig": { excluded: "onboarding_wizard: subdomain config step" },
  "app/(app)/onboarding/actions.ts#getOnboardingState": { read_only: true },
  "app/(app)/onboarding/actions.ts#completeOnboarding": { excluded: "onboarding_wizard: final step" },

  // ── Day start ───────────────────────────────────────────────────────────
  "app/(app)/page-layout-actions.ts#getPageLayout": { read_only: true },
  "app/(app)/page-layout-actions.ts#savePageLayout": { pending: "P4-cov-WIDGET", note: "arranging a user's own page is a legitimate agent write; hiding never deletes data" },
  "app/(app)/day-setup/actions.ts#setUpDay": { excluded: "onboarding_wizard: one-time guided setup that composes three writes: enabled_features (settings update, MCP), routine steps (day.routine_item.create, MCP) and the wind-down plan (its own MCP twin is pending under P4-26)" },
  "app/(app)/open/actions.ts#startDayAction": { mcp: "day.day_start.start" },
  "app/(app)/open/actions.ts#startDayAtAction": { mcp: "day.day_start.start", note: "start with an earlier wake time: the same op, via the optional wake_time field" },

  // ── Plan details (domain / start time / timer) and the Home plan list ──
  "app/(app)/close/plan-actions.ts#commitPlan": { pending: "P4-cov-PLAN-DETAILS", note: "the plan stage's one-call Finish/Save: removals + per-line domain/Kill List/Work Backlog/School task/start time/timer/order + ranks (same savePlanRanksCore as review.night_plan_task.save_ranks); no hard delete reachable by MCP (typed lines are deleted, so the MCP twin must un-plan instead)" },
  "app/(app)/open/today/plan-item-actions.ts#startPlanItem": { pending: "P4-cov-PLAN-DETAILS", note: "starts a Deep Work/Study session (work_session.start twin exists) or an inline timer" },
  "app/(app)/open/today/plan-item-actions.ts#setPlanItemCompleted": { pending: "P4-cov-PLAN-DETAILS" },
  "app/(app)/close/gap-actions.ts#saveUntrackedGaps": { pending: "P4-cov-GAP-CHECKIN", note: "evening close: stores untracked-time answers as allocation check-ins; the MCP twin would save several windows at once (checkins.allocation.save saves one resolved window)" },
  "app/(app)/open/today/plan-item-actions.ts#pausePlanItem": { pending: "P4-cov-PLAN-DETAILS", note: "Package E: Pause replaces Stop; banks tasks.timer_elapsed_seconds. Resume is startPlanItem" },
  "app/(app)/insights/actions.ts#correctSessionLength": { pending: "P4-cov-PLAN-DETAILS", note: "Insights Session log: shorten an ended Deep session left running (moves ended_at, un-banks the plan line). No MCP twin yet" },

  // ── Self-Mastery (ULM) ──────────────────────────────────────────────────
  "app/(app)/personal/answer-feedback-actions.ts#getAnswerFeedback": { excluded: "llm_spend: grades a typed answer with gatewayChat; the agent can judge the answer itself" },
  "app/(app)/personal/answer-feedback-actions.ts#parseFeedbackForTest": { read_only: true, note: "pure parser exported for tests" },
  "app/(app)/personal/closer-day-connection-actions.ts#getCloserDayConnection": { excluded: "llm_spend: P2-15 closer-prompt day connection via gatewayChat; same shape as getAnswerFeedback just above, the agent can make this same connection itself" },
  "app/(app)/personal/self-mastery-actions.ts#fetchSourceChunkText": { read_only: true },
  // uploadBook was split into prepare/finalize/cancel so the PDF bytes go
  // straight to Storage instead of through a Server Action body (Next caps that
  // at 1 MB, which crashed every real book upload in production). Same access
  // decision as the single function it replaces, deliberately kept across all
  // three: an agent still cannot upload a book. Worth stating explicitly —
  // splitting a multipart-only action into JSON-shaped steps is exactly the kind
  // of refactor that can quietly turn an agent-unreachable operation into a
  // reachable one, so the exclusion has to be carried to every piece, not just
  // the one that still smells like a file upload. finalize also enqueues
  // ingestion LLM spend, which is its own reason.
  "app/(app)/personal/self-mastery-actions.ts#prepareBookUpload": { excluded: "file_upload: mints a signed upload URL for a book PDF" },
  "app/(app)/personal/self-mastery-actions.ts#finalizeBookUpload": { excluded: "file_upload: finalizes a book PDF upload and enqueues ingestion LLM spend" },
  "app/(app)/personal/self-mastery-actions.ts#cancelBookUpload": { excluded: "file_upload: cleanup for a failed/orphaned book PDF upload" },
  "app/(app)/personal/self-mastery-session-actions.ts#loadTodaysSession": { excluded: "ui_scaffold: get-or-create of today's review session via start_session RPC; self_mastery.review.grade works without it" },
  "app/(app)/personal/self-mastery-session-actions.ts#revealCardAnswer": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#revealLessonContext": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#revealQuestionAnswer": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#gradeCard": { mcp: "self_mastery.review.grade" },
  "app/(app)/personal/fsrs-tuning-actions.ts#getFsrsTuningStatus": { read_only: true },
  "app/(app)/personal/fsrs-tuning-actions.ts#triggerFsrsTuning": { excluded: "scope_ruling: P3-20's board file sets mcp_surface: no; an agent-triggerable retune is out of scope" },
  "app/(app)/personal/reflection-cards-actions.ts#listMyReflectionCards": { read_only: true },
  // GAP-06: reports flag-enabled + card-presence as two booleans so the
  // End-of-Hour entry can tell "feature off" from "on but empty". Reads only,
  // returns no card contents.
  "app/(app)/personal/reflection-cards-actions.ts#getEndOfHourEntryState": { read_only: true },
  "app/(app)/personal/reflection-cards-actions.ts#createReflectionCard": { pending: "P4-cov-P3-05" },
  "app/(app)/personal/reflection-cards-actions.ts#archiveReflectionCard": { pending: "P4-cov-P3-05" },
  "app/(app)/personal/reflection-cards-actions.ts#startEndOfHourRitual": { pending: "P4-cov-P3-05" },
  "app/(app)/personal/reflection-cards-actions.ts#submitEndOfHourReflection": { pending: "P4-cov-P3-05" },
  "app/(app)/personal/self-mastery-session-actions.ts#gradeQuestion": { mcp: "self_mastery.question_review.grade" },
  "app/(app)/personal/self-mastery-session-actions.ts#fetchCurrentCardState": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#fetchCurrentQuestionState": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#revalidateAfterReview": { read_only: true, note: "revalidatePath only" },
  "app/(app)/personal/self-mastery-session-actions.ts#finishSession": { mcp: "self_mastery.session.finish" },
  "app/(app)/personal/self-mastery-session-actions.ts#logSelfExplanation": { mcp: "self_mastery.self_explanation.log" },
  "app/(app)/personal/self-mastery-session-actions.ts#getDueSummary": { read_only: true, note: "self_mastery.due_summary view is P4-27" },
  "app/(app)/personal/self-mastery-session-actions.ts#getSelfMasteryCandidateInput": { read_only: true },
  // retryStarterDeckSeed removed in a0bfe5d (ONB item 11). It existed only to
  // re-attempt the Marcus Aurelius starter deck when onboarding's seed failed;
  // with no seed, there is nothing to retry. Entry retired by the Lead as
  // steward, only after the export was confirmed gone from HEAD — the parity
  // guard flagged it stale the instant the export disappeared, which is
  // precisely what P4-33 extended it to do.
  "app/(app)/personal/teach-back-actions.ts#getTeachableLessons": { read_only: true },
  "app/(app)/personal/teach-back-actions.ts#submitTeachBack": { excluded: "llm_spend: P2-18 teach-back evaluation via gatewayChat; the agent can evaluate its own explanation of a lesson itself" },

  // ── Review ──────────────────────────────────────────────────────────────

  // ── School ──────────────────────────────────────────────────────────────
  "app/(app)/school/actions.ts#addTask": { mcp: "school.task.add" },
  "app/(app)/school/actions.ts#updateTask": { mcp: "school.task.edit" },
  "app/(app)/school/actions.ts#toggleTask": { mcp: "school.task.toggle" },
  "app/(app)/school/actions.ts#completeTask": { excluded: "ui_scaffold: idempotent mark-done twin of toggleTask for the optimistic UI; MCP exposes the toggle" },
  "app/(app)/school/actions.ts#refreshSchoolViews": { read_only: true, note: "PERF-3: data-free cache revalidation scheduled by the school task controls after a burst of taps" },
  "app/(app)/school/actions.ts#removeTask": { excluded: "hard_delete: DELETEs a school task" },
  "app/(app)/school/actions.ts#addScheduleEvent": { excluded: "scope_ruling: SCHOOL-WRITE-SCOPE-DECISIONS ruling 2 (no schedule create)" },
  "app/(app)/school/actions.ts#cancelScheduleOccurrence": { mcp: "school.schedule_event.cancel_occurrence" },
  "app/(app)/school/actions.ts#uncancelScheduleOccurrence": { excluded: "hard_delete: DELETEs the cancellation row" },
  "app/(app)/school/actions.ts#addClassEvent": { excluded: "scope_ruling: SCHOOL-WRITE-SCOPE-DECISIONS ruling 2 (no schedule create)" },
  "app/(app)/school/actions.ts#updateClassEvent": { mcp: "school.schedule_event.edit_series", note: "partial: MCP edits one row's day/time; UI edits a multi-day class_group" },
  "app/(app)/school/actions.ts#removeClassEvent": { excluded: "hard_delete: DELETEs a class's schedule rows" },
  "app/(app)/school/announcement-actions.ts#extractAnnouncementDeliverables": { excluded: "llm_spend: announcement text extraction via LLM, same shape as syllabus-extraction-actions.ts's own extractSyllabusDeliverables" },
  "app/(app)/school/announcement-actions.ts#getAnnouncementHistory": { read_only: true },
  "app/(app)/school/assessment-actions.ts#getMyAssessmentsOverview": { read_only: true },
  "app/(app)/school/assessment-actions.ts#addAssessment": { mcp: "school.class_assessment.add" },
  "app/(app)/school/assessment-actions.ts#updateAssessment": { mcp: "school.class_assessment.edit" },
  "app/(app)/school/assessment-actions.ts#removeAssessment": { excluded: "hard_delete: DELETEs an assessment" },
  "app/(app)/school/class-actions.ts#addClassAssessment": { mcp: "school.class_assessment.add" },
  "app/(app)/school/class-actions.ts#deleteClassAssessment": { excluded: "hard_delete: DELETEs an assessment" },
  "app/(app)/school/class-actions.ts#updateClassAssessment": { mcp: "school.class_assessment.edit" },
  "app/(app)/self-mastery/search-actions.ts#searchSelfMasteryLibrary": { pending: "P4-cov-P2-13D", note: "semantic search over the caller's own lessons/chunks (P2-13D); owner-scoped by match_source_chunks' auth.uid filter" },
  "app/(app)/school/class-share-actions.ts#createClassShare": { excluded: "credential: mints a bearer share link that exposes a question bank publicly" },
  "app/(app)/school/class-share-actions.ts#revokeClassShare": { excluded: "credential: revokes that bearer share link" },
  "app/(app)/school/class-share-actions.ts#getClassShareStatus": { read_only: true },
  "app/(app)/school/class-share-actions.ts#getSharePreview": { read_only: true, note: "returns exactly the payload the public page would show" },
  "app/(app)/school/class-actions.ts#createGradeCategory": { mcp: "school.grade_category.create" },
  "app/(app)/school/class-actions.ts#updateGradeCategory": { mcp: "school.grade_category.update" },
  "app/(app)/school/class-actions.ts#deleteGradeCategory": { excluded: "hard_delete: DELETEs a grade category" },
  "app/(app)/school/class-actions.ts#listClassAssessments": { read_only: true },
  "app/(app)/school/class-actions.ts#listClassTasks": { read_only: true },
  "app/(app)/school/class-actions.ts#createClass": { mcp: "school.class.create" },
  "app/(app)/school/class-actions.ts#updateClass": { mcp: "school.class.edit" },
  "app/(app)/school/class-actions.ts#uploadClassSyllabus": { excluded: "file_upload: syllabus file to storage (SCHOOL-WRITE-SCOPE ruling 3)" },
  "app/(app)/school/class-actions.ts#removeClassSyllabus": { excluded: "file_upload: storage object removal (SCHOOL-WRITE-SCOPE ruling 3)" },
  "app/(app)/school/class-actions.ts#getClassSyllabusUrl": { read_only: true },
  "app/(app)/school/class-actions.ts#deleteClass": { excluded: "hard_delete: DELETEs a class" },
  "app/(app)/school/lecture-actions.ts#prepareLectureUpload": { pending: "P4-cov-P3-14", note: "upload/import via signed upload URL" },
  "app/(app)/school/lecture-actions.ts#finalizeLectureUpload": { pending: "P4-cov-P3-14" },
  "app/(app)/school/lecture-actions.ts#removeLectureRecording": { pending: "P4-cov-P3-14", note: "a DELETE; that task must rule on it against L6 before wiring" },
  "app/(app)/school/lecture-actions.ts#getLectureRecordingUrl": { read_only: true, note: "signed-URL read is in P4-cov-P3-14's scope" },
  "app/(app)/school/transcript-actions.ts#requestTranscription": { pending: "P4-cov-P3-15", note: "kicks off a paid BYOK job; that task must also decide how spend/provider selection surfaces to an agent" },
  "app/(app)/school/transcript-actions.ts#getTranscriptionAvailability": { read_only: true, note: "key-presence read is in P4-cov-P3-15's scope" },
  "app/(app)/school/practice-test-actions.ts#getMyPracticeTests": { read_only: true },
  "app/(app)/school/practice-test-actions.ts#getPracticeTestQuestions": { read_only: true },
  "app/(app)/school/practice-test-actions.ts#submitPracticeTestAnswer": { mcp: "school.practice_test.submit_answer" },
  "app/(app)/school/practice-test-actions.ts#completePracticeTest": { mcp: "school.practice_test.complete" },
  "app/(app)/school/question-actions.ts#createQuestion": { mcp: "school.question.create" },
  "app/(app)/school/question-actions.ts#updateQuestion": { mcp: "school.question.update" },
  "app/(app)/school/question-actions.ts#setQuestionActive": { mcp: "school.question.set_active" },
  "app/(app)/school/question-draft-actions.ts#draftQuestionsFromNotes": { excluded: "llm_spend: server-side question drafting; the agent authors questions via school.question.create" },
  "app/(app)/school/question-draft-actions.ts#draftQuestionsFromTranscript": { excluded: "llm_spend: same reasoning as draftQuestionsFromNotes above -- an MCP-connected agent can read the transcript itself (P4-cov-P3-15's scope) and author questions directly via school.question.create" },
  "app/(app)/school/staging-actions.ts#confirmStagingBatch": { mcp: "school.staging.confirm_batch" },
  "app/(app)/school/staging-actions.ts#updateStagedDeliverable": { mcp: "school.staging.update_deliverable" },
  "app/(app)/school/staging-actions.ts#deleteStagedDeliverable": { mcp: "school.staging.delete_deliverable", note: "pre-confirm only, per P4-08 AC" },
  "app/(app)/school/syllabus-extraction-actions.ts#extractSyllabusDeliverables": { excluded: "llm_spend: syllabus file extraction via LLM" },
  "app/(app)/school/syllabus-extraction-actions.ts#importCanvasSyllabus": { excluded: "llm_spend: Canvas syllabus_body extraction via LLM, same shape as extractSyllabusDeliverables" },

  // ── Settings ────────────────────────────────────────────────────────────
  "app/(app)/settings/account-actions.ts#deleteMyAccount": { excluded: "hard_delete: deletes the whole account" },
  "app/(app)/settings/theme-actions.ts#setThemePreset": { mcp: "settings.profile.update", note: "lean twin of updateProfile({theme_preset}) for the instant appearance picker" },
  "app/(app)/settings/theme-actions.ts#refreshThemeViews": { read_only: true, note: "THEME-01: data-free cache revalidation scheduled by the appearance picker after a burst of clicks" },
  "app/(app)/settings/actions.ts#updateProfile": { mcp: "settings.profile.update", note: "partial: display_name/timezone/prayer/location/checkin-window fields land in P4-26" },
  "app/(app)/settings/ai-preference-actions.ts#getMyAiPreference": { read_only: true },
  "app/(app)/settings/ai-preference-actions.ts#saveMyAiPreference": { pending: "P4-26", note: "settings.ai_preference.save (provider/tier, not a credential)" },
  "app/(app)/settings/ai-spend-actions.ts#getMyMonthlySpendStatus": { read_only: true },
  "app/(app)/settings/ai-spend-actions.ts#saveMyMonthlySpendCapUsd": { pending: "P4-cov-P2-01", note: "P2-01 spend ceiling; not a credential" },
  "app/(app)/settings/api-key-actions.ts#getApiKeyStatuses": { read_only: true },
  "app/(app)/settings/api-key-actions.ts#saveApiKey": { excluded: "credential: stores a provider API key" },
  "app/(app)/settings/api-key-actions.ts#removeApiKey": { excluded: "credential: removes a provider API key" },
  "app/(app)/settings/api-key-actions.ts#testStoredKey": { excluded: "credential: spends the stored provider key on a test call" },
  "app/(app)/settings/canvas-actions.ts#getCanvasConnectionStatus": { read_only: true },
  "app/(app)/settings/canvas-actions.ts#connectCanvas": { excluded: "credential: stores a Canvas token" },
  "app/(app)/settings/canvas-actions.ts#disconnectCanvas": { excluded: "credential: removes the Canvas token" },
  "app/(app)/settings/canvas-actions.ts#refreshCanvasCourses": { pending: "P4-cov-P2-20", note: "triggers a sync; the Canvas token stays server-side and is never exposed" },
  "app/(app)/settings/canvas-actions.ts#getCanvasCourseMappings": { read_only: true },
  "app/(app)/settings/canvas-actions.ts#getLocalClassOptions": { read_only: true },
  "app/(app)/settings/canvas-actions.ts#setCourseMapping": { pending: "P4-cov-P2-20", note: "course mapping is not a credential" },
  "app/(app)/settings/canvas-actions.ts#importConcludedCanvasCourses": { pending: "P4-cov-P2-20", note: "opt-in concluded-course import; the stored Canvas token stays server-side and is never exposed" },
  "app/(app)/settings/canvas-actions.ts#saveCanvasIcsFeedUrl": { excluded: "credential: saves the Canvas ICS calendar-feed URL, a bearer secret in URL form" },
  "app/(app)/settings/canvas-actions.ts#reconcileCanvasIcs": { excluded: "credential: decrypts and fetches the stored ICS feed credential to run reconciliation" },
  "app/(app)/settings/webhook-actions.ts#getWebhookStatuses": { read_only: true },
  "app/(app)/settings/webhook-actions.ts#createWebhook": { excluded: "credential: mints a webhook signing secret" },
  "app/(app)/settings/webhook-actions.ts#deleteWebhook": { excluded: "credential: removes a webhook and its signing secret" },
  "app/(app)/settings/webhook-actions.ts#testFireWebhook": { excluded: "credential: signs and sends a live test delivery using the webhook's own secret" },
  "app/(app)/settings/whoop-actions.ts#getWhoopSettingsStatus": { read_only: true, note: "connection status and scopes only; no token material" },
  "app/(app)/settings/whoop-actions.ts#disconnectWhoop": { excluded: "credential: disconnects a wearable-data OAuth credential" },
  "app/(app)/settings/rescuetime-actions.ts#connectRescueTime": { excluded: "credential: BYOK RescueTime API key save" },
  "app/(app)/settings/rescuetime-actions.ts#disconnectRescueTime": { excluded: "credential: removes the stored RescueTime key" },
  "app/(app)/settings/rescuetime-actions.ts#getRescueTimeConnectionStatus": { pending: "P4-cov-P3-19", note: "no-secret status read" },
  "app/(app)/settings/rescuetime-actions.ts#syncRescueTimeSummaries": { pending: "P4-cov-P3-19", note: "server-side sync with the stored key; the key never leaves the server" },
  "app/(app)/settings/location-actions.ts#searchCities": { read_only: true },
  "app/(app)/settings/location-actions.ts#getNearestCityLabel": { read_only: true },
  "app/(app)/settings/mcp-token-actions.ts#getMcpTokenStatuses": { read_only: true },
  "app/(app)/settings/mcp-token-actions.ts#createMcpToken": { excluded: "credential: mints a PAT" },
  "app/(app)/settings/mcp-token-actions.ts#getAuditEntriesForToken": { read_only: true },
  "app/(app)/settings/mcp-token-actions.ts#getScheduledActions": { read_only: true },
  "app/(app)/settings/mcp-token-actions.ts#pauseScheduledAction": { mcp: "scheduler.scheduled_action.pause", note: "P4-33: was pending P4-cov-SCHEDULES, but scheduler_manage(\"pause\") has been live and calls the SAME pauseScheduledActionCore this action does -- the entry described shipped work as unshipped" },
  "app/(app)/settings/mcp-token-actions.ts#cancelScheduledAction": { mcp: "scheduler.scheduled_action.cancel", note: "P4-33: was pending P4-cov-SCHEDULES, but scheduler_manage(\"cancel\") has been live and calls the SAME cancelScheduledActionCore this action does" },
  "app/(app)/settings/mcp-token-actions.ts#createAgentConnectLink": { excluded: "credential: mints a single-use connect code that exchanges for an agent PAT" },
  "app/(app)/settings/mcp-token-actions.ts#revokeMcpToken": { excluded: "credential: revokes a PAT" },
  "app/(app)/settings/focus-target-actions.ts#getFocusTargetSettings": { read_only: true },
  "app/(app)/settings/focus-target-actions.ts#saveFocusTargets": { pending: "P4-26", note: "HOME-01a daily/weekend focus target (user_settings.daily_focus_target_minutes/weekend_focus_target_minutes); MCP settings write widening" },
  "app/(app)/morning-brief-actions.ts#setMorningBriefCollapsed": { pending: "P4-26", note: "HOME-01a minimize/expand the morning brief for one brief_date (user_settings.morning_brief_collapsed_on); a UI-state preference, MCP twin optional" },
  "app/(app)/settings/wind-down-actions.ts#getWindDownSettings": { read_only: true },
  "app/(app)/settings/quran-reminder-actions.ts#saveQuranReminderWindow": { pending: "P4-26", note: "Package D Quran reminder window (user_settings.quran_reminder_start/end); MCP settings write widening" },
  "app/(app)/settings/wind-down-actions.ts#saveWindDownPlan": { pending: "P4-26", note: "IA-P4a set-once wind-down plan (user_settings.wake_time/sleep_need_minutes/wind_down_minutes); MCP settings write widening" },
  "app/(app)/settings/weekday-baseline-actions.ts#saveWeekdayBaselines": { mcp: "settings.user_setting.set_weekday_baselines" },
  "app/(app)/settings/weekday-baseline-actions.ts#clearWeekdayBaselines": { mcp: "settings.user_setting.clear_weekday_baselines" },

  // ── Widgets ─────────────────────────────────────────────────────────────
  "app/(app)/widgets/actions.ts#removeWidget": { mcp: "widgets.widget.delete", note: "via widget_manage (archives)" },

  // ── Work / co-op ────────────────────────────────────────────────────────
  "app/(app)/work/actions.ts#addWorkHours": { pending: "P4-09", note: "work.schedule_event.add_hours" },
  "app/(app)/work/actions.ts#updateWorkHours": { pending: "P4-09", note: "work.schedule_event.edit" },
  "app/(app)/work/actions.ts#removeWorkHours": { excluded: "hard_delete: DELETEs a work-hours series" },
  "app/(app)/work/actions.ts#addOneOffWorkShift": { pending: "P4-09", note: "work.schedule_event.add_shift" },
  "app/(app)/work/actions.ts#setWorkHoursOverride": { pending: "P4-09", note: "work.schedule_event.set_override" },
  "app/(app)/work/actions.ts#removeWorkHoursOverride": { excluded: "hard_delete: DELETEs an override row" },
  "app/(app)/work/actions.ts#cancelScheduleOccurrence": { pending: "P4-09", note: "work.schedule_event.cancel_occurrence" },
  "app/(app)/work/actions.ts#uncancelScheduleOccurrence": { pending: "P4-09", note: "work.schedule_event.uncancel_occurrence (P4-09 AC)" },
  "app/(app)/work/subdomain-actions.ts#createWorkSubdomain": { pending: "P4-09", note: "work.area.create" },
  "app/(app)/work/subdomain-actions.ts#renameWorkSubdomain": { pending: "P4-09", note: "work.area.rename" },
  "app/(app)/work/subdomain-actions.ts#archiveWorkSubdomain": { pending: "P4-09", note: "work.area.archive" },
  "app/(app)/work/subdomain-actions.ts#reorderWorkSubdomains": { pending: "P4-09", note: "work.area.reorder" },
  "app/(app)/work/subdomain-actions.ts#saveWorkTabs": { pending: "P4-09", note: "work.area.rename/reorder/archive in one atomic edit (WORK-W1 tab editor)" },
  "app/(app)/work/subdomain-actions.ts#ensureBusinessWorkTab": { pending: "P4-09", note: "work.area.create for the default Business tab (WORK-W1)" },
  "app/(app)/work/subdomain-actions.ts#refreshWorkViews": { read_only: true, note: "WORK-W1: data-free cache revalidation scheduled by the Work tab editor" },
  "app/(app)/work/targets-actions.ts#addTarget": { mcp: "work.target.create" },
  "app/(app)/work/targets-actions.ts#addStretchGoal": { mcp: "work.target.create", note: "kind: stretch" },
  "app/(app)/work/targets-actions.ts#editTarget": { mcp: "work.target.edit" },
  "app/(app)/work/targets-actions.ts#removeTarget": { excluded: "hard_delete: DELETEs a target" },
  "app/(app)/work/targets-actions.ts#completeTarget": { mcp: "work.target.complete" },
  "app/(app)/work/targets-actions.ts#moveTarget": { mcp: "work.target.reorder" },
  "app/(app)/work/tasks-actions.ts#addAgendaTask": { mcp: "work.task.add" },
  "app/(app)/work/tasks-actions.ts#editTask": { mcp: "work.task.edit" },
  "app/(app)/work/tasks-actions.ts#returnTaskToReview": { pending: "P4-09", note: "work.task.return_to_review" },
  "app/(app)/work/tasks-actions.ts#advanceTask": { mcp: "work.task.advance" },
  "app/(app)/work/tasks-actions.ts#retreatTask": { mcp: "work.task.retreat" },
  "app/(app)/work/tasks-actions.ts#blockTask": { mcp: "work.task.block" },
  "app/(app)/work/tasks-actions.ts#unblockTask": { mcp: "work.task.unblock" },
  "app/(app)/work/tasks-actions.ts#removeTask": { excluded: "hard_delete: DELETEs a work task" },
  "app/(app)/work/tasks-actions.ts#bulkRemoveTasks": { excluded: "hard_delete: DELETEs many work tasks" },

  // ── Worries ─────────────────────────────────────────────────────────────
  "app/(app)/worries/actions.ts#markWorryHandled": { mcp: "review.worry.set_handled" },
  "app/(app)/worries/actions.ts#reopenWorry": { mcp: "review.worry.reopen" },
  "app/(app)/worries/actions.ts#recordWorryOutcome": { pending: "P4-07", note: "P2-12: same surface as set_handled + an outcome enum; P4-07 should let review.worry.set_handled take an optional outcome rather than mint a second op" },

  // ── Auth ────────────────────────────────────────────────────────────────
  "app/login/actions.ts#signIn": { excluded: "auth: password sign-in" },
  "app/signup/actions.ts#signUp": { excluded: "auth: account sign-up" },

  // ── lib ─────────────────────────────────────────────────────────────────
  "lib/capture/actions.ts#captureTask": { mcp: "school.task.add" },
  "lib/capture/actions.ts#captureDistraction": { mcp: "distractions.trigger.capture" },
  "lib/capture/actions.ts#captureDump": { pending: "P4-07", note: "worry/note dump: review.night_plan_task.dump" },
  "lib/promotions/actions.ts#promoteLesson": { mcp: "self_mastery.lesson.promote" },
  "lib/promotions/actions.ts#recordVerdict": { mcp: "self_mastery.lesson_promotion.record_verdict" },

  // ── MCP-only write ops (P4-33) ──────────────────────────────────────────
  // Keyed by OP NAME, not by a Server Action path: these capabilities reach
  // the database through `write()` / `widget_manage` / `scheduler_manage`
  // with no `"use server"` function anywhere in the tree. parity-scan.ts
  // short-circuits on files lacking "use server", so for the whole life of
  // this manifest the guard was structurally unable to see them and reported
  // clean. Every one below was ALREADY LIVE the whole time — P4-33 found a
  // documentation gap, not a coverage gap, which is exactly why an absence
  // result from a guard is worth nothing until the guard is shown to fire.
  "deen.weekly_goal.save": { mcp: "deen.weekly_goal.save", note: "the deen half of app/(app)/actions.ts#saveWeeklyGoal, whose own entry can only name the business op" },
  "school.schedule_event.set_override": { mcp: "school.schedule_event.set_override" },
  "school.canvas_import.run_batch": { mcp: "school.canvas_import.run_batch", note: "distinct from canvas-actions.ts#importConcludedCanvasCourses, which stays pending P4-cov-P2-20" },
  "widgets.widget.create": { mcp: "widgets.widget.create", note: "via widget_manage; same tool as the already-declared widgets.widget.delete" },
  "widgets.widget.update": { mcp: "widgets.widget.update", note: "via widget_manage" },
  "scheduler.scheduled_action.create": { mcp: "scheduler.scheduled_action.create", note: "via scheduler_manage" },
  "scheduler.scheduled_action.cancel": { mcp: "scheduler.scheduled_action.cancel", note: "via scheduler_manage" },
  "scheduler.scheduled_action.pause": { mcp: "scheduler.scheduled_action.pause", note: "via scheduler_manage" },
};

/** Every manifest key still pending on `taskId` — the checklist for that task's builder. */
export function pendingFor(taskId: PendingTask, manifest: Record<string, ParityDecision> = PARITY_MANIFEST): string[] {
  return Object.entries(manifest)
    .filter(([, d]) => "pending" in d && d.pending === taskId)
    .map(([k]) => k);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite one `pending` entry to `{ mcp: op }` in this file's SOURCE text
 * and return the new source. Pure (no fs) so a builder can call it from a
 * one-off script or test:
 *
 *   const src = fs.readFileSync("lib/mcp/parity-manifest.ts", "utf8");
 *   fs.writeFileSync("lib/mcp/parity-manifest.ts",
 *     flipPendingToMcp(src, "app/(app)/deen/actions.ts#logQuranSession", "deen.quran_session.log"));
 *
 * Throws if the key is absent, appears more than once, or isn't pending.
 * The entry's `note` (if any) is dropped; the op name is the new record.
 */
export function flipPendingToMcp(source: string, key: string, op: string): string {
  if (!/^[a-z_]+\.[a-z_]+\.[a-z_]+$/.test(op)) throw new Error(`flipPendingToMcp: op "${op}" is not domain.entity.action`);
  const line = new RegExp(`^(\\s*)${escapeRegExp(JSON.stringify(key))}: \\{[^\\n]*\\},[ \\t]*$`, "gm");
  const matches = [...source.matchAll(line)];
  if (matches.length !== 1) throw new Error(`flipPendingToMcp: expected exactly one manifest line for ${key}, found ${matches.length}`);
  const [whole, indent] = matches[0];
  if (!/\{ pending: "/.test(whole)) throw new Error(`flipPendingToMcp: ${key} is not pending: ${whole.trim()}`);
  return source.replace(whole, () => `${indent}${JSON.stringify(key)}: { mcp: ${JSON.stringify(op)} },`);
}
