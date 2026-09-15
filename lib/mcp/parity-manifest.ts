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
  "P4-06": "write coverage: Deen",
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
  "P4-cov-P2-06": "timeboxing (task planned start time) MCP coverage",
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
  "app/(app)/actions.ts#getNotificationsForNow": { read_only: true },
  "app/(app)/actions.ts#markNotificationReadForNow": { excluded: "ui_scaffold: per-day notification dismissal state; no user-authored data" },
  "app/(app)/actions.ts#signOut": { excluded: "auth: ends the browser session" },
  "app/(app)/actions.ts#toggleItem": { pending: "P4-09", note: "prayer/kill-list/school-task/adhkar kinds already covered by their own ops; toggle_habit (fitness habit_logs) lands as fitness.habit_log.toggle" },
  "app/(app)/actions.ts#saveWeeklyGoal": { mcp: "business.weekly_goal.save", note: "domain 'business' -> business.weekly_goal.save; domain 'deen' -> deen.weekly_goal.save (P4-06)" },

  // ── Business / Lock-In ──────────────────────────────────────────────────
  "app/(app)/business/actions.ts#setKillListItem": { mcp: "business.kill_list_item.set" },
  "app/(app)/business/actions.ts#toggleKillListItem": { mcp: "business.kill_list_item.toggle" },
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
  "app/(app)/checkin/allocation-actions.ts#getAllocationQueueForNow": { read_only: true },
  "app/(app)/checkin/session-hour-actions.ts#setSessionHourStatus": { pending: "P4-09", note: "checkins.session_hour.set" },

  // ── Evening close / night plan ──────────────────────────────────────────
  "app/(app)/close/actions.ts#computePlanSeeds": { read_only: true },
  "app/(app)/close/actions.ts#getEveningCloseData": { read_only: true },
  "app/(app)/close/actions.ts#getReplanData": { read_only: true },
  "app/(app)/close/plan-actions.ts#dumpLine": { pending: "P4-07", note: "review.night_plan_task.dump" },
  "app/(app)/close/plan-actions.ts#claimSeedLines": { pending: "P4-07", note: "review.night_plan_task.claim_seeds" },
  "app/(app)/close/plan-actions.ts#savePlanRanks": { pending: "P4-07", note: "review.night_plan_task.save_ranks" },
  "app/(app)/close/sleep-intent-actions.ts#getMySleepIntentForToday": { read_only: true },
  "app/(app)/close/sleep-intent-actions.ts#saveMySleepIntent": { pending: "P4-07", note: "P2-05 sleep intent capture" },
  "app/(app)/close/sleep-intent-actions.ts#clearMySleepIntent": { pending: "P4-07", note: "P2-05 sleep intent capture; a same-day own-row delete, not a hard_delete in the destructive sense (habits.vote.retract precedent, P4-undo)" },

  // ── Deen ────────────────────────────────────────────────────────────────
  "app/(app)/deen/actions.ts#markPrayer": { mcp: "deen.prayer.log" },
  "app/(app)/deen/actions.ts#unmarkPrayer": { mcp: "deen.prayer.unlog", note: "UI deletes the row; MCP sets the non-destructive 'unlogged' status (migration 143)" },
  "app/(app)/deen/actions.ts#toggleAdhkar": { mcp: "deen.adhkar.toggle" },
  "app/(app)/deen/actions.ts#logQuranSession": { mcp: "deen.quran_session.log" },
  "app/(app)/deen/actions.ts#adjustQadaBacklog": { mcp: "deen.profile.adjust_qada" },
  "app/(app)/deen/actions.ts#setTravelingMode": { mcp: "deen.profile.set_traveling_mode" },
  "app/(app)/deen/actions.ts#logReflectionEntry": { mcp: "deen.reflection_entry.log" },
  "app/(app)/deen/actions.ts#decrementReflectionEntry": { excluded: "hard_delete: DELETEs the latest reflection_entries row (undo-shaped)" },
  "app/(app)/deen/actions.ts#createDeenHabit": { mcp: "deen.habit.create" },
  "app/(app)/deen/actions.ts#toggleDeenHabitLog": { mcp: "deen.habit_log.toggle" },
  "app/(app)/deen/actions.ts#toggleSunnah": { mcp: "deen.sunnah_log.toggle" },
  "app/(app)/deen/actions.ts#setWeeklyFocus": { mcp: "deen.weekly_focus.set" },
  "app/(app)/deen/actions.ts#updateDeenHabit": { mcp: "deen.habit.update" },
  "app/(app)/deen/actions.ts#archiveDeenHabit": { mcp: "deen.habit.archive", note: "soft archive, so allowed" },
  "app/(app)/deen/actions.ts#setDeenHabitStageOverride": { mcp: "deen.habit.set_stage_override" },
  "app/(app)/deen/actions.ts#setDeenHabitCommittedDate": { mcp: "deen.habit.set_committed_date" },
  "app/(app)/deen/actions.ts#setDeenHabitLogStatus": { mcp: "deen.habit_log.set_status" },
  "app/(app)/deen/actions.ts#getDeenHabitLogRange": { read_only: true },
  "app/(app)/deen/salah-calendar-actions.ts#getSalahMonthSummary": { read_only: true },
  "app/(app)/deen/salah-calendar-actions.ts#getSalahDayDetail": { read_only: true },

  // ── Distractions ────────────────────────────────────────────────────────
  "app/(app)/distractions/actions.ts#listTriggersForDomain": { read_only: true },
  "app/(app)/distractions/actions.ts#getTodayDistractionCountForNow": { read_only: true },
  "app/(app)/distractions/actions.ts#getSessionDistractionCountForNow": { read_only: true },
  "app/(app)/distractions/actions.ts#logDistraction": { mcp: "distractions.event.log" },
  "app/(app)/distractions/actions.ts#createTriggerAndLog": { mcp: "distractions.trigger.capture" },
  "app/(app)/distractions/actions.ts#updateTrigger": { pending: "P4-09", note: "distractions.trigger.update" },
  "app/(app)/distractions/actions.ts#saveActionPlan": { mcp: "distractions.action_plan.save" },
  "app/(app)/distractions/actions.ts#recordPlanOutcome": { mcp: "distractions.plan_outcome.record" },

  // ── Fitness ─────────────────────────────────────────────────────────────
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

  // ── Goals / identity habits ─────────────────────────────────────────────
  "app/(app)/goals/actions.ts#createGoalAction": { pending: "P4-07", note: "goals.goal.create" },
  "app/(app)/goals/actions.ts#setGoalStatusAction": { pending: "P4-07", note: "goals.goal.set_status" },
  "app/(app)/goals/actions.ts#addMilestoneAction": { pending: "P4-07", note: "goals.milestone.add" },
  "app/(app)/goals/actions.ts#setMilestoneDoneAction": { pending: "P4-07", note: "goals.milestone.set_done" },
  "app/(app)/habits/actions.ts#createIdentityHabitAction": { pending: "P4-07", note: "habits.identity_habit.create" },
  "app/(app)/habits/actions.ts#archiveIdentityHabitAction": { pending: "P4-07", note: "habits.identity_habit.archive" },
  "app/(app)/habits/actions.ts#castHabitVoteAction": { pending: "P4-07", note: "habits.vote.cast" },
  "app/(app)/habits/actions.ts#retractHabitVoteAction": { pending: "P4-07", note: "habits.vote.retract: today-only own-row DELETE, allowed by lead DECISION [P4-undo]" },

  // ── Onboarding ──────────────────────────────────────────────────────────
  "app/(app)/onboarding/actions.ts#saveDomainSelection": { excluded: "onboarding_wizard: step 1 domain picker" },
  "app/(app)/onboarding/actions.ts#saveSubdomains": { excluded: "onboarding_wizard: subdomain step" },
  "app/(app)/onboarding/actions.ts#saveSubdomainConfig": { excluded: "onboarding_wizard: subdomain config step" },
  "app/(app)/onboarding/actions.ts#getOnboardingState": { read_only: true },
  "app/(app)/onboarding/actions.ts#completeOnboarding": { excluded: "onboarding_wizard: final step" },

  // ── Day start ───────────────────────────────────────────────────────────
  "app/(app)/open/actions.ts#startDayAction": { pending: "P4-07", note: "day.day_start.start" },

  // ── Timeboxing (P2-06) ──────────────────────────────────────────────────
  "app/(app)/open/today/timebox-actions.ts#setTaskPlannedStartTime": { pending: "P4-cov-P2-06", note: "a plain HH:MM patch to a task the caller already owns, not a credential" },
  "app/(app)/open/today/timebox-actions.ts#clearTaskPlannedStartTime": { pending: "P4-cov-P2-06" },

  // ── Self-Mastery (ULM) ──────────────────────────────────────────────────
  "app/(app)/personal/answer-feedback-actions.ts#getAnswerFeedback": { excluded: "llm_spend: grades a typed answer with gatewayChat; the agent can judge the answer itself" },
  "app/(app)/personal/answer-feedback-actions.ts#parseFeedbackForTest": { read_only: true, note: "pure parser exported for tests" },
  "app/(app)/personal/self-mastery-actions.ts#fetchSourceChunkText": { read_only: true },
  "app/(app)/personal/self-mastery-actions.ts#uploadBook": { excluded: "file_upload: book file upload plus ingestion LLM spend" },
  "app/(app)/personal/self-mastery-session-actions.ts#loadTodaysSession": { excluded: "ui_scaffold: get-or-create of today's review session via start_session RPC; self_mastery.review.grade works without it" },
  "app/(app)/personal/self-mastery-session-actions.ts#revealCardAnswer": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#revealLessonContext": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#revealQuestionAnswer": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#gradeCard": { mcp: "self_mastery.review.grade" },
  "app/(app)/personal/self-mastery-session-actions.ts#gradeQuestion": { pending: "P4-08", note: "self_mastery.question_review.grade" },
  "app/(app)/personal/self-mastery-session-actions.ts#fetchCurrentCardState": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#fetchCurrentQuestionState": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#revalidateAfterReview": { read_only: true, note: "revalidatePath only" },
  "app/(app)/personal/self-mastery-session-actions.ts#finishSession": { pending: "P4-08", note: "self_mastery.session.finish" },
  "app/(app)/personal/self-mastery-session-actions.ts#logSelfExplanation": { mcp: "self_mastery.self_explanation.log" },
  "app/(app)/personal/self-mastery-session-actions.ts#getDueSummary": { read_only: true, note: "self_mastery.due_summary view is P4-27" },
  "app/(app)/personal/self-mastery-session-actions.ts#getSelfMasteryCandidateInput": { read_only: true },
  "app/(app)/personal/self-mastery-session-actions.ts#retryStarterDeckSeed": { excluded: "onboarding_wizard: retries the first-run starter deck seed" },

  // ── Review ──────────────────────────────────────────────────────────────
  "app/(app)/review/actions.ts#getReviewData": { read_only: true },

  // ── School ──────────────────────────────────────────────────────────────
  "app/(app)/school/actions.ts#addTask": { mcp: "school.task.add" },
  "app/(app)/school/actions.ts#updateTask": { mcp: "school.task.edit" },
  "app/(app)/school/actions.ts#toggleTask": { mcp: "school.task.toggle" },
  "app/(app)/school/actions.ts#removeTask": { excluded: "hard_delete: DELETEs a school task" },
  "app/(app)/school/actions.ts#addScheduleEvent": { excluded: "scope_ruling: SCHOOL-WRITE-SCOPE-DECISIONS ruling 2 (no schedule create)" },
  "app/(app)/school/actions.ts#cancelScheduleOccurrence": { mcp: "school.schedule_event.cancel_occurrence" },
  "app/(app)/school/actions.ts#uncancelScheduleOccurrence": { excluded: "hard_delete: DELETEs the cancellation row" },
  "app/(app)/school/actions.ts#addClassEvent": { excluded: "scope_ruling: SCHOOL-WRITE-SCOPE-DECISIONS ruling 2 (no schedule create)" },
  "app/(app)/school/actions.ts#updateClassEvent": { mcp: "school.schedule_event.edit_series", note: "partial: MCP edits one row's day/time; UI edits a multi-day class_group" },
  "app/(app)/school/actions.ts#removeClassEvent": { excluded: "hard_delete: DELETEs a class's schedule rows" },
  "app/(app)/school/announcement-actions.ts#extractAnnouncementDeliverables": { excluded: "llm_spend: announcement text extraction via LLM, same shape as syllabus-extraction-actions.ts's own extractSyllabusDeliverables" },
  "app/(app)/school/announcement-actions.ts#getAnnouncementHistory": { read_only: true },
  "app/(app)/school/class-actions.ts#addClassAssessment": { mcp: "school.class_assessment.add" },
  "app/(app)/school/class-actions.ts#deleteClassAssessment": { excluded: "hard_delete: DELETEs an assessment" },
  "app/(app)/school/class-actions.ts#updateClassAssessment": { mcp: "school.class_assessment.edit", note: "partial: category_id lands in P4-08" },
  "app/(app)/school/class-actions.ts#createGradeCategory": { pending: "P4-08", note: "school.grade_category.create" },
  "app/(app)/school/class-actions.ts#updateGradeCategory": { pending: "P4-08", note: "school.grade_category.update" },
  "app/(app)/school/class-actions.ts#deleteGradeCategory": { excluded: "hard_delete: DELETEs a grade category" },
  "app/(app)/school/class-actions.ts#listClassAssessments": { read_only: true },
  "app/(app)/school/class-actions.ts#listClassTasks": { read_only: true },
  "app/(app)/school/class-actions.ts#createClass": { mcp: "school.class.create", note: "partial: 152 policy fields land in P4-08" },
  "app/(app)/school/class-actions.ts#updateClass": { mcp: "school.class.edit", note: "partial: 152 policy fields land in P4-08" },
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
  "app/(app)/school/practice-test-actions.ts#submitPracticeTestAnswer": { pending: "P4-08", note: "P2-09 self-reported practice-test answer" },
  "app/(app)/school/practice-test-actions.ts#completePracticeTest": { pending: "P4-08", note: "P2-09 practice-test completion + score" },
  "app/(app)/school/question-actions.ts#createQuestion": { pending: "P4-08", note: "school.question.create" },
  "app/(app)/school/question-actions.ts#updateQuestion": { pending: "P4-08", note: "school.question.update" },
  "app/(app)/school/question-actions.ts#setQuestionActive": { pending: "P4-08", note: "school.question.set_active" },
  "app/(app)/school/question-draft-actions.ts#draftQuestionsFromNotes": { excluded: "llm_spend: server-side question drafting; the agent authors questions via school.question.create" },
  "app/(app)/school/staging-actions.ts#confirmStagingBatch": { pending: "P4-08", note: "school.staging.confirm_batch" },
  "app/(app)/school/staging-actions.ts#updateStagedDeliverable": { pending: "P4-08", note: "school.staging.update_deliverable" },
  "app/(app)/school/staging-actions.ts#deleteStagedDeliverable": { pending: "P4-08", note: "school.staging.delete_deliverable (pre-confirm only, per P4-08 AC)" },
  "app/(app)/school/syllabus-extraction-actions.ts#extractSyllabusDeliverables": { excluded: "llm_spend: syllabus file extraction via LLM" },

  // ── Settings ────────────────────────────────────────────────────────────
  "app/(app)/settings/account-actions.ts#deleteMyAccount": { excluded: "hard_delete: deletes the whole account" },
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
  "app/(app)/settings/location-actions.ts#searchCities": { read_only: true },
  "app/(app)/settings/location-actions.ts#getNearestCityLabel": { read_only: true },
  "app/(app)/settings/mcp-token-actions.ts#getMcpTokenStatuses": { read_only: true },
  "app/(app)/settings/mcp-token-actions.ts#createMcpToken": { excluded: "credential: mints a PAT" },
  "app/(app)/settings/mcp-token-actions.ts#revokeMcpToken": { excluded: "credential: revokes a PAT" },
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
  "app/(app)/worries/actions.ts#markWorryHandled": { pending: "P4-07", note: "review.worry.set_handled" },
  "app/(app)/worries/actions.ts#reopenWorry": { pending: "P4-07", note: "review.worry.reopen" },
  "app/(app)/worries/actions.ts#recordWorryOutcome": { pending: "P4-07", note: "P2-12: same surface as set_handled + an outcome enum; P4-07 should let review.worry.set_handled take an optional outcome rather than mint a second op" },

  // ── Auth ────────────────────────────────────────────────────────────────
  "app/login/actions.ts#signIn": { excluded: "auth: password sign-in" },
  "app/signup/actions.ts#signUp": { excluded: "auth: account sign-up" },

  // ── lib ─────────────────────────────────────────────────────────────────
  "lib/capture/actions.ts#captureTask": { mcp: "school.task.add" },
  "lib/capture/actions.ts#captureDistraction": { mcp: "distractions.trigger.capture" },
  "lib/capture/actions.ts#captureDump": { pending: "P4-07", note: "worry/note dump: review.night_plan_task.dump" },
  "lib/promotions/actions.ts#promoteLesson": { pending: "P4-08", note: "self_mastery.lesson.promote" },
  "lib/promotions/actions.ts#recordVerdict": { mcp: "self_mastery.lesson_promotion.record_verdict" },
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
