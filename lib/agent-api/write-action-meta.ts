/**
 * Per-write-action facts the agent surface needs that lib/mcp/write-registry.ts
 * does not declare as data (P4-03). Both are re-derived from write-registry.ts's
 * SOURCE by lib/agent-api/__tests__/write-action-meta.test.ts, which fails the
 * moment an action is added or changed without this file following it.
 *
 * Kept here, not on WriteActionDef, only because write-registry.ts belongs to
 * another lane tonight. Folding both into WriteActionDef (`requiresId`,
 * `dateDefault`) is the right long-term home.
 *
 * Keys are "domain.entity.action".
 */

/** Handlers that call requireId(ctx): the call must carry the top-level `id`. */
export const ACTIONS_REQUIRING_ID: ReadonlySet<string> = new Set([
  "work.target.edit",
  "work.target.complete",
  "work.target.reorder",
  "work.task.add",
  "work.task.edit",
  "work.task.advance",
  "work.task.retreat",
  "work.task.block",
  "work.task.unblock",
  "work.work_session.end",
  "business.kill_list_item.toggle",
  "school.task.edit",
  "school.task.toggle",
  "school.class.edit",
  "school.class_assessment.add",
  "school.class_assessment.edit",
  "school.schedule_event.edit_series",
  "school.schedule_event.set_override",
  "school.schedule_event.cancel_occurrence",
  "fitness.workout_session.confirm_plan_session",
  "fitness.exercise.archive",
  "fitness.workout.rename",
  "fitness.workout.archive",
  "self_mastery.lesson_promotion.record_verdict",
  // P4-06
  "deen.habit.update",
  "deen.habit.archive",
  "deen.habit.set_stage_override",
  "deen.habit.set_committed_date",
  "deen.habit.set_frequency",
  "deen.habit_log.toggle",
  "deen.habit_log.set_status",
  "deen.weekly_focus.set",
  // P4-07
  "review.worry.set_handled",
  "review.worry.reopen",
  "goals.goal.set_status",
  "goals.milestone.set_done",
  "habits.identity_habit.archive",
  "habits.identity_habit.set_frequency",
  "habits.vote.cast",
  "habits.vote.retract",
  // P3-01
  "day.routine_item.archive",
  "day.routine_item.check",
  "day.routine_item.uncheck",
  // P4-08
  "school.question.create",
  "school.question.update",
  "school.question.set_active",
  "school.grade_category.create",
  "school.grade_category.update",
  "school.staging.confirm_batch",
  "school.staging.update_deliverable",
  "school.staging.delete_deliverable",
  "self_mastery.session.finish",
  "school.practice_test.submit_answer",
  "school.practice_test.complete",
]);

/**
 * Handlers that require patch.date where the date means "the day this
 * happened". When an agent omits it, lib/mcp/tools/write.ts fills in the
 * ACCOUNT'S local today (localDateString(now, timezone)) — so an agent running
 * on UTC in the user's evening doesn't log tomorrow.
 */
export const DATE_DEFAULTS_TO_TODAY: ReadonlySet<string> = new Set([
  "deen.prayer.log",
  "deen.prayer.unlog",
  "deen.sunnah_log.toggle",
  "deen.adhkar.toggle",
  "business.kill_list_item.set",
  "fitness.workout_session.quick_log",
  "fitness.workout_session.confirm",
  "fitness.workout_session.confirm_plan_session",
  "fitness.body_metric.log_weight",
  "fitness.body_metric.log_waist",
  "fitness.fitness_benchmark.log",
  // P4-06 -- all "log a thing that happened" shapes, same reasoning as prayer/sunnah/adhkar above.
  "deen.quran_session.log",
  "deen.reflection_entry.log",
  "deen.habit_log.toggle",
  "deen.habit_log.set_status",
  // P4-07 -- votes may only ever be cast/retracted for local today anyway
  // (assertRequestedDateIsToday rejects anything else), so defaulting the
  // one legal value removes friction without weakening the guarantee.
  "habits.vote.cast",
  "habits.vote.retract",
  // P3-01 -- same reasoning: checks may only ever be applied to local
  // today (assertRequestedDateIsToday rejects anything else).
  "day.routine_item.check",
  "day.routine_item.uncheck",
]);

/** Handlers that require patch.date where a silent "today" would be wrong. The agent must always send it. */
export const DATE_NEVER_DEFAULTED: Readonly<Record<string, string>> = {
  "school.class_assessment.add": "the assessment's own date, which is rarely today",
  "school.class_assessment.edit": "omitting it would overwrite the stored assessment date with today",
  "school.schedule_event.set_override": "names which class occurrence to move; a guess could move the wrong one",
  "school.schedule_event.cancel_occurrence": "names which class occurrence to cancel; a guess could cancel the wrong one",
};

export function writeActionKey(domain: string, entity: string, action: string): string {
  return `${domain}.${entity}.${action}`;
}
