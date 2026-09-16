import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  markPrayerCore,
  unlogPrayerCore,
  toggleSunnahCore,
  toggleAdhkarCore,
  quranSessionLogCore,
  adjustQadaBacklogCore,
  setTravelingModeCore,
  reflectionEntryLogCore,
  createDeenHabitCore,
  updateDeenHabitCore,
  archiveDeenHabitCore,
  setDeenHabitStageOverrideCore,
  setDeenHabitCommittedDateCore,
  toggleDeenHabitLogCore,
  setDeenHabitLogStatusCore,
  setWeeklyFocusCore,
  saveDeenWeeklyGoalCore,
} from "@/lib/deen/actions-core";
import type { HabitStage } from "@/lib/deen/habit-stage";
import { localDateString } from "@/lib/date-utils";
import { planningDateForCore, dumpLineCore, claimSeedLinesCore, savePlanRanksCore, type PlanMode, type SeedLine, type SeedSource } from "@/lib/night-plan/plan-actions-core";
import { markWorryHandledCore, reopenWorryCore } from "@/lib/night-plan/worries";
import { saveSleepIntentCore, clearSleepIntentCore } from "@/lib/night-plan/sleep-intent-core";
import { markDayStarted } from "@/lib/day-structure/day-start";
import {
  createMorningRoutineItemCore,
  archiveMorningRoutineItemCore,
  checkMorningRoutineItemCore,
  uncheckMorningRoutineItemCore,
} from "@/lib/morning-routine/actions-core";
import { createGoal, completeGoal, dropGoal, addMilestone, completeMilestone, reopenMilestone } from "@/lib/goals/actions-core";
import { createIdentityHabitCore, archiveIdentityHabitCore, castHabitVoteCore, retractHabitVoteCore } from "@/lib/habits/actions-core";
import { addTargetCore, addStretchGoalCore, editTargetCore, completeTargetCore, moveTargetCore } from "@/lib/coop/targets-core";
import { addAgendaTaskCore, editTaskCore, advanceTaskCore, retreatTaskCore, blockTaskCore, unblockTaskCore } from "@/lib/coop/tasks-core";
import { setKillListItemCore, toggleKillListItemCore, saveBusinessWeeklyGoalCore, startWorkSessionCore, endWorkSessionCore } from "@/lib/business/actions-core";
import { addTaskCore, updateTaskCore, toggleTaskCore, updateScheduleEventCore, setScheduleEventOverrideCore, cancelScheduleOccurrenceCore } from "@/lib/tasks/actions-core";
import {
  createClassCore,
  updateClassCore,
  addClassAssessmentCore,
  updateClassAssessmentCore,
  createGradeCategoryCore,
  updateGradeCategoryCore,
  ASSESSMENT_TYPES,
} from "@/lib/school/actions-core";
import { createQuestionCore, updateQuestionCore, setQuestionActiveCore } from "@/lib/school/questions-core";
import { confirmStagingBatchCore, updateStagedDeliverableCore, deleteStagedDeliverableCore } from "@/lib/school/staging-core";
import { runCanvasImportBatchCore, CANVAS_IMPORT_MAX_ITEMS, type CanvasImportItem } from "@/lib/canvas/agent-import-core";
import { submitPracticeTestAnswerCore, completePracticeTestCore } from "@/lib/school/practice-test-actions-core";
import {
  quickLogExerciseCore,
  confirmWorkoutSessionCore,
  confirmPlanSessionCore,
  logWeightCore,
  logWaistCore,
  logBenchmarkRepsCore,
  createExerciseCore,
  archiveExerciseCore,
  renameWorkoutCore,
  archiveWorkoutCore,
  type ConfirmSetInput,
} from "@/lib/fitness/actions-core";
import { MUSCLE_GROUPS, type MuscleGroup } from "@/lib/fitness/volume";
import type { CoopTaskStatus } from "@/lib/coop/tasks";
import { PRAYER_NAMES, type PrayerName } from "@/lib/prayer-times/windows";
import { saveAllocationCheckinCore } from "@/lib/checkins/actions-core";
import { captureCore, logEventCore, saveActionPlanCore, recordPlanOutcomeCore } from "@/lib/distractions/actions-core";
import { updateAppearanceCore, setWeekdayBaselinesCore, clearWeekdayBaselinesCore } from "@/lib/settings/actions-core";
import { gradeReviewCore, logSelfExplanationCore } from "@/lib/self-mastery/actions-core";
import { recordVerdictCore, promoteLessonCore } from "@/lib/promotions/actions-core";
import {
  fetchQuestionState,
  loadSessionSettings,
  submitQuestionReview,
  computeSessionBookStrengths,
  completeTodaysSession,
  countDueTomorrow,
} from "@/lib/self-mastery/session/build-session";
import type { RunMcpToolOutcome } from "./tool-wrapper";
import { ToolInputError, ToolNotFoundError } from "./tool-input-error";

/**
 * `write(domain, entity, action, id?, patch?)` — L6's dispatch table,
 * the mirror of `read`'s (lib/mcp/registry.ts). Same posture: the SHAPE is
 * the deliverable, not the coverage — `deen` started with the 3 actions
 * built that layer (team-lead: "start with toggleSunnah / toggleAdhkar /
 * markPrayer... they are the owner's 'checking off logs' in the most
 * literal form"). `deen.prayer.unlog` (R9) is now a fourth — see the
 * header on `deen.prayer`'s action map below and
 * docs/ai-connector/WRITE-DELETE-DECISION.md for why it was held back
 * initially and what changed (a real, non-destructive `'unlogged'` status
 * value, not a workaround).
 *
 * Every handler here calls a `core()` from lib/deen/actions-core.ts that
 * NEVER calls `requireUser()`/`getProfile()`/`getAuthedUser()` — this file
 * is itself proof that the same core a cookie-authed Server Action calls
 * is reachable from a bearer-authed MCP tool with zero duplication of the
 * actual business logic (date guards, upsert shapes, conflict keys).
 *
 * `timezone`/`now` are resolved ONCE by `lib/mcp/tools/write.ts` (the one
 * caller) and threaded through as part of `WriteContext` — never re-fetched
 * per handler, and never computed with a raw `new Date()` inside a handler
 * (AGENTS.md's timezone rule).
 */

export interface WriteContext {
  userClient: SupabaseClient;
  userId: string;
  timezone: string;
  now: Date;
  /** `write(..., id?, ...)`'s top-level id — for actions that target an EXISTING row by id (edit/advance/reorder/...), as opposed to deen's date-keyed actions, which never use it. */
  id?: string;
}

export type WritePatch = Record<string, unknown>;

export type WriteHandler = (ctx: WriteContext, patch: WritePatch) => Promise<RunMcpToolOutcome>;

export interface WriteActionDef {
  action: string;
  description: string;
  /** Documented for list_capabilities' future use and for readers of this file — not yet enforced as a separate schema layer; each handler validates its own patch shape directly. */
  patchShape: string;
  handler: WriteHandler;
  /**
   * Whether calling this action's handler TWICE with the identical
   * id/patch produces the SAME end state as calling it once — L7's gate
   * (lib/scheduling/scheduler-core.ts's `createScheduledActionCore`)
   * refuses to schedule ANY action where this isn't exactly `true`,
   * because at-least-once delivery means a scheduled action can genuinely
   * fire twice for the same intended firing (app/api/self-mastery/
   * ingestion/step/route.ts's own header reasons through the identical
   * concern for a different pipeline).
   *
   * ABSENT/`undefined` MEANS NOT VERIFIED, NOT "ASSUMED SAFE" — the
   * scheduler treats it exactly like `false`. Most actions in this file
   * carry no annotation at all; that is an honest "nobody has checked
   * this yet," not a claim either way, and is deliberately NOT filled in
   * here by guessing at code this file's other authors wrote. When you DO
   * verify one (in either direction), set this AND
   * `idempotencyVerification` together, same discipline as
   * `EntityDef.updatedAtColumn`/`updatedAtVerification` in registry.ts.
   */
  idempotent?: boolean;
  /** One sentence naming the REAL mechanism checked (a conflict/no-op path, a fixed-value overwrite, a pre-check that lands retries on a safe branch) — or, if `idempotent: false`, the concrete way a retry duplicates data. Required whenever `idempotent` is set at all; never a restatement of the action's name. */
  idempotencyVerification?: string;
}

export interface WriteEntityDef {
  entity: string;
  actions: Record<string, WriteActionDef>;
}

export interface WriteDomainDef {
  domain: string;
  entities: Record<string, WriteEntityDef>;
}

function isPrayerName(value: unknown): value is PrayerName {
  return typeof value === "string" && (PRAYER_NAMES as readonly string[]).includes(value);
}

// Every throw in this file's require*/optional* helpers below is a
// ToolInputError, not a bare Error — 2026-09-14, Opus Lead ruling (#37
// follow-up). Each one only ever echoes back the literal field name, an
// allowed-values list this file itself defines, and the caller's OWN
// submitted value via JSON.stringify — never a database-read value, never
// an internal identifier. Safe to hand back to the calling AI client
// verbatim (tool-wrapper.ts's runMcpTool does exactly that for a
// ToolInputError). Contrast with assertRowDomain below, deliberately NOT
// converted because its message includes a DB-read column value.

function requireString(patch: WritePatch, field: string): string {
  const value = patch[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolInputError(`patch.${field} is required and must be a non-empty string.`);
  }
  return value;
}

function requireEnum<T extends string>(patch: WritePatch, field: string, allowed: readonly T[]): T {
  const value = patch[field];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ToolInputError(`patch.${field} must be one of: ${allowed.join(", ")}. Got: ${JSON.stringify(value)}.`);
  }
  return value as T;
}

function requireNumberEnum<T extends number>(patch: WritePatch, field: string, allowed: readonly T[]): T {
  const value = patch[field];
  if (typeof value !== "number" || !(allowed as readonly number[]).includes(value)) {
    throw new ToolInputError(`patch.${field} must be one of: ${allowed.join(", ")}. Got: ${JSON.stringify(value)}.`);
  }
  return value as T;
}

function requirePrayerName(patch: WritePatch): PrayerName {
  const value = patch.prayer_name;
  if (!isPrayerName(value)) {
    throw new ToolInputError(`patch.prayer_name must be one of: ${PRAYER_NAMES.join(", ")}. Got: ${JSON.stringify(value)}.`);
  }
  return value;
}

/** The top-level `write(..., id, ...)` — required by every action here that targets an existing row (edit/advance/reorder/toggle/...), as opposed to deen's date-keyed actions. */
function requireId(ctx: WriteContext): string {
  if (!ctx.id) throw new ToolInputError("This action requires the top-level `id` of the row to act on.");
  return ctx.id;
}

function requireNumber(patch: WritePatch, field: string): number {
  const value = patch[field];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ToolInputError(`patch.${field} is required and must be a number. Got: ${JSON.stringify(value)}.`);
  }
  return value;
}

function requireBoolean(patch: WritePatch, field: string): boolean {
  const value = patch[field];
  if (typeof value !== "boolean") {
    throw new ToolInputError(`patch.${field} is required and must be a boolean. Got: ${JSON.stringify(value)}.`);
  }
  return value;
}

/** null is a valid value here (reset to automatic / clear an override) — distinct from undefined (field omitted). */
function requireHabitStageOrNull(patch: WritePatch): HabitStage | null {
  const value = patch.stage;
  const allowed: readonly HabitStage[] = ["active_build", "stabilized", "locked"];
  if (value === null) return null;
  if (typeof value !== "string" || !allowed.includes(value as HabitStage)) {
    throw new ToolInputError(`patch.stage must be one of: ${allowed.join(", ")}, or null to reset to automatic. Got: ${JSON.stringify(value)}.`);
  }
  return value as HabitStage;
}

function optionalNumber(patch: WritePatch, field: string): number | undefined {
  const value = patch[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new ToolInputError(`patch.${field} must be a number. Got: ${JSON.stringify(value)}.`);
  return value;
}

function optionalString(patch: WritePatch, field: string): string | undefined {
  const value = patch[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ToolInputError(`patch.${field} must be a string. Got: ${JSON.stringify(value)}.`);
  return value;
}

function optionalNullableString(patch: WritePatch, field: string): string | null | undefined {
  const value = patch[field];
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== "string") throw new ToolInputError(`patch.${field} must be a string or null. Got: ${JSON.stringify(value)}.`);
  return value;
}

function optionalNullableNumber(patch: WritePatch, field: string): number | null | undefined {
  const value = patch[field];
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== "number") throw new ToolInputError(`patch.${field} must be a number or null. Got: ${JSON.stringify(value)}.`);
  return value;
}

/** `classes.grade_boundaries` (migration 152) -- a jsonb array of {letter, minPct}, or null/undefined. Shape-checked field-by-field here (never trusted past JSON.stringify's own type erasure) since it's a caller-constructed array, not a single scalar like every other optional* helper handles. */
function requireGradeBoundariesOrUndefined(patch: WritePatch, field: string): { letter: string; minPct: number }[] | null | undefined {
  const value = patch[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value) || !value.every((v) => v !== null && typeof v === "object" && typeof (v as Record<string, unknown>).letter === "string" && typeof (v as Record<string, unknown>).minPct === "number")) {
    throw new ToolInputError(`patch.${field} must be an array of {letter: string, minPct: number}, or null. Got: ${JSON.stringify(value)}.`);
  }
  return value as { letter: string; minPct: number }[];
}

/**
 * school's `task`/`schedule_event` write actions target an EXISTING row by
 * the top-level `id` — but `tasks.domain` and `schedule_events.domain` are
 * both shared with `co_op` (and, for `tasks`, a third state: NULL for a
 * Night Plan dump, migration 119). Unlike the read side's `fixedFilter`
 * (lib/mcp/registry.ts), there is no generic table dispatcher on the write
 * side to enforce this structurally — each handler here is bespoke code —
 * so this is the write-side counterpart, checked explicitly before any
 * mutation: a caller holding a `school`-scoped write must not be able to
 * retitle/reschedule a `co_op` work-hours row (or a Night Plan dump item)
 * just because it happens to belong to the same user. Found while wiring
 * this domain, not assumed away — flagged to the lead in the handoff report
 * alongside the (pre-existing, unrelated to this change) observation that
 * the cookie-authed Work/School Server Actions have never enforced this
 * either.
 */
function isMuscleGroup(value: unknown): value is MuscleGroup {
  return typeof value === "string" && (MUSCLE_GROUPS as readonly string[]).includes(value);
}

function optionalMuscleGroupArray(patch: WritePatch, field: string): MuscleGroup[] {
  const value = patch[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isMuscleGroup)) {
    throw new ToolInputError(`patch.${field} must be an array of muscle groups (${MUSCLE_GROUPS.join(", ")}). Got: ${JSON.stringify(value)}.`);
  }
  return value;
}

/** Validates `patch.sets` for confirm/confirm_plan_session — the per-exercise logged-set array confirmWorkoutSessionCore/confirmPlanSessionCore both take. */
function requireConfirmSets(patch: WritePatch): ConfirmSetInput[] {
  const value = patch.sets;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolInputError("patch.sets must be a non-empty array of { exerciseId, exerciseName, position, sets, reps, load }.");
  }
  return value.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ToolInputError(`patch.sets[${i}] must be an object.`);
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.exerciseId !== "string" || !r.exerciseId) throw new ToolInputError(`patch.sets[${i}].exerciseId is required.`);
    if (typeof r.exerciseName !== "string" || !r.exerciseName) throw new ToolInputError(`patch.sets[${i}].exerciseName is required.`);
    if (typeof r.position !== "number") throw new ToolInputError(`patch.sets[${i}].position must be a number.`);
    if (typeof r.sets !== "number") throw new ToolInputError(`patch.sets[${i}].sets must be a number.`);
    if (typeof r.reps !== "number") throw new ToolInputError(`patch.sets[${i}].reps must be a number.`);
    if (r.load !== null && typeof r.load !== "number") throw new ToolInputError(`patch.sets[${i}].load must be a number or null.`);
    return { exerciseId: r.exerciseId, exerciseName: r.exerciseName, position: r.position, sets: r.sets, reps: r.reps, load: (r.load as number | null) ?? null };
  });
}

/**
 * CANVAS-LITE-02's `patch.items` -- a discriminated union by `kind`,
 * hand-validated field-by-field like `requireGradeBoundariesOrUndefined`/
 * `requireConfirmSets` above (a caller-constructed array, not a single
 * scalar the existing require-helpers already cover).
 */
function requireCanvasImportItems(patch: WritePatch): CanvasImportItem[] {
  const raw = patch.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError(`patch.items is required and must be a non-empty array. Got: ${JSON.stringify(raw)}.`);
  }
  if (raw.length > CANVAS_IMPORT_MAX_ITEMS) {
    throw new ToolInputError(`patch.items must contain at most ${CANVAS_IMPORT_MAX_ITEMS} items. Got ${raw.length}.`);
  }
  return raw.map((raw_item, index) => {
    if (raw_item === null || typeof raw_item !== "object") {
      throw new ToolInputError(`patch.items[${index}] must be an object. Got: ${JSON.stringify(raw_item)}.`);
    }
    const obj = raw_item as Record<string, unknown>;
    const field = (name: string): string => {
      const v = obj[name];
      if (typeof v !== "string" || v.length === 0) throw new ToolInputError(`patch.items[${index}].${name} is required and must be a non-empty string. Got: ${JSON.stringify(v)}.`);
      return v;
    };
    const optionalNullableField = (name: string): string | null => {
      const v = obj[name];
      if (v === undefined || v === null) return null;
      if (typeof v !== "string") throw new ToolInputError(`patch.items[${index}].${name} must be a string or null. Got: ${JSON.stringify(v)}.`);
      return v;
    };
    const optionalNullableNum = (name: string): number | null => {
      const v = obj[name];
      if (v === undefined || v === null) return null;
      if (typeof v !== "number") throw new ToolInputError(`patch.items[${index}].${name} must be a number or null. Got: ${JSON.stringify(v)}.`);
      return v;
    };
    if (obj.kind === "course") {
      return { kind: "course", canvasCourseId: field("canvas_course_id"), canvasCourseName: field("canvas_course_name"), canvasCourseCode: optionalNullableField("canvas_course_code") };
    }
    if (obj.kind === "assessment") {
      const pointsEarned = obj.points_earned;
      if (typeof pointsEarned !== "number") throw new ToolInputError(`patch.items[${index}].points_earned is required and must be a number. Got: ${JSON.stringify(pointsEarned)}.`);
      return {
        kind: "assessment",
        canvasCourseId: field("canvas_course_id"),
        canvasAssignmentId: field("canvas_assignment_id"),
        name: field("name"),
        dueAt: optionalNullableField("due_at"),
        pointsPossible: optionalNullableNum("points_possible"),
        pointsEarned,
        // CANVAS-GAP-03: omitted -> null -> never auto-graded (see
        // CanvasImportAssessmentItem's own header) -- an absent grading
        // type is treated exactly like an unrecognized one, never assumed
        // to be "points".
        gradingType: optionalNullableField("grading_type"),
      };
    }
    if (obj.kind === "announcement") {
      return { kind: "announcement", canvasCourseId: field("canvas_course_id"), canvasAnnouncementId: field("canvas_announcement_id"), text: field("text") };
    }
    throw new ToolInputError(`patch.items[${index}].kind must be one of "course", "assessment", "announcement". Got: ${JSON.stringify(obj.kind)}.`);
  });
}

async function assertRowDomain(userClient: SupabaseClient, table: "tasks" | "schedule_events", id: string, userId: string, domain: "school" | "co_op"): Promise<void> {
  const { data, error } = await userClient.from(table).select("domain").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No ${table} row found with id "${id}" for this user.`);
  if (data.domain !== domain) {
    throw new Error(`id "${id}" belongs to domain "${data.domain ?? "none"}", not "${domain}" — refusing to write across the domain boundary.`);
  }
}

/**
 * P4-07: FK-violation (23503) -> ToolNotFoundError translation, done HERE
 * rather than inside `castHabitVoteCore`/`retractHabitVoteCore`/`addMilestone`
 * — unlike P4-06's deen cores (which this file's own author was actively
 * extracting), `lib/habits/actions-core.ts` is claimed by another agent
 * (Sonnet ENG 1, P2-11) mid-run and `lib/goals/actions-core.ts` predates
 * this task; translating at the handler boundary keeps every P4-07 change
 * inside this file (and the new lib/night-plan/*.ts files this task owns
 * outright) rather than editing either shared core file. Duplicated locally
 * rather than shared, same precedent as lib/promotions/actions-core.ts's
 * and lib/deen/actions-core.ts's own private `pgCode` helpers.
 */
const FK_VIOLATION = "23503";
function pgCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

const TASK_TYPES = ["homework_assignment", "reading_review", "quiz", "exam", "final_midterm", "project_paper", "reminder", "other"] as const;
const QUESTION_ORIGINS = ["self", "ai", "missed"] as const;
// Imported, never re-declared: a second copy of this vocabulary is exactly the
// drift migration 151 converged away. ASSESSMENT_TYPES lives in actions-core.
const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

export const WRITE_REGISTRY: Record<string, WriteDomainDef> = {
  deen: {
    domain: "deen",
    entities: {
      prayer: {
        entity: "prayer",
        actions: {
          log: {
            action: "log",
            description: "Set a prayer's status for a date (on_time/qada/missed). Strictly not-after-today, server-side.",
            patchShape: "{ date: string, prayer_name: PrayerName, status: 'on_time'|'qada'|'missed' }",
            idempotent: true,
            idempotencyVerification:
              "markPrayerCore upserts on (user_id,date,prayer_name) with status taken verbatim from the caller-supplied patch (date is REQUIRED at the handler level, but P4-03's write.ts:withDateDefault fills in the account's local today when the caller omits it -- deen.prayer.log is in DATE_DEFAULTS_TO_TODAY) -- a retry upserts the identical status. logged_at advances to the retry's own `now` each call, which is benign (a real, honest last-touched time, not a double-count) and never read as this entity's real-world state.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const prayerName = requirePrayerName(patch);
              const status = requireEnum(patch, "status", ["on_time", "qada", "missed"] as const);
              const result = await markPrayerCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, date, prayerName, status);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `logged ${prayerName} on ${date} as ${status}`,
              };
            },
          },
          // "unlog" -- R9, approved and now wired. Previously deliberately
          // absent (see docs/ai-connector/WRITE-DELETE-DECISION.md for the
          // full history of why status:'pending' is NOT a safe substitute
          // for a DELETE): a real 'unlogged' status value now exists,
          // taught to `effectivePrayerStatus`/`resolvePrayerStatuses`
          // (lib/deen/prayer-status.ts) to behave EXACTLY like an absent
          // row. The cookie-authed `unmarkPrayer` still DELETEs -- that
          // asymmetry is deliberate, not a leftover: see
          // unlogPrayerCore's own header (lib/deen/actions-core.ts) for
          // the actor-based reasoning.
          unlog: {
            action: "unlog",
            description: "Clear a prayer's logged status for a date, without deleting history -- it re-derives exactly as an absent row would (upcoming/pending/missed by the clock).",
            patchShape: "{ date: string, prayer_name: PrayerName }",
            idempotent: true,
            idempotencyVerification: "unlogPrayerCore upserts on (user_id,date,prayer_name) with status hardcoded to 'unlogged' -- a retry upserts the identical value. Same mechanism as prayer.log.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const prayerName = requirePrayerName(patch);
              const result = await unlogPrayerCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, date, prayerName);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `unlogged ${prayerName} on ${date}`,
              };
            },
          },
        },
      },
      sunnah_log: {
        entity: "sunnah_log",
        actions: {
          toggle: {
            action: "toggle",
            description: "Flip a rawatib slot's completion for a date. Strictly not-after-today, server-side.",
            patchShape: "{ date: string, prayer_name: PrayerName, slot: 'before'|'after'|'witr' }",
            // THE TOGGLE TRAP: toggleSunnahCore READS the existing `completed`
            // value and writes its NEGATION -- a set-a-value it is not. A
            // retry (crash-recovery, or the runner's own bounded retry after
            // a reported failure that actually succeeded) reads the row the
            // FIRST call already flipped and flips it AGAIN, landing back on
            // the original value -- the opposite of the intended change, not
            // a no-op.
            idempotent: false,
            idempotencyVerification: "toggleSunnahCore (lib/deen/actions-core.ts) reads `completed` then upserts `!existing?.completed` -- a second call inverts what the first call already set.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const prayerName = requirePrayerName(patch);
              const slot = requireEnum(patch, "slot", ["before", "after", "witr"] as const);
              const result = await toggleSunnahCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, date, prayerName, slot);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `toggled ${prayerName}/${slot} on ${date} to ${result.completed ? "completed" : "not completed"}`,
              };
            },
          },
        },
      },
      adhkar: {
        entity: "adhkar",
        actions: {
          toggle: {
            action: "toggle",
            description: "Flip morning/evening dhikr completion for a date. No future-date guard, matching the app's own behavior.",
            patchShape: "{ date: string, period: 'morning'|'evening' }",
            // Same toggle trap as deen.sunnah_log.toggle -- see its own comment.
            idempotent: false,
            idempotencyVerification: "toggleAdhkarCore (lib/deen/actions-core.ts) reads `completed` then upserts `!existing?.completed` -- a second call inverts what the first call already set.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const period = requireEnum(patch, "period", ["morning", "evening"] as const);
              const result = await toggleAdhkarCore(ctx.userClient, ctx.userId, date, period);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `toggled ${period} adhkar on ${date} to ${result.completed ? "completed" : "not completed"}`,
              };
            },
          },
        },
      },
      // ---------------------------------------------------------------
      // P4-06: quran_session, profile, reflection_entry, habit, habit_log,
      // weekly_focus, weekly_goal. Every core these call lives in
      // lib/deen/actions-core.ts, same "never call requireUser/getProfile,
      // timezone+now always explicit" rule as prayer/sunnah_log/adhkar
      // above. `date` fields on the log-style actions here default to
      // today (localDateString(ctx.now, ctx.timezone)) when the caller
      // omits them -- a deliberate P4-06 convenience the older
      // prayer/sunnah_log/adhkar actions don't have (they require an
      // explicit date); set_committed_date is the one exception (see its
      // own description) since defaulting it to today would silently do
      // something the caller almost certainly didn't intend.
      // ---------------------------------------------------------------
      quran_session: {
        entity: "quran_session",
        actions: {
          log: {
            action: "log",
            description: "Log Quran pages read for a date, optionally with surah/juz. Missing date defaults to today. Strictly not-after-today, server-side.",
            patchShape: "{ date?: string, pages: number, surah?: string, juz?: number }",
            idempotent: false,
            idempotencyVerification: "quranSessionLogCore does a plain INSERT -- a retry creates a second row for the same date, not an upsert.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const pages = requireNumber(patch, "pages");
              const surah = optionalString(patch, "surah");
              const juz = optionalNumber(patch, "juz");
              const result = await quranSessionLogCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, date, pages, surah, juz);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `logged ${pages} Quran page${pages === 1 ? "" : "s"} on ${date}`,
              };
            },
          },
        },
      },
      profile: {
        entity: "profile",
        actions: {
          adjust_qada: {
            action: "adjust_qada",
            description: "Adjust the qada (missed-prayer makeup) backlog count by a delta. Clamped at zero -- never negative.",
            patchShape: "{ delta: number }",
            idempotent: false,
            idempotencyVerification: "adjustQadaBacklogCore reads the CURRENT value and adds delta -- a retry applies the delta twice, not toward a fixed target.",
            handler: async (ctx, patch) => {
              const delta = requireNumber(patch, "delta");
              const result = await adjustQadaBacklogCore(ctx.userClient, ctx.userId, delta);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `adjusted qada backlog by ${delta} (now ${result.qadaOwed})`,
              };
            },
          },
          set_traveling_mode: {
            action: "set_traveling_mode",
            description: "Set traveling mode on/off. Only sets the flag -- never computes prayer-shortening itself (this app deliberately never automates fiqh).",
            patchShape: "{ enabled: boolean }",
            idempotent: true,
            idempotencyVerification: "setTravelingModeCore sets a fixed value taken verbatim from the patch -- a retry sets the identical value.",
            handler: async (ctx, patch) => {
              const enabled = requireBoolean(patch, "enabled");
              const result = await setTravelingModeCore(ctx.userClient, ctx.userId, enabled);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `set traveling mode to ${enabled}`,
              };
            },
          },
        },
      },
      reflection_entry: {
        entity: "reflection_entry",
        actions: {
          log: {
            action: "log",
            description: "Log one reflection-entry tally for a date and tier (1, 2, or 3). Missing date defaults to today. No text/note field -- a plain tally, by design (privacy).",
            patchShape: "{ date?: string, tier: 1 | 2 | 3 }",
            idempotent: false,
            idempotencyVerification: "reflectionEntryLogCore does a plain INSERT -- a retry creates a second tally row for the same date/tier.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const tier = requireNumberEnum(patch, "tier", [1, 2, 3] as const);
              const result = await reflectionEntryLogCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, date, tier);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `logged a tier-${tier} reflection entry on ${date}`,
              };
            },
          },
        },
      },
      habit: {
        entity: "habit",
        actions: {
          create: {
            action: "create",
            description: "Create a new Deen habit. committed_date is always today (server-computed) -- use habit.set_committed_date to correct it afterward.",
            patchShape: "{ name: string, anchor_cue?: string }",
            idempotent: false,
            idempotencyVerification: "createDeenHabitCore does a plain INSERT -- a retry creates a second habit with the same name, not an upsert (there is no natural conflict key for a habit's identity).",
            handler: async (ctx, patch) => {
              const name = requireString(patch, "name");
              const anchorCue = optionalString(patch, "anchor_cue");
              const result = await createDeenHabitCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, name, anchorCue);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { id: result.id, updated_at: ctx.now.toISOString() },
                },
                summary: `created deen habit "${name}"`,
              };
            },
          },
          update: {
            action: "update",
            description: 'Rename a habit and/or set its anchor cue (implementation-intention cue, e.g. "After Fajr"). Requires the top-level id.',
            patchShape: "{ name: string, anchor_cue: string | null }",
            idempotent: true,
            idempotencyVerification: "updateDeenHabitCore sets fixed values taken verbatim from the patch -- a retry sets the identical row state.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const name = requireString(patch, "name");
              const anchorCue = optionalNullableString(patch, "anchor_cue") ?? null;
              await updateDeenHabitCore(ctx.userClient, ctx.userId, id, name, anchorCue);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ id, name }) }],
                  structuredContent: { id, updated_at: ctx.now.toISOString(), name },
                },
                summary: `updated deen habit ${id}`,
              };
            },
          },
          archive: {
            action: "archive",
            description: "Soft-archive a habit (never a hard delete -- its log history survives an un-archive). Requires the top-level id.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "archiveDeenHabitCore sets archived=true, a fixed value -- a retry sets the identical value.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              await archiveDeenHabitCore(ctx.userClient, ctx.userId, id);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ id, archived: true }) }],
                  structuredContent: { id, updated_at: ctx.now.toISOString(), archived: true },
                },
                summary: `archived deen habit ${id}`,
              };
            },
          },
          set_stage_override: {
            action: "set_stage_override",
            description: "Override a habit's stage (active_build/stabilized/locked), or null to reset to automatic derivation from committed_date. Requires the top-level id.",
            patchShape: "{ stage: 'active_build' | 'stabilized' | 'locked' | null }",
            idempotent: true,
            idempotencyVerification: "setDeenHabitStageOverrideCore sets a fixed value taken verbatim from the patch -- a retry sets the identical value.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const stage = requireHabitStageOrNull(patch);
              await setDeenHabitStageOverrideCore(ctx.userClient, ctx.userId, id, stage);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ id, stage }) }],
                  structuredContent: { id, updated_at: ctx.now.toISOString(), stage },
                },
                summary: `set deen habit ${id} stage override to ${stage ?? "automatic"}`,
              };
            },
          },
          set_committed_date: {
            action: "set_committed_date",
            description: "Correct when a habit was actually started. REQUIRED, never defaulted to today -- this action's whole point is usually setting a date that ISN'T today. Strictly not-after-today, server-side. Requires the top-level id.",
            patchShape: "{ committed_date: string }",
            idempotent: true,
            idempotencyVerification: "setDeenHabitCommittedDateCore sets a fixed value taken verbatim from the patch -- a retry sets the identical value.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const committedDate = requireString(patch, "committed_date");
              await setDeenHabitCommittedDateCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, id, committedDate);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ id, committed_date: committedDate }) }],
                  structuredContent: { id, updated_at: ctx.now.toISOString(), committedDate },
                },
                summary: `set deen habit ${id} committed date to ${committedDate}`,
              };
            },
          },
        },
      },
      habit_log: {
        entity: "habit_log",
        actions: {
          toggle: {
            action: "toggle",
            description: "Flip a habit's completion for a date. Missing date defaults to today. Requires the top-level id (the habit).",
            patchShape: "{ date?: string }",
            // THE TOGGLE TRAP -- same shape as deen.sunnah_log.toggle/deen.adhkar.toggle.
            idempotent: false,
            idempotencyVerification: "toggleDeenHabitLogCore reads `completed` then upserts its negation -- a retry inverts what the first call already set.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const date = requireString(patch, "date");
              const result = await toggleDeenHabitLogCore(ctx.userClient, ctx.userId, id, date);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `toggled deen habit ${id} on ${date} to ${result.completed ? "completed" : "not completed"}`,
              };
            },
          },
          set_status: {
            action: "set_status",
            description: "Set (not toggle) a habit's completion for a date. Missing date defaults to today. Strictly not-after-today, server-side. Requires the top-level id (the habit).",
            patchShape: "{ date?: string, completed: boolean }",
            idempotent: true,
            idempotencyVerification: "setDeenHabitLogStatusCore upserts on (habit_id,date) with `completed` taken verbatim from the patch -- a retry upserts the identical value.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const date = requireString(patch, "date");
              const completed = requireBoolean(patch, "completed");
              await setDeenHabitLogStatusCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, id, date, completed);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ id, date, completed }) }],
                  structuredContent: { id, updated_at: ctx.now.toISOString(), date, completed },
                },
                summary: `set deen habit ${id} on ${date} to ${completed ? "completed" : "not completed"}`,
              };
            },
          },
        },
      },
      weekly_focus: {
        entity: "weekly_focus",
        actions: {
          set: {
            action: "set",
            description: "Set this week's focus habit. week_start_date is always server-computed from now/timezone, never caller-supplied. Requires the top-level id (the habit).",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "setWeeklyFocusCore upserts on (user_id,week_start_date) with habit_id taken verbatim from the top-level id -- a retry upserts the identical value.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              const result = await setWeeklyFocusCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, id);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ habitId: id, ...result }) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), habitId: id, ...result },
                },
                summary: `set weekly focus to habit ${id} for week of ${result.weekStartDate}`,
              };
            },
          },
        },
      },
      weekly_goal: {
        entity: "weekly_goal",
        actions: {
          save: {
            action: "save",
            description: "Save (upsert) this week's deen-domain goal. Plain upsert, no locking/carry-forward -- see saveDeenWeeklyGoalCore's own comment (mirrors business.weekly_goal.save exactly).",
            patchShape: "{ week_start_date: string, headline: string, milestones: string[], quran_page_target?: number }",
            idempotent: true,
            idempotencyVerification: "saveDeenWeeklyGoalCore upserts on (user_id,week_start_date,domain) with headline/milestones/quran_page_target taken verbatim from the patch -- a retry upserts the identical row.",
            handler: async (ctx, patch) => {
              const weekStartDate = requireString(patch, "week_start_date");
              const headline = requireString(patch, "headline");
              const milestonesRaw = patch.milestones;
              if (!Array.isArray(milestonesRaw) || !milestonesRaw.every((m) => typeof m === "string")) {
                throw new ToolInputError("patch.milestones must be an array of strings.");
              }
              const quranPageTarget = optionalNumber(patch, "quran_page_target") ?? null;
              await saveDeenWeeklyGoalCore(ctx.userClient, ctx.userId, weekStartDate, headline, milestonesRaw, quranPageTarget);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ week_start_date: weekStartDate, headline }) }],
                  structuredContent: { id: `${weekStartDate}:deen`, updated_at: null, week_start_date: weekStartDate, headline },
                },
                summary: `saved deen weekly goal for week of ${weekStartDate}`,
              };
            },
          },
        },
      },
    },
  },
  work: {
    domain: "work",
    entities: {
      target: {
        entity: "target",
        actions: {
          create: {
            action: "create",
            description: "Create a target (requires patch.deadline) or a stretch goal (never requires one), per patch.kind.",
            patchShape: "{ kind: 'target'|'stretch', title: string, deadline?: string }",
            idempotent: false,
            idempotencyVerification: "addTargetCore/addStretchGoalCore (lib/coop/targets-core.ts) plain INSERT with a freshly-computed position -- a retry creates a second, duplicate row (and at a different position, since the first insert already advanced the queue).",
            handler: async (ctx, patch) => {
              const kind = requireEnum(patch, "kind", ["target", "stretch"] as const);
              const title = requireString(patch, "title");
              const id =
                kind === "target"
                  ? await addTargetCore(ctx.userClient, ctx.userId, title, optionalString(patch, "deadline") ?? "")
                  : await addStretchGoalCore(ctx.userClient, ctx.userId, title);
              if (!id) throw new ToolInputError("Title was blank after trimming — nothing was created.");
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `created ${kind} "${title}"`,
              };
            },
          },
          edit: {
            action: "edit",
            description: "Edit an existing target/stretch goal's title and/or deadline. Requires the top-level id.",
            patchShape: "{ title?: string, deadline?: string|null }",
            idempotent: true,
            idempotencyVerification: "editTargetCore UPDATEs title/deadline to the exact given values (never reads-then-inverts, never derives from now) -- a retry writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await editTargetCore(ctx.userClient, ctx.userId, id, { title: optionalString(patch, "title"), deadline: optionalNullableString(patch, "deadline") });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited target ${id}`,
              };
            },
          },
          complete: {
            action: "complete",
            description: "Mark a target/stretch goal done. Requires the top-level id. Never a delete — the row's history is kept (ruling 5).",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification:
              "The complete_target RPC (migration 028) is explicitly idempotent by its own author's comment and guard: `select position ... if v_position is null then return; -- already completed ... idempotent no-op`. A retry after a successful complete finds position already NULL and no-ops before any UPDATE runs. completeTargetCore's own pre-RPC read of `vacatedPosition` also comes back NULL on a retry, so the 'what got promoted' lookup is skipped and it reports promotedTargetId:null -- a different RETURN VALUE than the original call, but the underlying DB state is unchanged either way.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              const promotion = await completeTargetCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, ...promotion }) }], structuredContent: { id, updated_at: null, ...promotion } },
                summary: `completed target ${id}${promotion.promotedTargetId ? `, promoted ${promotion.promotedTargetId}` : ""}`,
              };
            },
          },
          reorder: {
            action: "reorder",
            description: "Move a target/stretch goal to a new position — the 'in diff order optionally' mechanism. Requires the top-level id and patch.position.",
            patchShape: "{ position: number }",
            idempotent: true,
            idempotencyVerification:
              "The reorder_coop_target RPC (migration 028) is explicitly idempotent by its own author's comment and guard: `if p_new_position = v_old_position then return; -- no-op, idempotent`. A retry re-reads the NOW-current position (already equal to p_new_position from the first call) and no-ops before any shift UPDATE runs.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const position = optionalNumber(patch, "position");
              if (position === undefined) throw new ToolInputError("patch.position is required.");
              await moveTargetCore(ctx.userClient, ctx.userId, id, position);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, position }) }], structuredContent: { id, updated_at: null, position } },
                summary: `moved target ${id} to position ${position}`,
              };
            },
          },
          // "remove" deliberately absent -- delete_coop_target is a real
          // DELETE (guarded against a completed target, migration 032, but
          // not against an active one), and the MCP write path may never
          // hard-delete a row (L6's guardrail). Same posture as deen's
          // "unlog" -- an honest gap, not a workaround.
        },
      },
      task: {
        entity: "task",
        actions: {
          add: {
            action: "add",
            description: "Add a task to a target's backlog. Requires the top-level id (the target's id).",
            patchShape: "{ title: string, deadline?: string }",
            idempotent: false,
            idempotencyVerification: "addAgendaTaskCore (lib/coop/tasks-core.ts) plain INSERT, no natural-key conflict handling -- a retry creates a second, duplicate task.",
            handler: async (ctx, patch) => {
              const targetId = requireId(ctx);
              const title = requireString(patch, "title");
              const id = await addAgendaTaskCore(ctx.userClient, targetId, title, optionalString(patch, "deadline"));
              if (!id) throw new ToolInputError("Title was blank after trimming — nothing was created.");
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `added task "${title}" to target ${targetId}`,
              };
            },
          },
          edit: {
            action: "edit",
            description: "Edit an existing task's title and/or deadline. Requires the top-level id.",
            patchShape: "{ title?: string, deadline?: string|null }",
            idempotent: true,
            idempotencyVerification: "editTaskCore (lib/coop/tasks-core.ts) UPDATEs title/deadline to the exact given values -- a retry writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await editTaskCore(ctx.userClient, ctx.userId, id, { title: optionalString(patch, "title"), deadline: optionalNullableString(patch, "deadline") });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited task ${id}`,
              };
            },
          },
          // Idempotency verdicts differ PER ACTION, unlike the shared
          // handler shape below -- all four end up UPDATEing `coop_tasks`
          // via setStatusCore-shaped calls that set `completed_at`/
          // `blocked_since` to a FRESH `new Date()` whenever the target
          // status lands on "complete" (or, for block, unconditionally) --
          // Originally, advance/block/unblock were marked false: each
          // stamped a FRESH new Date() onto completed_at/blocked_since
          // whenever the transition landed on the risky state (complete /
          // blocked), with no check of whether the row was already there --
          // the exact "derives now on every call" trap the lead named
          // checkins.allocation.save's window-resolution bug as the
          // template for. FIXED (see lib/coop/tasks-core.ts's own inline
          // comments on setStatusCore/blockTaskCore/unblockTaskCore): each
          // now reads the row's current state FIRST and only stamps a fresh
          // timestamp when genuinely transitioning into that state; a call
          // that finds the row already there (a retry) preserves the
          // existing value byte-for-byte. Proved red-then-green with a
          // stateful fake (seed a row, call twice with real time between
          // the calls, assert the timestamp is identical) --
          // lib/coop/__tests__/tasks-core.test.ts's "idempotency --
          // retrying block/advance/unblock..." describe block. `retreat`
          // needed no change: previousStage() can never land on 'complete'
          // at all, so it was already stable.
          ...(["advance", "retreat", "block", "unblock"] as const).reduce(
            (acc, action) => {
              const idempotencyByAction: Record<"advance" | "retreat" | "block" | "unblock", Pick<WriteActionDef, "idempotent" | "idempotencyVerification">> = {
                advance: {
                  idempotent: true,
                  idempotencyVerification:
                    "advanceTaskCore -> setStatusCore (lib/coop/tasks-core.ts) reads the row's current status/completed_at BEFORE writing. When the computed next stage is 'complete', it only stamps a FRESH new Date() if the row isn't already 'complete'; a retry that finds it already there preserves the existing completed_at unchanged. Every other target sets completed_at to null. Red-then-green proved with a stateful fake calling twice with real time between the calls (lib/coop/__tests__/tasks-core.test.ts).",
                },
                retreat: {
                  idempotent: true,
                  idempotencyVerification:
                    "retreatTaskCore -> setStatusCore (lib/coop/tasks-core.ts) can never land on 'complete' -- previousStage() only ever moves BACKWARD through PIPELINE_STAGES (lib/coop/tasks.ts), and 'complete' is the last stage, never a retreat target. completed_at is therefore always set to null on every call, a stable value -- no hidden time dependency, unlike its siblings (needed no fix).",
                },
                block: {
                  idempotent: true,
                  idempotencyVerification:
                    "blockTaskCore (lib/coop/tasks-core.ts) reads the row's current status/blocked_since BEFORE writing. It only stamps a FRESH new Date() onto blocked_since when the row isn't already 'blocked'; a retry against an already-blocked row preserves the original blocked_since unchanged. Red-then-green proved with a stateful fake calling twice with real time between the calls (lib/coop/__tests__/tasks-core.test.ts).",
                },
                unblock: {
                  idempotent: true,
                  idempotencyVerification:
                    "unblockTaskCore (lib/coop/tasks-core.ts) reads the row's current status/completed_at BEFORE writing. When restoring to 'complete', it only stamps a FRESH new Date() if the row isn't already 'complete'; a retry that finds it already restored preserves the existing completed_at unchanged. Every other restore target sets completed_at to null. Red-then-green proved with a stateful fake calling twice with real time between the calls (lib/coop/__tests__/tasks-core.test.ts).",
                },
              };
              acc[action] = {
                action,
                description: `${action[0].toUpperCase()}${action.slice(1)} a task one pipeline stage. Requires the top-level id and patch.current_status${action === "unblock" ? " (the status to restore)" : ""}.`,
                patchShape: "{ current_status: 'backlog'|'in_progress'|'review'|'complete'|'blocked' }",
                ...idempotencyByAction[action],
                handler: async (ctx: WriteContext, patch: WritePatch) => {
                  const id = requireId(ctx);
                  const currentStatus = requireEnum(patch, "current_status", ["backlog", "in_progress", "review", "blocked", "complete"] as const) as Exclude<
                    CoopTaskStatus,
                    "blocked"
                  >;
                  const coreFn = { advance: advanceTaskCore, retreat: retreatTaskCore, block: blockTaskCore, unblock: unblockTaskCore }[action];
                  await coreFn(ctx.userClient, ctx.userId, id, currentStatus);
                  return {
                    result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                    summary: `${action}d task ${id}`,
                  };
                },
              };
              return acc;
            },
            {} as Record<string, WriteActionDef>,
          ),
          // "remove"/"bulk_remove" deliberately absent -- both are real
          // DELETEs with no completion-history guard at all (ruling 5 is
          // about targets, not tasks). Same posture as everywhere else in
          // this registry: the MCP write path never hard-deletes.
        },
      },
      work_session: {
        entity: "work_session",
        actions: {
          start: {
            action: "start",
            description:
              "Start a deep-work/deep-study session. Fails if one is already active for this user (application-level invariant, not a DB constraint). Requires `deliverable`: a non-empty string naming what this session will produce -- #37 (2026-09-14), every Lock-In session must name a deliverable before it can start, and this tool is not exempt just because it has no setup-dialog UI to type one into.",
            patchShape: "{ kind: 'deep_work'|'deep_study', deliverable: string }",
            // BORDERLINE, marked true on the strength of a GUARD, not a
            // no-op upsert -- worth naming the mechanism precisely rather
            // than rounding to "looks safe." startWorkSessionCore always
            // INSERTs a new row (no natural-key conflict handling at all),
            // which would normally mean "false, appends a duplicate." But
            // it read-checks "is a session already active" FIRST and THROWS
            // rather than inserting if one is -- so a retry after a
            // successful first call (which left a session active) hits that
            // guard and is REJECTED, not silently duplicated. The DB STATE
            // never corrupts on a retry, which is the bar that matters; the
            // retry's own call is reported as an error (not a no-op), which
            // will cost it retry budget/eventually pause the schedule even
            // though nothing is actually wrong -- a real, if survivable,
            // cost of this specific shape of safety.
            idempotent: true,
            idempotencyVerification:
              "startWorkSessionCore (lib/business/actions-core.ts) plain-INSERTs, but reads `.is('ended_at', null)` FIRST and throws 'A work session is already active' if one exists -- a retry after a successful start hits this guard and is rejected rather than creating a second active session. State-safe, though the retry itself surfaces as an error, not a silent no-op.",
            handler: async (ctx, patch) => {
              const kind = requireEnum(patch, "kind", ["deep_work", "deep_study"] as const);
              // #37 (Opus Lead ruling, 2026-09-14): startWorkSessionCore now
              // REJECTS every caller with no objective naming a real
              // deliverable, including this tool -- which previously called
              // it with `{ kind }` alone and no objectives concept at all
              // (the comment this replaced said so explicitly). This tool
              // still has no kill-list/task selection UI the way the setup
              // dialog does, so a typed `deliverable` is the only kind of
              // objective available to it: mapped to a single `custom`
              // objective, same shape the dialog's own free-text field
              // produces. Validated here (not left to startWorkSessionCore's
              // own generic "at least one objective" message) so a caller
              // that omits it gets an error naming the exact missing field.
              const deliverableRaw = requireString(patch, "deliverable");
              const deliverable = deliverableRaw.trim();
              if (deliverable.length === 0) {
                throw new ToolInputError("patch.deliverable is required and must be a non-empty string.");
              }
              const started = await startWorkSessionCore(ctx.userClient, ctx.userId, {
                kind,
                objectives: [{ kind: "custom", customText: deliverable }],
              });
              return {
                result: { content: [{ type: "text", text: JSON.stringify(started) }], structuredContent: { id: started.id, updated_at: null, started_at: started.startedAt } },
                summary: `started a ${kind} session to ${deliverable}`,
              };
            },
          },
          end: {
            action: "end",
            description: "End an active session, stamping ended_at. Requires the top-level id.",
            patchShape: "{}",
            // FIXED (originally a NEW FINDING from this audit, the same
            // shape as checkins.allocation.save's window-resolution bug):
            // this handler still never passes `endedAtIso`, so
            // endWorkSessionCore falls back to `new Date()` -- but
            // endWorkSessionCore itself now guards: its existence check
            // reads `ended_at` too, and if the session is already ended it
            // returns without writing (a retry is a no-op, not a silent
            // overwrite). The UPDATE also carries its own `.is("ended_at",
            // null)` filter, closing the read-then-write race a plain
            // existence check would leave open between two truly concurrent
            // retries. Proved red-then-green with a stateful fake (seed a
            // row, call twice with real time between the calls, assert
            // ended_at is identical) -- lib/business/__tests__/actions-core.test.ts.
            idempotent: true,
            idempotencyVerification:
              "endWorkSessionCore (lib/business/actions-core.ts) now selects `ended_at` alongside `id` and returns early (no-op) if the session is already ended, instead of always re-stamping via new Date(). The UPDATE itself also filters on `.is('ended_at', null)`, so even a genuine race between two concurrent retries can produce at most one write. Red-then-green proved with a stateful fake calling twice with real time between the calls.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              await endWorkSessionCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: ctx.now.toISOString() } },
                summary: `ended work session ${id}`,
              };
            },
          },
        },
      },
    },
  },
  business: {
    domain: "business",
    entities: {
      kill_list_item: {
        entity: "kill_list_item",
        actions: {
          set: {
            action: "set",
            description: "Set (create or overwrite) one of a day's 3 kill-list slots. position is the EXPLICIT slot (0/1/2), not an implicit append order.",
            patchShape: "{ date: string, position: 0|1|2, text: string }",
            idempotent: true,
            idempotencyVerification: "setKillListItemCore upserts on (user_id,date,position) with text taken verbatim from the patch -- a retry upserts the identical row.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const position = requireNumberEnum(patch, "position", [0, 1, 2] as const);
              const text = requireString(patch, "text");
              await setKillListItemCore(ctx.userClient, ctx.userId, date, position, text);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ date, position, text }) }], structuredContent: { id: `${date}:${position}`, updated_at: null, date, position, text } },
                summary: `set kill-list slot ${position} on ${date}`,
              };
            },
          },
          toggle: {
            action: "toggle",
            description: "Toggle a kill-list item's completion. Requires the top-level id.",
            patchShape: "{}",
            // Same toggle trap as deen.sunnah_log.toggle, COMPOUNDED by the
            // same fresh-now() drift as work.task.block: toggleKillListItemCore
            // both reads-then-inverts `completed` AND sets `completed_at` to
            // a new Date() whenever the toggle lands on true. Two independent
            // reasons a retry corrupts state, not just one.
            idempotent: false,
            idempotencyVerification: "toggleKillListItemCore (lib/business/actions-core.ts) reads `completed` then writes `!existing.completed` plus a fresh completed_at when landing on true -- a retry inverts what the first call already set.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              const result = await toggleKillListItemCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, ...result }) }], structuredContent: { id, updated_at: null, ...result } },
                summary: `toggled kill-list item ${id} to ${result.completed ? "completed" : "not completed"}`,
              };
            },
          },
        },
      },
      weekly_goal: {
        entity: "weekly_goal",
        actions: {
          save: {
            action: "save",
            description: "Save (upsert) this week's business-domain goal. Plain upsert, no locking/carry-forward — see saveBusinessWeeklyGoalCore's own comment.",
            patchShape: "{ week_start_date: string, headline: string, milestones: string[] }",
            idempotent: true,
            idempotencyVerification: "saveBusinessWeeklyGoalCore upserts on (user_id,week_start_date,domain) with headline/milestones taken verbatim from the patch -- a retry upserts the identical row.",
            handler: async (ctx, patch) => {
              const weekStartDate = requireString(patch, "week_start_date");
              const headline = requireString(patch, "headline");
              const milestonesRaw = patch.milestones;
              if (!Array.isArray(milestonesRaw) || !milestonesRaw.every((m) => typeof m === "string")) {
                throw new ToolInputError("patch.milestones must be an array of strings.");
              }
              await saveBusinessWeeklyGoalCore(ctx.userClient, ctx.userId, weekStartDate, headline, milestonesRaw);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ week_start_date: weekStartDate, headline }) }],
                  structuredContent: { id: `${weekStartDate}:business`, updated_at: null, week_start_date: weekStartDate, headline },
                },
                summary: `saved business weekly goal for week of ${weekStartDate}`,
              };
            },
          },
        },
      },
    },
  },
  school: {
    domain: "school",
    entities: {
      task: {
        entity: "task",
        actions: {
          add: {
            action: "add",
            description: "Add a school task/assignment/reminder. Always domain='school'.",
            patchShape: "{ title: string, due_date?: string, due_time?: string, task_type?: TaskType, task_type_other_label?: string, class_id?: string|null }",
            idempotent: false,
            idempotencyVerification: "addTaskCore (lib/tasks/actions-core.ts) plain INSERT, no natural-key conflict handling -- a retry creates a second, duplicate task.",
            handler: async (ctx, patch) => {
              const title = requireString(patch, "title");
              const dueDate = optionalString(patch, "due_date");
              const dueTime = optionalString(patch, "due_time");
              const taskType = patch.task_type === undefined ? undefined : requireEnum(patch, "task_type", TASK_TYPES);
              const taskTypeOtherLabel = optionalString(patch, "task_type_other_label");
              const classId = optionalNullableString(patch, "class_id");
              const id = await addTaskCore(ctx.userClient, ctx.userId, {
                domain: "school",
                title,
                dueDate,
                dueTime,
                taskType,
                taskTypeOtherLabel,
                classId,
              });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `added school task "${title}"`,
              };
            },
          },
          edit: {
            action: "edit",
            description:
              "MERGE-semantics edit of a school task's contents (lead DECISION, P4-08, recorded in .brain/memory/decisions.md) -- a field OMITTED from the patch keeps its current value; the UI's own edit form stays full-replace (unchanged, still calls updateTaskCore directly with every field). This handler alone reads the existing row first, then applies only the fields the caller actually sent, before calling the SAME updateTaskCore (unchanged) with the fully-resolved values. Requires the top-level id. due_date/task_type_other_label accept an explicit `null` to clear them (omit to leave alone) -- the one capability MERGE semantics would otherwise remove versus the old full-replace form, where simply omitting a field cleared it.",
            patchShape: "{ title?: string, due_date?: string|null, task_type?: TaskType, task_type_other_label?: string|null, class_id?: string|null }",
            idempotent: true,
            idempotencyVerification:
              "Reads the existing row, merges the patch over it, then calls updateTaskCore (lib/tasks/actions-core.ts) with the fully-resolved values -- a retry with the identical patch re-reads the (by-then-updated) row and re-merges to the SAME final state, so it's idempotent as long as nothing else changed the row between calls (the general assumption every idempotent write action in this file makes).",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await assertRowDomain(ctx.userClient, "tasks", id, ctx.userId, "school");
              const { data: existing, error: readErr } = await ctx.userClient
                .from("tasks")
                .select("title, due_date, task_type, task_type_other_label, class_id")
                .eq("id", id)
                .eq("user_id", ctx.userId)
                .maybeSingle();
              if (readErr) throw readErr;
              if (!existing) throw new ToolNotFoundError(`No school task found with id "${id}".`);

              const title = patch.title === undefined ? existing.title : requireString(patch, "title");
              const dueDate = patch.due_date === undefined ? existing.due_date ?? undefined : optionalNullableString(patch, "due_date") ?? undefined;
              const taskType =
                patch.task_type === undefined
                  ? (existing.task_type as (typeof TASK_TYPES)[number] | null) ?? undefined
                  : patch.task_type === null
                    ? undefined
                    : requireEnum(patch, "task_type", TASK_TYPES);
              const taskTypeOtherLabel =
                patch.task_type_other_label === undefined ? existing.task_type_other_label ?? undefined : optionalNullableString(patch, "task_type_other_label") ?? undefined;
              const classId = patch.class_id === undefined ? existing.class_id : optionalNullableString(patch, "class_id");

              await updateTaskCore(ctx.userClient, ctx.userId, id, { title, dueDate, taskType, taskTypeOtherLabel, classId });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `merge-edited school task ${id}`,
              };
            },
          },
          toggle: {
            action: "toggle",
            description: "Flip a school task's completed state. Requires the top-level id.",
            patchShape: "{}",
            // Same toggle trap as deen.sunnah_log.toggle.
            idempotent: false,
            idempotencyVerification: "toggleTaskCore (lib/tasks/actions-core.ts) reads `completed` then writes `!existing.completed` -- a retry inverts what the first call already set.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              await assertRowDomain(ctx.userClient, "tasks", id, ctx.userId, "school");
              const result = await toggleTaskCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, ...result }) }], structuredContent: { id, updated_at: null, ...result } },
                summary: `toggled school task ${id} to ${result.completed ? "completed" : "not completed"}`,
              };
            },
          },
          // "remove" deliberately absent -- removeTaskCore (lib/tasks/
          // actions-core.ts) is a real DELETE; the MCP write path never
          // hard-deletes. Same posture as every other domain.
        },
      },
      class: {
        entity: "class",
        actions: {
          create: {
            action: "create",
            description:
              "Create a class. term/late_policy/attendance_policy/allowed_absences/grade_boundaries (migration 152) are all optional and settable at creation time as of P4-08 -- previously only reachable via a follow-up class.edit call; the app's own createClass wrapper still only exposes code/short_name/room/instructor, so an agent creating a class with a full policy set in one call is doing something the UI itself cannot do in one step.",
            patchShape:
              "{ code: string, short_name?: string, room?: string, instructor?: string, term?: string|null, late_policy?: string|null, attendance_policy?: string|null, allowed_absences?: number|null, grade_boundaries?: {letter:string,minPct:number}[]|null }",
            idempotent: false,
            idempotencyVerification: "createClassCore (lib/school/actions-core.ts) plain INSERT with a freshly-computed position (max+1) -- a retry creates a second, duplicate class, at a different position since the first insert already advanced the max.",
            handler: async (ctx, patch) => {
              const code = requireString(patch, "code");
              const shortName = optionalString(patch, "short_name");
              const room = optionalString(patch, "room");
              const instructor = optionalString(patch, "instructor");
              const term = optionalNullableString(patch, "term");
              const latePolicy = optionalNullableString(patch, "late_policy");
              const attendancePolicy = optionalNullableString(patch, "attendance_policy");
              const allowedAbsences = optionalNullableNumber(patch, "allowed_absences");
              const gradeBoundaries = requireGradeBoundariesOrUndefined(patch, "grade_boundaries");
              const id = await createClassCore(ctx.userClient, ctx.userId, {
                code,
                shortName,
                room,
                instructor,
                term,
                latePolicy,
                attendancePolicy,
                allowedAbsences,
                gradeBoundaries,
              });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `created class "${code}"`,
              };
            },
          },
          edit: {
            action: "edit",
            description:
              "Edit a class's short_name/room/instructor/term/late_policy/attendance_policy/allowed_absences/grade_boundaries (migration 152). Requires the top-level id. Widened in P4-08 (WIRING only -- updateClassCore already accepted every one of these fields).",
            patchShape:
              "{ short_name?: string|null, room?: string|null, instructor?: string|null, term?: string|null, late_policy?: string|null, attendance_policy?: string|null, allowed_absences?: number|null, grade_boundaries?: {letter:string,minPct:number}[]|null }",
            idempotent: true,
            idempotencyVerification: "updateClassCore (lib/school/actions-core.ts) UPDATEs to the exact given values -- a retry writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await updateClassCore(ctx.userClient, ctx.userId, id, {
                shortName: optionalNullableString(patch, "short_name"),
                room: optionalNullableString(patch, "room"),
                instructor: optionalNullableString(patch, "instructor"),
                term: optionalNullableString(patch, "term"),
                latePolicy: optionalNullableString(patch, "late_policy"),
                attendancePolicy: optionalNullableString(patch, "attendance_policy"),
                allowedAbsences: optionalNullableNumber(patch, "allowed_absences"),
                gradeBoundaries: requireGradeBoundariesOrUndefined(patch, "grade_boundaries"),
              });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited class ${id}`,
              };
            },
          },
          // Syllabus upload/remove, and "remove" (no such function exists
          // at all in class-actions.ts) deliberately absent -- see
          // docs/ai-connector/SCHOOL-WRITE-SCOPE-DECISIONS.md.
        },
      },
      class_assessment: {
        entity: "class_assessment",
        actions: {
          add: {
            action: "add",
            description: "Add an assessment to a class. Also creates its linked task (ruling R5). Requires the top-level id (the class's id).",
            patchShape: "{ name: string, type: 'quiz'|'exam'|'final_midterm'|'homework_assignment'|'project_paper', date: string }",
            idempotent: false,
            idempotencyVerification: "addClassAssessmentCore (lib/school/actions-core.ts) plain-INSERTs a task AND a class_assessments row, no conflict handling on either -- a retry creates a second, duplicate task+assessment pair.",
            handler: async (ctx, patch) => {
              const classId = requireId(ctx);
              const name = requireString(patch, "name");
              const type = requireEnum(patch, "type", ASSESSMENT_TYPES);
              const date = requireString(patch, "date");
              const { assessmentId, taskId } = await addClassAssessmentCore(ctx.userClient, ctx.userId, classId, name, type, date);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id: assessmentId, taskId }) }], structuredContent: { id: assessmentId, updated_at: null, taskId } },
                summary: `added assessment "${name}" to class ${classId}`,
              };
            },
          },
          edit: {
            action: "edit",
            description:
              "Edit an assessment's name/type/date/weight/category/grade, syncing its linked task's title/due_date. Requires the top-level id. category_id widened in P4-08 (WIRING only -- updateClassAssessmentCore already accepted it) -- pass a grade_categories id to categorize, or null to un-categorize; omit to leave the current category untouched. points_earned (P2-21): providing it always clears any Canvas grade-sync marker on this assessment, so a manual correction here is never silently overwritten by the next Canvas sync.",
            patchShape:
              "{ name: string, type: 'quiz'|'exam'|'final_midterm'|'homework_assignment'|'project_paper', date: string, weight_pct?: number|null, category_id?: string|null, points_earned?: number|null }",
            idempotent: true,
            idempotencyVerification: "updateClassAssessmentCore (lib/school/actions-core.ts) UPDATEs the assessment and its linked task to the exact given values -- a retry writes the identical rows.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const name = requireString(patch, "name");
              const type = requireEnum(patch, "type", ASSESSMENT_TYPES);
              const date = requireString(patch, "date");
              const weightPct = optionalNullableNumber(patch, "weight_pct");
              const categoryId = optionalNullableString(patch, "category_id");
              const pointsEarned = optionalNullableNumber(patch, "points_earned");
              try {
                await updateClassAssessmentCore(ctx.userClient, ctx.userId, id, { name, type, date, weightPct, categoryId, pointsEarned });
              } catch (err) {
                if (pgCode(err) === FK_VIOLATION) throw new ToolNotFoundError(`No grade category found with id "${categoryId}".`);
                throw err;
              }
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited assessment ${id}`,
              };
            },
          },
          // "remove" deliberately absent -- delete_class_assessment
          // (migration 048) is a real DELETE; the MCP write path never
          // hard-deletes.
        },
      },
      question: {
        entity: "question",
        actions: {
          create: {
            action: "create",
            description:
              "Add a question to a class's question bank (Phase 1 #22's manual-entry path). Every question needs either a source anchor (a page/timestamp/citation) or an explicit skip -- questions_anchor_present_or_skipped, enforced here AND by the database's own CHECK. Requires the top-level id (the class's id), same convention as class_assessment.add.",
            patchShape: "{ prompt: string, answer: string, topic?: string|null, source_anchor?: string|null, source_skipped?: boolean, origin?: 'self'|'ai'|'missed' }",
            idempotent: false,
            idempotencyVerification: "createQuestionCore (lib/school/questions-core.ts) plain INSERT, no conflict handling -- a retry creates a second, duplicate question.",
            handler: async (ctx, patch) => {
              const classId = requireId(ctx);
              const prompt = requireString(patch, "prompt");
              const answer = requireString(patch, "answer");
              const topic = optionalNullableString(patch, "topic");
              const sourceAnchor = optionalNullableString(patch, "source_anchor");
              const sourceSkipped = patch.source_skipped === undefined ? undefined : requireBoolean(patch, "source_skipped");
              const origin = patch.origin === undefined ? undefined : requireEnum(patch, "origin", QUESTION_ORIGINS);
              let result;
              try {
                result = await createQuestionCore(ctx.userClient, ctx.userId, { classId, prompt, answer, topic, sourceAnchor, sourceSkipped, origin });
              } catch (err) {
                if (pgCode(err) === FK_VIOLATION) throw new ToolNotFoundError(`No class found with id "${classId}".`);
                if (err instanceof Error && pgCode(err) === null) throw new ToolInputError(err.message);
                throw err;
              }
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id: result.id }) }], structuredContent: { id: result.id, updated_at: null } },
                summary: `added a question to class ${classId}`,
              };
            },
          },
          update: {
            action: "update",
            description: "MERGE-semantics edit of a question's contents -- a field omitted from the patch keeps its current value (updateQuestionCore's own established field-by-field convention, not new to P4-08). Requires the top-level id.",
            patchShape: "{ prompt?: string, answer?: string, topic?: string|null, source_anchor?: string|null, source_skipped?: boolean }",
            idempotent: true,
            idempotencyVerification: "updateQuestionCore (lib/school/questions-core.ts) UPDATEs only the fields present in the patch to the exact given values -- a retry with the identical patch writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const { data: existing, error: readErr } = await ctx.userClient.from("questions").select("id").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
              if (readErr) throw readErr;
              if (!existing) throw new ToolNotFoundError(`No question found with id "${id}".`);

              const prompt = optionalString(patch, "prompt");
              const answer = optionalString(patch, "answer");
              const topic = optionalNullableString(patch, "topic");
              const sourceAnchor = optionalNullableString(patch, "source_anchor");
              const sourceSkipped = patch.source_skipped === undefined ? undefined : requireBoolean(patch, "source_skipped");
              try {
                await updateQuestionCore(ctx.userClient, ctx.userId, id, { prompt, answer, topic, sourceAnchor, sourceSkipped });
              } catch (err) {
                if (err instanceof Error && pgCode(err) === null) throw new ToolInputError(err.message);
                throw err;
              }
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited question ${id}`,
              };
            },
          },
          set_active: {
            action: "set_active",
            description:
              "Retire (active:false) or restore (active:true) a question -- the ONLY removal action for a question, by design (questions-core.ts's own header: reviews reference questions, so there is no hard delete). Reversible either direction. Requires the top-level id.",
            patchShape: "{ active: boolean }",
            idempotent: true,
            idempotencyVerification: "setQuestionActiveCore (lib/school/questions-core.ts) sets `active` to the exact given value -- a retry writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const active = requireBoolean(patch, "active");
              const { data: existing, error: readErr } = await ctx.userClient.from("questions").select("id").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
              if (readErr) throw readErr;
              if (!existing) throw new ToolNotFoundError(`No question found with id "${id}".`);
              await setQuestionActiveCore(ctx.userClient, ctx.userId, id, active);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, active }) }], structuredContent: { id, updated_at: null, active } },
                summary: `set question ${id} active to ${active}`,
              };
            },
          },
        },
      },
      grade_category: {
        entity: "grade_category",
        actions: {
          create: {
            action: "create",
            description: "Add a weight category to a class (migration 152's real weight-category model). Requires the top-level id (the class's id), same convention as class_assessment.add.",
            patchShape: "{ name: string, weight_pct: number, drop_lowest_n?: number, expected_item_count?: number }",
            idempotent: false,
            idempotencyVerification: "createGradeCategoryCore (lib/school/actions-core.ts) plain INSERT, no conflict handling -- a retry creates a second, duplicate category.",
            handler: async (ctx, patch) => {
              const classId = requireId(ctx);
              const name = requireString(patch, "name");
              const weightPct = requireNumber(patch, "weight_pct");
              const dropLowestN = optionalNumber(patch, "drop_lowest_n");
              const expectedItemCount = optionalNumber(patch, "expected_item_count");
              let id: string;
              try {
                id = await createGradeCategoryCore(ctx.userClient, ctx.userId, classId, { name, weightPct, dropLowestN, expectedItemCount });
              } catch (err) {
                if (pgCode(err) === FK_VIOLATION) throw new ToolNotFoundError(`No class found with id "${classId}".`);
                throw err;
              }
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `added grade category "${name}" to class ${classId}`,
              };
            },
          },
          update: {
            action: "update",
            description: "Full-replace edit of a grade category's name/weight/drop_lowest_n/expected_item_count. Requires the top-level id.",
            patchShape: "{ name: string, weight_pct: number, drop_lowest_n?: number, expected_item_count?: number }",
            idempotent: true,
            idempotencyVerification: "updateGradeCategoryCore (lib/school/actions-core.ts) UPDATEs to the exact given values -- a retry writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const { data: existing, error: readErr } = await ctx.userClient.from("grade_categories").select("id").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
              if (readErr) throw readErr;
              if (!existing) throw new ToolNotFoundError(`No grade category found with id "${id}".`);
              const name = requireString(patch, "name");
              const weightPct = requireNumber(patch, "weight_pct");
              const dropLowestN = optionalNumber(patch, "drop_lowest_n");
              const expectedItemCount = optionalNumber(patch, "expected_item_count");
              await updateGradeCategoryCore(ctx.userClient, ctx.userId, id, { name, weightPct, dropLowestN, expectedItemCount });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited grade category ${id}`,
              };
            },
          },
        },
      },
      staging: {
        entity: "staging",
        actions: {
          confirm_batch: {
            action: "confirm_batch",
            description:
              "Confirm a staging batch (Phase 1 #18): commits every resolvable staged deliverable into a real class_assessments row (reusing addClassAssessmentCore -- 'we have all the information we need'), skipping any row still missing a date (#17's no-guessing rule) rather than erroring the whole batch. Requires the top-level id (the batch's id).",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "confirmStagingBatchCore (lib/school/staging-core.ts) is explicitly resumable by its own header -- claim_staging_batch lets a retry proceed against an already-confirming batch, and its per-row stamp is a conditional UPDATE guarded on committed_assessment_id IS NULL, so a retry (or a genuine concurrent double-call) never double-commits a row.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              const result = await confirmStagingBatchCore(ctx.userClient, ctx.userId, id);
              if (result.status === null) throw new ToolNotFoundError(`No staging batch found with id "${id}".`);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, ...result }) }], structuredContent: { id, updated_at: null, ...result } },
                summary: `confirmed staging batch ${id}: ${result.committedCount} committed, ${result.remaining.length} remaining (status: ${result.status})`,
              };
            },
          },
          update_deliverable: {
            action: "update_deliverable",
            description:
              "Correct a staged item before confirm (a low-confidence type, or a null/wrong date -- #17's no-guessing rule). PRE-CONFIRM ONLY: refuses to touch a row that already has a committed_assessment_id, same restriction as delete_deliverable. Requires the top-level id.",
            patchShape: "{ name: string, type: 'quiz'|'exam'|'final_midterm'|'homework_assignment'|'project_paper', date: string|null }",
            idempotent: true,
            idempotencyVerification: "updateStagedDeliverableCore (lib/school/staging-core.ts) UPDATEs to the exact given values, scoped to committed_assessment_id IS NULL -- a retry (still pre-confirm) writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const { data: existing, error: readErr } = await ctx.userClient
                .from("staged_deliverables")
                .select("id, committed_assessment_id")
                .eq("id", id)
                .eq("user_id", ctx.userId)
                .maybeSingle();
              if (readErr) throw readErr;
              if (!existing) throw new ToolNotFoundError(`No staged deliverable found with id "${id}".`);
              if (existing.committed_assessment_id) throw new ToolInputError(`Staged deliverable "${id}" is already confirmed and can no longer be edited.`);
              const name = requireString(patch, "name");
              const type = requireEnum(patch, "type", ASSESSMENT_TYPES);
              const dateRaw = patch.date;
              if (dateRaw !== null && typeof dateRaw !== "string") {
                throw new ToolInputError(`patch.date is required and must be a string or null. Got: ${JSON.stringify(dateRaw)}.`);
              }
              await updateStagedDeliverableCore(ctx.userClient, ctx.userId, id, { name, type, date: dateRaw });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited staged deliverable ${id}`,
              };
            },
          },
          delete_deliverable: {
            action: "delete_deliverable",
            description:
              "Reject a staged item before confirm -- a real DELETE, deliberately in scope (staging-core.ts's own convention: a row that survives to confirm time IS the accepted set, there is no separate reject-vs-delete state). PRE-CONFIRM ONLY: scoped to committed_assessment_id IS NULL, structurally incapable of deleting a real committed assessment. Requires the top-level id.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "deleteStagedDeliverableCore (lib/school/staging-core.ts) DELETEs scoped to committed_assessment_id IS NULL -- a retry after the first delete already removed the row matches 0 rows, a no-op, not an error.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              const { data: existing, error: readErr } = await ctx.userClient
                .from("staged_deliverables")
                .select("id, committed_assessment_id")
                .eq("id", id)
                .eq("user_id", ctx.userId)
                .maybeSingle();
              if (readErr) throw readErr;
              if (!existing) throw new ToolNotFoundError(`No staged deliverable found with id "${id}".`);
              if (existing.committed_assessment_id) throw new ToolInputError(`Staged deliverable "${id}" is already confirmed and can no longer be deleted.`);
              await deleteStagedDeliverableCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, deleted: true }) }], structuredContent: { id, updated_at: null, deleted: true } },
                summary: `deleted staged deliverable ${id}`,
              };
            },
          },
        },
      },
      practice_test: {
        entity: "practice_test",
        actions: {
          // P4-08 (a9-confirmed scope addition): reuses P2-09's own cores
          // (lib/school/practice-test-actions-core.ts, extracted from
          // app/(app)/school/practice-test-actions.ts, which Sonnet ENG 1
          // owns) -- no new persistence logic, only MCP wiring + error
          // translation over the exact same reveal-then-self-report shape
          // the app UI already uses.
          submit_answer: {
            action: "submit_answer",
            description:
              "Record one self-reported answer on an already-assembled practice test (assembly itself is a server-side cron dispatcher; this action never creates a practice_tests row). Requires the top-level id (the practice test's own id).",
            patchShape: "{ question_id: string, self_reported_correct: boolean }",
            idempotent: true,
            idempotencyVerification:
              "submitPracticeTestAnswerCore (lib/school/practice-test-actions-core.ts) upserts on (user_id, practice_test_id, question_id) -- a retry (or genuinely re-answering before completing) overwrites the same row with the same or a corrected self-report, never a duplicate.",
            handler: async (ctx, patch) => {
              const practiceTestId = requireId(ctx);
              const questionId = requireString(patch, "question_id");
              const selfReportedCorrect = requireBoolean(patch, "self_reported_correct");
              try {
                await submitPracticeTestAnswerCore(ctx.userClient, ctx.userId, practiceTestId, questionId, selfReportedCorrect);
              } catch (err) {
                // Composite FK (user_id, practice_test_id) -> practice_tests
                // and (user_id, question_id) -> questions -- either one
                // being foreign or nonexistent raises 23503. Can't tell
                // which from the code alone, but "the practice test" is
                // the top-level id this action is scoped to, so that's the
                // more useful name in the error.
                if (pgCode(err) === FK_VIOLATION) throw new ToolNotFoundError(`No practice test found with id "${practiceTestId}" (or the question isn't part of it).`);
                throw err;
              }
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id: practiceTestId, question_id: questionId }) }], structuredContent: { id: practiceTestId, updated_at: null } },
                summary: `recorded a self-reported answer on practice test ${practiceTestId}`,
              };
            },
          },
          complete: {
            action: "complete",
            description:
              "Mark a practice test completed and compute+store its score from the recorded self-reports (an unanswered question counts as NOT correct, never silently excluded). Requires the top-level id (the practice test's own id).",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification:
              "completePracticeTestCore (lib/school/practice-test-actions-core.ts) recomputes score_pct from the CURRENT practice_test_answers rows every call and UPDATEs to that exact value -- a retry with no new answers in between writes the identical row.",
            handler: async (ctx) => {
              const practiceTestId = requireId(ctx);
              const { data: existing, error: readErr } = await ctx.userClient.from("practice_tests").select("id").eq("id", practiceTestId).eq("user_id", ctx.userId).maybeSingle();
              if (readErr) throw readErr;
              if (!existing) throw new ToolNotFoundError(`No practice test found with id "${practiceTestId}".`);
              const outcome = await completePracticeTestCore(ctx.userClient, ctx.userId, practiceTestId);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ id: practiceTestId, ...outcome }) }],
                  structuredContent: { id: practiceTestId, updated_at: null, score_pct: outcome.scorePct, answered_count: outcome.answeredCount, question_count: outcome.questionCount },
                },
                summary: `completed practice test ${practiceTestId}: ${outcome.scorePct}% (${outcome.answeredCount}/${outcome.questionCount} answered)`,
              };
            },
          },
        },
      },
      schedule_event: {
        entity: "schedule_event",
        actions: {
          // Three DISTINCT recurrence writes, named so a caller cannot
          // confuse "change every future week" with "change/cancel just
          // ONE occurrence" -- the lead's explicit requirement ("a model
          // that can only edit the series will do real damage trying to
          // skip one day"). See docs/ai-connector/SCHOOL-WRITE-SCOPE-
          // DECISIONS.md for the deliberately-excluded counterparts
          // (create/remove a series, undo an override, uncancel) and why.
          edit_series: {
            action: "edit_series",
            description: "Permanently change a recurring class's own day/time -- affects every future occurrence, never just one ('change the class permanently'). Requires the top-level id (the schedule_events row's id).",
            patchShape: "{ day_of_week: number, event_time: string, end_time?: string }",
            idempotent: true,
            idempotencyVerification: "updateScheduleEventCore (lib/tasks/actions-core.ts) UPDATEs to the exact given values -- a retry writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await assertRowDomain(ctx.userClient, "schedule_events", id, ctx.userId, "school");
              const dayOfWeek = requireNumberEnum(patch, "day_of_week", DAYS_OF_WEEK);
              const eventTime = requireString(patch, "event_time");
              const endTime = optionalString(patch, "end_time");
              await updateScheduleEventCore(ctx.userClient, ctx.userId, id, { dayOfWeek, eventTime, endTime });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `permanently changed class ${id} to day ${dayOfWeek} at ${eventTime}`,
              };
            },
          },
          set_override: {
            action: "set_override",
            description: "Move ONE occurrence of a recurring class to a different time, without touching the permanent pattern ('move next Tuesday's class'). Requires the top-level id (the schedule_events row's id) and patch.date.",
            patchShape: "{ date: string, event_time: string, end_time?: string }",
            idempotent: true,
            idempotencyVerification:
              "setScheduleEventOverrideCore (lib/tasks/actions-core.ts) upserts on (event_id,date) with event_time/end_time taken verbatim from the patch, then DELETEs any cancellation for the same (event_id,date) -- a retry upserts the identical override and deletes an already-absent cancellation row (a no-op DELETE, not an error).",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await assertRowDomain(ctx.userClient, "schedule_events", id, ctx.userId, "school");
              const date = requireString(patch, "date");
              const eventTime = requireString(patch, "event_time");
              const endTime = optionalString(patch, "end_time");
              await setScheduleEventOverrideCore(ctx.userClient, ctx.userId, id, date, eventTime, endTime);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, date }) }], structuredContent: { id, updated_at: null, date } },
                summary: `moved class ${id}'s ${date} occurrence to ${eventTime}`,
              };
            },
          },
          cancel_occurrence: {
            action: "cancel_occurrence",
            description: "Cancel ONE occurrence of a recurring class, without touching the permanent pattern or any other occurrence ('cancel this one instance'). Requires the top-level id (the schedule_events row's id) and patch.date.",
            patchShape: "{ date: string }",
            idempotent: true,
            idempotencyVerification: "cancelScheduleOccurrenceCore (lib/tasks/actions-core.ts) upserts on (event_id,date) with `ignoreDuplicates: true` -- explicitly a no-op on a repeat cancel, by its own header comment and the upsert option, not just inferred.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await assertRowDomain(ctx.userClient, "schedule_events", id, ctx.userId, "school");
              const date = requireString(patch, "date");
              await cancelScheduleOccurrenceCore(ctx.userClient, ctx.userId, id, date);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, date }) }], structuredContent: { id, updated_at: null, date } },
                summary: `cancelled class ${id}'s ${date} occurrence`,
              };
            },
          },
          // create/remove (the series itself), remove_override, and
          // uncancel deliberately absent -- "remove" is a hard delete on
          // schedule_events, and remove_override/uncancel are hard deletes
          // on their own exception tables. The MCP write path never
          // hard-deletes, full stop, even for a narrowly-scoped exception
          // row. See docs/ai-connector/SCHOOL-WRITE-SCOPE-DECISIONS.md.
        },
      },
      canvas_import: {
        entity: "canvas_import",
        actions: {
          // CANVAS-LITE-02 -- the workaround for a school that blocks
          // Canvas personal access tokens (CANVAS-LITE-01's own header):
          // the user's own AI platform (GPT/Gemini/Perplexity/Claude, per
          // the task's own "Why") runs a scheduled cloud task that logs
          // into Canvas on its own side and sends one bulk batch here
          // instead of many single writes. This handler never talks to
          // Canvas and never sees a Canvas credential -- see
          // lib/canvas/agent-import-core.ts's own header for the full
          // design and why no migration/new tool was needed.
          run_batch: {
            action: "run_batch",
            description:
              "Bulk-import Canvas data an external agent already scraped on its own: course mappings, graded assignments, and announcements, in one call. Course items map a Canvas course to a local class (auto-mapping ONLY on an unambiguous name/code match against the user's own classes; never auto-creates a class). Assessment items reuse the exact never-overwrite-a-user-entered-grade guard and unambiguous-local-match rule the token-based Canvas sync already uses, and never auto-create a duplicate assessment (stages an unmatched one for review instead). An assessment's grading_type must be 'points' or 'percent' for a grade to be applied -- omit it, or send pass_fail/letter_grade/gpa_scale/not_graded, and the item is skipped as ungradable rather than risking a numerically-real but semantically-wrong grade (the assignment can still be linked for later). Announcement items reuse the existing paste-an-announcement extraction pipeline. Every item gets its own outcome (created/updated/skipped, with a reason) -- never one opaque batch success. Capped at 200 items per call.",
            patchShape:
              "{ items: Array<" +
              "{kind:'course', canvas_course_id:string, canvas_course_name:string, canvas_course_code?:string|null} | " +
              "{kind:'assessment', canvas_course_id:string, canvas_assignment_id:string, name:string, due_at?:string|null, points_possible?:number|null, points_earned:number, grading_type?:string|null} | " +
              "{kind:'announcement', canvas_course_id:string, canvas_announcement_id:string, text:string}" +
              "> } -- max 200 items per call. grading_type must be 'points' or 'percent' to actually apply a grade; anything else (including omitted) links without grading.",
            idempotent: true,
            idempotencyVerification:
              "Every item kind keys on an existing unique constraint, never an invented id scheme: course items upsert canvas_course_mappings on (user_id, canvas_course_id) (lib/canvas/agent-import-core.ts's processCourseItem); assessment items delegate to processCanvasAssignment (lib/canvas/sync-core.ts, shared with the token-based sync loop), which either updates an already-linked/matched class_assessments row to the identical values or stages via staging_batches' partial-unique canvas_assignment_id tombstone, pre-filtered before insert since the insert itself has no ON CONFLICT; announcement items are pre-filtered against staging_batches' own canvas_announcement_id tombstone the same way before calling stageAnnouncementCore. A repeat of the identical batch reproduces the identical end state, reporting 'already staged'/'existing grade protected'/'refreshed' outcomes rather than a duplicate row.",
            handler: async (ctx, patch) => {
              const items = requireCanvasImportItems(patch);
              const batch = await runCanvasImportBatchCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, items);
              return {
                result: { content: [{ type: "text", text: JSON.stringify(batch) }], structuredContent: { ...batch } },
                summary: `Canvas import: ${batch.counts.created} created, ${batch.counts.updated} updated, ${batch.counts.skipped} skipped (${items.length} item${items.length === 1 ? "" : "s"} total)`,
              };
            },
          },
        },
      },
    },
  },
  fitness: {
    domain: "fitness",
    entities: {
      workout_session: {
        entity: "workout_session",
        actions: {
          // The owner's "checking off logs" requirement in its heaviest
          // form (team-lead's framing) -- three ways a session gets
          // logged, matching the app's own three creation paths exactly.
          // No edit/remove: workout_sessions/session_sets are IMMUTABLE by
          // design (spec: "editing must never rewrite history") -- there is
          // no update or delete path anywhere in the app to even consider
          // excluding.
          quick_log: {
            action: "quick_log",
            description: "Log a bare single-exercise session, no workout template ('quick-add'). Scattered same-day entries stay separate rows -- never merges into an existing session.",
            patchShape: "{ date: string, exercise_id: string, exercise_name: string, sets: number, reps: number, load?: number|null }",
            idempotent: false,
            idempotencyVerification: "quickLogExerciseCore (lib/fitness/actions-core.ts) plain-INSERTs a session+set, no conflict handling -- deliberately: scattered same-day entries stay separate rows by design, so a retry creates a second, duplicate session exactly like a real second quick-add would.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const exerciseId = requireString(patch, "exercise_id");
              const exerciseName = requireString(patch, "exercise_name");
              const sets = optionalNumber(patch, "sets");
              const reps = optionalNumber(patch, "reps");
              if (sets === undefined) throw new ToolInputError("patch.sets is required.");
              if (reps === undefined) throw new ToolInputError("patch.reps is required.");
              const load = optionalNullableNumber(patch, "load") ?? null;
              const id = await quickLogExerciseCore(ctx.userClient, ctx.userId, date, exerciseId, exerciseName, sets, reps, load);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: ctx.now.toISOString() } },
                summary: `quick-logged ${exerciseName} (${sets}x${reps}) on ${date}`,
              };
            },
          },
          confirm: {
            action: "confirm",
            description: "Confirm a workout (from a standalone workout template) for a date, logging every set at once. Idempotent: a repeat confirm of the same workout/date is a no-op (029's unique index), not an error.",
            patchShape: "{ date: string, workout_id: string, workout_name: string, sets: ConfirmSetInput[] }",
            idempotent: true,
            idempotencyVerification:
              "confirm_workout_session RPC (migration 029): inserts the session first (guarded by workout_sessions_confirmed_unique on (user_id,date,workout_id) where source='confirmed'), and its own exception handler catches unique_violation and SELECTs the existing session id back rather than erroring or re-inserting sets -- verified directly in the RPC's SQL, matching save_allocation_checkin's established idiom.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const workoutId = requireString(patch, "workout_id");
              const workoutName = requireString(patch, "workout_name");
              const sets = requireConfirmSets(patch);
              const id = await confirmWorkoutSessionCore(ctx.userClient, date, workoutId, workoutName, sets);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: ctx.now.toISOString() } },
                summary: `confirmed workout "${workoutName}" on ${date}`,
              };
            },
          },
          confirm_plan_session: {
            action: "confirm_plan_session",
            description: "Confirm a routine plan's session for a date. Requires the top-level id (the plan_sessions row's id). Idempotent: a repeat confirm of the same plan session/date is a no-op, not an error.",
            patchShape: "{ date: string, session_name: string, sets: ConfirmSetInput[] }",
            idempotent: true,
            idempotencyVerification:
              "confirmPlanSessionCore (lib/fitness/actions-core.ts) inserts the session first, guarded by workout_sessions_plan_session_unique on (user_id,date,plan_session_id) where source='confirmed' (verified this index exists in the baseline schema) -- its own 23505 catch looks up and returns the already-confirmed row's id rather than erroring or re-inserting sets.",
            handler: async (ctx, patch) => {
              const sessionId = requireId(ctx);
              const date = requireString(patch, "date");
              const sessionName = requireString(patch, "session_name");
              const sets = requireConfirmSets(patch);
              const id = await confirmPlanSessionCore(ctx.userClient, ctx.userId, date, sessionId, sessionName, sets);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: ctx.now.toISOString() } },
                summary: `confirmed plan session "${sessionName}" on ${date}`,
              };
            },
          },
        },
      },
      body_metric: {
        entity: "body_metric",
        actions: {
          // Top priority per the lead, alongside workout_session's logging
          // actions. Each preserves the sibling field (weight vs waist) by
          // reading it first -- see logWeightCore/logWaistCore's own
          // comments -- so these two calls never clobber each other.
          log_weight: {
            action: "log_weight",
            description: "Log (or overwrite) a date's weight. Preserves that date's waist measurement if one already exists.",
            patchShape: "{ date: string, weight_lb: number }",
            idempotent: true,
            idempotencyVerification: "logWeightCore upserts on (user_id,date) with weight_lb from the patch and waist_in re-read fresh from the current row each call -- a retry writes the identical weight, and preserves whatever waist_in is CURRENTLY live (never a stale cached value), so it can't drift.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const weightLb = optionalNumber(patch, "weight_lb");
              if (weightLb === undefined) throw new ToolInputError("patch.weight_lb is required.");
              await logWeightCore(ctx.userClient, ctx.userId, date, weightLb);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ date, weight_lb: weightLb }) }], structuredContent: { id: `${ctx.userId}:${date}`, updated_at: ctx.now.toISOString(), date, weight_lb: weightLb } },
                summary: `logged weight ${weightLb} on ${date}`,
              };
            },
          },
          log_waist: {
            action: "log_waist",
            description: "Log (or overwrite) a date's waist measurement. Preserves that date's weight if one already exists.",
            patchShape: "{ date: string, waist_in: number }",
            idempotent: true,
            idempotencyVerification: "logWaistCore upserts on (user_id,date) with waist_in from the patch and weight_lb re-read fresh each call -- same mechanism as log_weight.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const waistIn = optionalNumber(patch, "waist_in");
              if (waistIn === undefined) throw new ToolInputError("patch.waist_in is required.");
              await logWaistCore(ctx.userClient, ctx.userId, date, waistIn);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ date, waist_in: waistIn }) }], structuredContent: { id: `${ctx.userId}:${date}`, updated_at: ctx.now.toISOString(), date, waist_in: waistIn } },
                summary: `logged waist ${waistIn} on ${date}`,
              };
            },
          },
        },
      },
      fitness_benchmark: {
        entity: "fitness_benchmark",
        actions: {
          log: {
            action: "log",
            description: "Log (or overwrite) one exercise's max-reps benchmark for a date (Cycle Progress checks). One call per exercise -- call it again for a second exercise, never a batch.",
            patchShape: "{ date: string, exercise_id: string, max_reps: number }",
            idempotent: true,
            idempotencyVerification: "logBenchmarkRepsCore upserts on (user_id,date,exercise_id) with max_reps taken verbatim from the patch -- a retry upserts the identical row.",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const exerciseId = requireString(patch, "exercise_id");
              const maxReps = optionalNumber(patch, "max_reps");
              if (maxReps === undefined) throw new ToolInputError("patch.max_reps is required.");
              await logBenchmarkRepsCore(ctx.userClient, ctx.userId, date, exerciseId, maxReps);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ date, exercise_id: exerciseId, max_reps: maxReps }) }],
                  structuredContent: { id: `${date}:${exerciseId}`, updated_at: ctx.now.toISOString(), date, exercise_id: exerciseId, max_reps: maxReps },
                },
                summary: `logged ${maxReps} max reps for exercise ${exerciseId} on ${date}`,
              };
            },
          },
        },
      },
      exercise: {
        entity: "exercise",
        actions: {
          create: {
            action: "create",
            description: "Add an exercise to the library.",
            patchShape: "{ name: string, primary_muscles?: MuscleGroup[], secondary_muscles?: MuscleGroup[] }",
            idempotent: false,
            idempotencyVerification: "createExerciseCore (lib/fitness/actions-core.ts) plain INSERT, no natural-key conflict handling -- a retry creates a second, duplicate exercise.",
            handler: async (ctx, patch) => {
              const name = requireString(patch, "name");
              const primaryMuscles = optionalMuscleGroupArray(patch, "primary_muscles");
              const secondaryMuscles = optionalMuscleGroupArray(patch, "secondary_muscles");
              const id = await createExerciseCore(ctx.userClient, ctx.userId, name, primaryMuscles, secondaryMuscles);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `created exercise "${name}"`,
              };
            },
          },
          archive: {
            action: "archive",
            description: "Archive an exercise (never a hard delete -- workout_exercises/session_sets reference it with no cascade). Requires the top-level id.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "archiveExerciseCore sets archived=true unconditionally (never reads-then-inverts) -- a retry sets the identical value.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              await archiveExerciseCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `archived exercise ${id}`,
              };
            },
          },
          // "remove" deliberately absent -- exercises are archived, never
          // hard-deleted, anywhere in this codebase (same convention as
          // every other domain's "archive, don't delete" entities).
        },
      },
      workout: {
        entity: "workout",
        actions: {
          rename: {
            action: "rename",
            description: "Rename a workout template. Requires the top-level id.",
            patchShape: "{ name: string }",
            idempotent: true,
            idempotencyVerification: "renameWorkoutCore sets name to the exact given value -- a retry writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const name = requireString(patch, "name");
              await renameWorkoutCore(ctx.userClient, ctx.userId, id, name);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `renamed workout ${id} to "${name}"`,
              };
            },
          },
          archive: {
            action: "archive",
            description: "Archive a workout template (never a hard delete). Requires the top-level id.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "archiveWorkoutCore sets archived=true unconditionally -- a retry sets the identical value.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              await archiveWorkoutCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `archived workout ${id}`,
              };
            },
          },
          // "create"/"save" (with its exercise list) deliberately absent --
          // createWorkoutWithExercises/saveWorkout/duplicateWorkout all
          // touch workout_exercises via the save_workout RPC's
          // delete-then-reinsert, part of the plan-editing machinery the
          // lead asked to deprioritize. See
          // docs/ai-connector/FITNESS-WRITE-SCOPE-DECISIONS.md.
        },
      },
      // workout_plan, plan_session, plan_session_exercise,
      // plan_micro_exercise, workout_exercise, workout_schedule, and
      // active_workout_plan are READ-ONLY in this pass, deliberately --
      // the plan-editing/scheduling machinery the lead asked to
      // deprioritize, and in active_workout_plan/workout_schedule's case,
      // the program's known scar tissue (migration 129, the sync shim).
      // See docs/ai-connector/FITNESS-WRITE-SCOPE-DECISIONS.md.
    },
  },
  /**
   * checkins/distractions: the first write actions on top of the read-only
   * domains that landed earlier this pass -- prioritized ahead of settings
   * writes and scheduling, per the argument accepted by the lead: "a
   * connector that can describe your whole day but can only log a handful
   * of things is a worse product than the read side alone promises," and
   * these two are the domains where a write is the most natural thing a
   * person would actually say to an assistant.
   */
  checkins: {
    domain: "checkins",
    entities: {
      allocation: {
        entity: "allocation",
        actions: {
          save: {
            action: "save",
            description:
              "Record an allocation check-in (\"log me as heads-down for the last hour\") -- domain-minutes for the CURRENT/most-recent open check-in window, or an ad-hoc 120-minute window ending now if nothing is open. Unaccounted time is derived automatically, never supplied. No top-level id -- always targets a window, never an existing row by id.",
            patchShape: "{ allocations: Record<'deen'|'business'|'school'|'fitness'|'co_op', number> }",
            // CORRECTED FINDING (was claimed idempotent in an earlier
            // report -- it isn't, for L7's purposes): the underlying RPC's
            // own same-window no-op only protects a DIRECT retry with the
            // identical window_start/window_end. This handler never
            // accepts those as args -- resolveTargetWindow (actions-core.ts)
            // resolves "the current open window" FRESH on every call, by
            // design, so a caller retrying after an already-successful
            // write finds that window now answered and silently advances
            // to a DIFFERENT (ad-hoc) window instead of hitting the RPC's
            // no-op -- a genuine double-count, not a safe retry. Correct
            // for the live/manual use case this was built for (a human
            // retrying really does want "whatever's open now"); wrong for
            // unattended at-least-once redelivery, which is exactly what
            // L7's scheduler gate exists to keep off this action until a
            // caller-pinned-window variant (or an idempotency key) exists.
            idempotent: false,
            idempotencyVerification:
              "resolveTargetWindow (lib/checkins/actions-core.ts) re-resolves the target window on every call rather than accepting one from the caller -- a retry after a successful first write finds that window already answered and moves to a new (ad-hoc) one, writing a SECOND real allocation instead of no-op'ing. Not schedulable until this handler accepts a caller-pinned window or the RPC path gains a real idempotency key.",
            handler: async (ctx, patch) => {
              const allocationsRaw = patch.allocations;
              if (typeof allocationsRaw !== "object" || allocationsRaw === null || Array.isArray(allocationsRaw)) {
                throw new ToolInputError("patch.allocations is required and must be an object of domain -> minutes.");
              }
              const result = await saveAllocationCheckinCore(ctx.userClient, ctx.userId, ctx.now, allocationsRaw as Record<string, unknown>);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `recorded allocation checkin ${result.id} (${result.wastedMinutes}m unaccounted)${result.wasScheduledWindow ? "" : ", ad-hoc window"}`,
              };
            },
          },
        },
      },
      // `checkin` (the plain point-sample entity, checkins.checkin in the
      // read-side registry) is deliberately NOT writable here -- not
      // because a chat turn lacks live scheduler state, but because there
      // IS no live scheduler anymore to lack. CheckinScheduler was deleted
      // (2026-09-10); the whole point-sample flow it drove -- CheckinPrompt,
      // answerCheckin, recordMissedCheckin, getCheckinOptionsForNow -- has
      // been dead code since 05e6ecd (2026-08-19), when the allocation-
      // window model replaced it (e2e/checkin.spec.ts documents the
      // replacement explicitly). There is nothing left to wire an MCP
      // action onto. "Log time to a domain" is fully served by
      // allocation.save above, which is the only checkin model left.
    },
  },
  distractions: {
    domain: "distractions",
    entities: {
      trigger: {
        entity: "trigger",
        actions: {
          capture: {
            action: "capture",
            description:
              "\"I just got distracted by my phone\" -- find-or-create a trigger by name (idempotent: a double-submit of the same name reuses the existing one, never duplicates) and log one event against it in the same call. Optionally attaches a tiered self-reflection (writes a linked deen.reflection_entry row too, same as the app's own capture dialog).",
            patchShape: "{ domain: 'deen'|'business'|'school'|'fitness'|'co_op', name: string, description?: string|null, tier?: 1|2|3 }",
            // The TRIGGER half is idempotent (23505 dedup-by-name); the
            // EVENT half is not -- insertEventCore always INSERTs a new
            // distraction_events row with no dedup key at all, so a retry
            // logs the distraction a second time. Idempotent overall means
            // BOTH halves have to hold.
            idempotent: false,
            idempotencyVerification: "insertEventCore (lib/distractions/actions-core.ts) always INSERTs a new distraction_events row -- no conflict target, no dedup key -- so a retry double-logs the distraction even though the trigger itself dedupes cleanly.",
            handler: async (ctx, patch) => {
              const result = await captureCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, patch.domain, patch.name, patch.description, patch.tier);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { id: result.triggerId, updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `captured distraction against trigger ${result.triggerId} (event ${result.eventId})`,
              };
            },
          },
        },
      },
      event: {
        entity: "event",
        actions: {
          log: {
            action: "log",
            description: "Log one more occurrence of an ALREADY-KNOWN trigger (found via a prior read or capture) -- no top-level id; the trigger is named in patch.trigger_id, matching this table's own read-side shape.",
            patchShape: "{ trigger_id: string, tier?: 1|2|3 }",
            idempotent: false,
            idempotencyVerification: "insertEventCore (lib/distractions/actions-core.ts) always INSERTs -- same mechanism (or lack of one) as trigger.capture's own event half.",
            handler: async (ctx, patch) => {
              const result = await logEventCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, patch.trigger_id, patch.tier);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { id: result.eventId, updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `logged event ${result.eventId} against trigger ${String(patch.trigger_id)}`,
              };
            },
          },
        },
      },
      action_plan: {
        entity: "action_plan",
        actions: {
          save: {
            action: "save",
            description: "Write or edit a trigger's action plan -- edits the current version's body in place if one exists, otherwise creates version 1. No top-level id -- the trigger is named in patch.trigger_id (a version is per-TRIGGER, not addressed by its own row id).",
            patchShape: "{ trigger_id: string, body: string }",
            idempotent: true,
            idempotencyVerification:
              "saveActionPlanCore (lib/distractions/actions-core.ts) checks for a current plan FIRST: a retry after a successful first call always finds one now (the version the first call created or edited) and lands on the update-in-place branch, overwriting body with the IDENTICAL value -- a true no-op. The RPC-creating branch (save_trigger_plan, a new version) can only ever run once per retry sequence, because its own precondition ('no current plan exists') is exactly what the first successful call falsifies.",
            handler: async (ctx, patch) => {
              const result = await saveActionPlanCore(ctx.userClient, ctx.userId, patch.trigger_id, patch.body);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { id: result.triggerId, updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `${result.createdNewVersion ? "created version 1 of" : "edited"} the action plan for trigger ${result.triggerId}`,
              };
            },
          },
        },
      },
      plan_outcome: {
        entity: "plan_outcome",
        actions: {
          record: {
            action: "record",
            description: "\"That plan didn't work\" -- record today's followed/skipped answer for a trigger's current plan. A same-day resubmission overwrites, it does not accumulate (matches the read-side entity's own at-most-one-per-day shape). patch.new_plan_body is required when patch.followed is true, and required if this is the plan's 3rd skip with zero follows -- both enforced by the underlying RPC's own transaction, surfaced here as a clear error, not pre-guessed.",
            patchShape: "{ trigger_id: string, followed: boolean, new_plan_body?: string }",
            // The outcome ROW itself is idempotent (the RPC's own
            // on-conflict-do-update on (user_id,trigger_id,date)) -- but
            // `followed: true` is NOT overall idempotent: record_plan_outcome
            // (migration 043) calls save_trigger_plan UNCONDITIONALLY
            // whenever p_followed is true, even on the conflict-update path,
            // so a retry supersedes the plan and creates a NEW version a
            // second time -- two version bumps for one real outcome.
            // `followed: false` alone (no forced-rewrite threshold hit) IS
            // idempotent, but this action can't be split by patch VALUE at
            // the registry level, so the whole action is marked unsafe.
            idempotent: false,
            idempotencyVerification:
              "record_plan_outcome's own SQL (migration 043): `if p_followed then perform public.save_trigger_plan(...); return; end if;` runs on every call where followed=true, including a retry that hits the on-conflict-do-update branch first -- superseding the plan and creating a new version TWICE for one real outcome. followed:false alone would be idempotent (the conflict update is a true no-op) but the action can't be conditionally marked safe by patch value here.",
            handler: async (ctx, patch) => {
              const result = await recordPlanOutcomeCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, patch.trigger_id, patch.followed, patch.new_plan_body);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { id: result.triggerId, updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `recorded ${result.followed ? "followed" : "skipped"} for trigger ${result.triggerId} on ${result.date}`,
              };
            },
          },
        },
      },
    },
  },
  /**
   * settings: DELIBERATELY NARROW, per the lead's exact scope — theme_preset/
   * hidden_features on profile, weekday_baselines on user_setting. See
   * lib/settings/actions-core.ts's own header for why everything else on
   * user_settings is left unwired (checked, not assumed: it has no write
   * path anywhere in the app today, not even through the real UI), and why
   * `api_key` has NO entity/actions here at all — not an oversight, a
   * permanent exclusion (a model that could write a provider key could
   * exfiltrate one by writing a key it controls).
   */
  settings: {
    domain: "settings",
    entities: {
      profile: {
        entity: "profile",
        actions: {
          update: {
            action: "update",
            description:
              "Change the account's theme preset and/or which nav features are hidden. No top-level id -- always the caller's own single profile row. `home`/`settings` can never appear in hidden_features (refused with a clear message, matching the DB's own CHECK -- see updateAppearanceCore's comment).",
            patchShape: "{ theme_preset?: 'oxblood'|'ocean'|'forest'|'sunset'|'mono', hidden_features?: ('deen'|'work'|'business'|'school'|'fitness'|'insights')[] }",
            idempotent: true,
            idempotencyVerification: "updateAppearanceCore upserts the exact given value(s) -- a retry with the identical patch writes the identical row, a true no-op.",
            handler: async (ctx, patch) => {
              const result = await updateAppearanceCore(ctx.userClient, ctx.userId, { theme_preset: patch.theme_preset, hidden_features: patch.hidden_features });
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { id: ctx.userId, updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `updated appearance settings${result.theme_preset ? ` (theme: ${result.theme_preset})` : ""}${result.hidden_features ? ` (hidden: ${result.hidden_features.join(", ") || "none"})` : ""}`,
              };
            },
          },
          // No other profiles column is writable here -- display_name,
          // timezone, location, prayer_calc_method/asr_madhab, the PIN
          // fields, checkin window/interval, traveling_mode,
          // onboarding_completed, paused_date are all out of scope for
          // this pass, deliberately: the lead named theme_preset/
          // hidden_features specifically, and pin_hash in particular is
          // credential-adjacent (a model that could clear/set a PIN could
          // defeat the app's own lock screen) -- the same class of concern
          // as user_api_keys, not silently bundled in with an unrelated
          // appearance action.
        },
      },
      user_setting: {
        entity: "user_setting",
        actions: {
          set_weekday_baselines: {
            action: "set_weekday_baselines",
            description: "Set all 7 weekday hour baselines (R58) for the Day Won comparison. No top-level id.",
            patchShape: "{ values: number[7] }", // hours 0-12, Sunday first
            idempotent: true,
            idempotencyVerification: "setWeekdayBaselinesCore UPDATEs to the exact given array -- a retry with the identical values writes the identical row, a true no-op.",
            handler: async (ctx, patch) => {
              const result = await setWeekdayBaselinesCore(ctx.userClient, ctx.userId, patch.values);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { id: ctx.userId, updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `set weekday baselines to [${result.values.join(", ")}]`,
              };
            },
          },
          clear_weekday_baselines: {
            action: "clear_weekday_baselines",
            description: "Reset weekday baselines to NEVER SET -- not the same as a week of zeros (see clearWeekdayBaselinesCore's own comment). No top-level id, no patch.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "clearWeekdayBaselinesCore UPDATEs to NULL unconditionally -- a retry writes the identical NULL, a true no-op.",
            handler: async (ctx) => {
              await clearWeekdayBaselinesCore(ctx.userClient, ctx.userId);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ cleared: true }) }], structuredContent: { id: ctx.userId, updated_at: ctx.now.toISOString(), cleared: true } },
                summary: "cleared weekday baselines back to never-set",
              };
            },
          },
          // daily_new_limit, notification_enabled, notification_time,
          // desired_retention, ai_grading_enabled, session_target_minutes
          // are deliberately absent -- see this domain's own header
          // comment and lib/settings/actions-core.ts's: none of them has
          // a write path anywhere in the app today, so wiring them here
          // would make MCP the FIRST place they become editable at all,
          // not an extension of an existing capability. Flagged to the
          // lead rather than guessed at.
        },
      },
      // `api_key` has NO entity here -- see this domain's own header
      // comment. Permanent, not a "not yet."
    },
  },
  /**
   * Grading a review, adopting/abandoning a promoted lesson, logging a
   * self-explanation -- the owner's own scope, and nothing wider. NEVER a
   * path to `lessons`, `cards`, or `source_chunks` content: `source_chunks`
   * carries an EMPTY column allowlist in the read registry (lib/mcp/
   * registry.ts) specifically so raw book text is structurally
   * unreachable over MCP, and nothing here writes to any of those three
   * tables at all -- a model editing its own source material is a loop
   * with no ground truth. Every handler composes an already-built
   * core() (lib/self-mastery/actions-core.ts, lib/promotions/
   * actions-core.ts) -- no business logic lives in this file.
   */
  self_mastery: {
    domain: "self_mastery",
    entities: {
      review: {
        entity: "review",
        actions: {
          grade: {
            action: "grade",
            description:
              "Grade a spaced-repetition review for one card (1=Again, 2=Hard, 3=Good, 4=Easy) -- the SAME submit_review RPC every other grading path in the app (the session overlay, the legacy gradeCard action) already uses. No top-level id -- the card being graded is patch.card_id.",
            patchShape: "{ card_id: string, rating: 1|2|3|4, elapsed_ms?: number, answered_text?: string, confidence?: 'sure'|'think_so'|'guessing'|null }",
            idempotent: false,
            idempotencyVerification:
              "gradeReviewCore (lib/self-mastery/actions-core.ts) calls submit_review, which advances FSRS scheduling state FROM the row's CURRENT state -- reps/due_at/stability are all derived from what card_states already holds, not from a fixed target. Replaying the identical grade twice moves the card TWICE: reps increments twice, due_at advances twice past what one real review earns, and a second Again past state:'review' would even double-count a lapse. There is no conflict-key or no-op path here the way an upsert-by-natural-key write elsewhere in this program has -- a retry is a second, real, distinct grading event from the scheduler's own point of view. Never schedule this action.",
            handler: async (ctx, patch) => {
              const cardId = requireString(patch, "card_id");
              const rating = requireNumberEnum(patch, "rating", [1, 2, 3, 4] as const);
              const elapsedMs = optionalNumber(patch, "elapsed_ms");
              const answeredText = optionalString(patch, "answered_text");
              const confidenceRaw = optionalNullableString(patch, "confidence");
              if (confidenceRaw != null && !["sure", "think_so", "guessing"].includes(confidenceRaw)) {
                throw new ToolInputError(`patch.confidence must be one of: sure, think_so, guessing, or null/omitted. Got: ${JSON.stringify(confidenceRaw)}.`);
              }
              const confidence = (confidenceRaw ?? null) as "sure" | "think_so" | "guessing" | null;
              const result = await gradeReviewCore(ctx.userClient, ctx.userId, {
                cardId,
                rating,
                elapsedMs,
                answeredText,
                confidence,
                now: ctx.now,
              });
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: result.updatedAt, ...result },
                },
                summary: `graded card ${cardId} as ${rating}/4 -- next review in ${result.scheduledDays} day(s)`,
              };
            },
          },
        },
      },
      lesson_promotion: {
        entity: "lesson_promotion",
        actions: {
          record_verdict: {
            action: "record_verdict",
            description:
              "Record adopted/abandoned/still_testing against an EXISTING lesson_promotion (the top-level id) -- append-only, reuses migration 128's own reject_verdict_on_retired_promotion guard rather than reimplementing it. Never CREATES a promotion (that stays app-only, out of this pass's scope) and never touches lessons/cards/source_chunks content.",
            patchShape: "{ verdict: 'adopted'|'abandoned'|'still_testing', reason?: string }",
            idempotent: false,
            idempotencyVerification:
              "recordVerdictCore (lib/promotions/actions-core.ts) is a plain INSERT into the append-only lesson_verdicts log -- no conflict key. A retry with a TERMINAL verdict (adopted/abandoned) fails loudly on the second call (migration 128's trigger, since the first call already retired the promotion) rather than duplicating -- but 'still_testing' is non-terminal, has no such guard, and a retry inserts a genuine SECOND log row for what was meant to be one observation. Not idempotent for every value this action accepts, so the action as a whole is false -- the flag describes the action's whole accepted input domain, not its happy path.",
            handler: async (ctx, patch) => {
              const promotionId = requireId(ctx);
              const verdict = requireEnum(patch, "verdict", ["adopted", "abandoned", "still_testing"] as const);
              const reason = optionalNullableString(patch, "reason");
              // P4-08 follow-up (HANDOFF §5 item 3): same treatment as
              // lesson.promote's own translation just above -- recordVerdictCore
              // flattens its pg-code branches into plain Error messages before
              // this handler ever sees them, so translation keys off the exact
              // message text (copied verbatim from lib/promotions/actions-core.ts's
              // own throws). A drift there silently stops this from firing
              // (falls through to the generic re-throw) rather than mis-firing.
              let result;
              try {
                result = await recordVerdictCore(ctx.userClient, ctx.userId, { promotionId, verdict, reason });
              } catch (err) {
                const message = err instanceof Error ? err.message : null;
                if (message === "That experiment is no longer there. Reload and see what's still open.") {
                  throw new ToolNotFoundError(`No lesson promotion found with id "${promotionId}".`);
                }
                if (
                  message === "You've already given this one its verdict. Reload to see where it landed." ||
                  message === "Say what didn't work. A month from now that sentence is the whole value."
                ) {
                  throw new ToolInputError(message);
                }
                // GENERIC and "That didn't save..." stay plain Error --
                // caller cannot self-correct either one.
                throw err;
              }
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: result.verdictAt, ...result },
                },
                summary: `recorded verdict '${verdict}' on promotion ${promotionId}`,
              };
            },
          },
        },
      },
      self_explanation: {
        entity: "self_explanation",
        actions: {
          log: {
            action: "log",
            description:
              "Log a self-explanation reflection against a lesson -- ungraded by design, insert-only. A null/omitted response records a deliberate skip, never penalised, exactly as valid a row as an answered one. No top-level id -- a new row every call.",
            patchShape: "{ lesson_id: string, prompt: string, response?: string|null }",
            idempotent: false,
            idempotencyVerification:
              "logSelfExplanationCore (lib/self-mastery/actions-core.ts) is a plain INSERT into self_explanations, no conflict key at all -- any retry (identical or different content) creates a genuinely separate row every time; there is nothing here for a repeated call to collide with or overwrite.",
            handler: async (ctx, patch) => {
              const lessonId = requireString(patch, "lesson_id");
              const prompt = requireString(patch, "prompt");
              const response = optionalNullableString(patch, "response");
              const result = await logSelfExplanationCore(ctx.userClient, ctx.userId, { lessonId, prompt, response: response ?? null });
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: result.updatedAt, ...result },
                },
                summary: `logged a self-explanation for lesson ${lessonId}`,
              };
            },
          },
        },
      },
      question_review: {
        entity: "question_review",
        actions: {
          grade: {
            action: "grade",
            description:
              "Grade a spaced-repetition review for one QUESTION-bank question (1=Again, 2=Hard, 3=Good, 4=Easy) -- the question-bank twin of review.grade (submit_question_review, migration 161's sibling to review.grade's submit_review; genuinely distinct RPCs, not an overload). sessionId is always null here -- an MCP-graded review has no app-tracked work_sessions row to attribute it to, the same posture self_explanation.log already established for its own nullable session_id. No top-level id -- the question being graded is patch.question_id.",
            patchShape:
              "{ question_id: string, rating: 1|2|3|4, elapsed_ms?: number, answered_text?: string, confidence?: 'sure'|'think_so'|'guessing'|null, correct?: boolean|null }",
            idempotent: false,
            idempotencyVerification:
              "submitQuestionReview (lib/self-mastery/session/build-session.ts) advances FSRS scheduling state FROM the row's CURRENT state, same non-idempotent shape as review.grade's own gradeReviewCore -- a retry is a second, real, distinct grading event, never a no-op. Never schedule this action.",
            handler: async (ctx, patch) => {
              const questionId = requireString(patch, "question_id");
              const rating = requireNumberEnum(patch, "rating", [1, 2, 3, 4] as const);
              const elapsedMs = optionalNumber(patch, "elapsed_ms") ?? 0;
              const answeredText = optionalString(patch, "answered_text") ?? "";
              const confidenceRaw = optionalNullableString(patch, "confidence");
              if (confidenceRaw != null && !["sure", "think_so", "guessing"].includes(confidenceRaw)) {
                throw new ToolInputError(`patch.confidence must be one of: sure, think_so, guessing, or null/omitted. Got: ${JSON.stringify(confidenceRaw)}.`);
              }
              const confidence = (confidenceRaw ?? null) as "sure" | "think_so" | "guessing" | null;
              const correctRaw = patch.correct;
              if (correctRaw !== undefined && correctRaw !== null && typeof correctRaw !== "boolean") {
                throw new ToolInputError(`patch.correct must be a boolean, null, or omitted. Got: ${JSON.stringify(correctRaw)}.`);
              }
              const correct = (correctRaw ?? null) as boolean | null;

              const currentState = await fetchQuestionState(ctx.userClient, ctx.userId, questionId);
              const { desiredRetention } = await loadSessionSettings(ctx.userClient, ctx.userId);
              const result = await submitQuestionReview(ctx.userClient, {
                desiredRetention,
                userId: ctx.userId,
                currentState,
                questionId,
                sessionId: null,
                rating,
                elapsedMs,
                answeredText,
                aiFeedback: null,
                aiSuggestedRating: null,
                confidence,
                correct,
                now: ctx.now,
              });
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `graded question ${questionId} as ${rating}/4 -- next review in ${result.scheduledDays} day(s)`,
              };
            },
          },
        },
      },
      session: {
        entity: "session",
        actions: {
          finish: {
            action: "finish",
            description:
              "Finish (complete) a work session started via the app's own session screen -- complete_session (idempotent server-side, safe to call twice). Computes per-book retrievability and due-tomorrow AT finish time, same as the app's own finishSession (app/(app)/personal/self-mastery-session-actions.ts). Requires the top-level id (the session's id).",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "completeTodaysSession calls complete_session, which the RPC's own name and this file's existing self_mastery.review.grade precedent both document as idempotent server-side -- a retry recomputes the same streak/freeze state rather than double-counting it.",
            handler: async (ctx) => {
              const sessionId = requireId(ctx);
              const localDate = localDateString(ctx.now, ctx.timezone);
              const bookStrengths = await computeSessionBookStrengths(ctx.userClient, ctx.userId, sessionId, ctx.now);
              const [result, dueTomorrow] = await Promise.all([
                completeTodaysSession(ctx.userClient, sessionId, bookStrengths),
                countDueTomorrow(ctx.userClient, ctx.userId, localDate, ctx.timezone),
              ]);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ id: sessionId, ...result, dueTomorrow }) }],
                  structuredContent: { id: sessionId, updated_at: ctx.now.toISOString(), ...result, dueTomorrow },
                },
                summary: `finished session ${sessionId} -- ${result.totalReviews} review(s) this session, streak ${result.currentStreak}`,
              };
            },
          },
        },
      },
      lesson: {
        entity: "lesson",
        actions: {
          promote: {
            action: "promote",
            description:
              "Promote a lesson into a live 30-day experiment (the loop seam's FIRST write -- lesson_promotion.record_verdict is its second and last, recording the outcome of an EXISTING promotion this action creates). Genuinely distinct from record_verdict: promote CREATES a lesson_promotions row, record_verdict UPDATES one. No top-level id -- a new promotion every call.",
            patchShape: "{ lesson_id: string, accepted_text: string, area_id: string }",
            idempotent: false,
            idempotencyVerification:
              "promoteLessonCore (lib/promotions/actions-core.ts) INSERTs into lesson_promotions, guarded by lesson_promotions_active_per_lesson (one active promotion per lesson) -- a retry while the first is still active fails loudly (a clear, distinct message) rather than creating a second, duplicate experiment.",
            handler: async (ctx, patch) => {
              const lessonId = requireString(patch, "lesson_id");
              const acceptedText = requireString(patch, "accepted_text");
              const areaId = requireString(patch, "area_id");
              // Opus Lead ruling (P4-08, during PAUSE 3): promoteLessonCore
              // flattens its own pg-code branches into plain Error messages
              // BEFORE this handler ever sees them (pgCode is already
              // consumed inside the core), so there is no discriminator left
              // to key translation on except the message text itself -- a
              // small, explicit translation here, rather than retrofitting
              // promoteLessonCore's own throws (which stay plain Error, for
              // lib/promotions/actions.ts#promoteLesson's own ActionResult
              // translation). Every string below is copied verbatim from
              // that core's own throws -- if that file's wording ever
              // changes, this mapping silently stops firing rather than
              // mis-firing (falls through to the generic re-throw), so a
              // drift here fails safe, not loud-but-wrong.
              let result;
              try {
                result = await promoteLessonCore(ctx.userClient, ctx.userId, { lessonId, acceptedText, areaId });
              } catch (err) {
                const message = err instanceof Error ? err.message : null;
                if (message === "That area is no longer available. Pick another one.") {
                  throw new ToolNotFoundError(`No area found with id "${areaId}".`);
                }
                if (
                  message === "You're already testing this lesson. Give the current run its verdict first." ||
                  message === "Write what you're actually going to do — even one line." ||
                  message === "Choose which area of your life this belongs to."
                ) {
                  throw new ToolInputError(message);
                }
                // "That didn't save..." and the generic fallback stay
                // plain Error -- caller cannot self-correct either one.
                throw err;
              }
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { id: result.promotionId, updated_at: null, ...result },
                },
                summary: `promoted lesson ${lessonId} into a live experiment`,
              };
            },
          },
        },
      },
    },
  },
  // ---------------------------------------------------------------------
  // P4-07: daily rituals. review.night_plan_task gains write actions on an
  // entity that already has read coverage (lib/mcp/registry.ts). review.worry
  // and review.sleep_intent, and every entity under day/goals/habits below,
  // have NO read-registry counterpart at all yet -- a real discoverability
  // gap (list_capabilities can't advertise them), logged in the task's own
  // Plan/OPEN_QUESTIONS rather than fixed here (read coverage is a separate
  // task's scope). Every date-bearing handler here that isn't explicitly
  // noted otherwise requires patch.date -- P4-06's lesson: never duplicate
  // the default-to-today logic inline; register in
  // lib/agent-api/write-action-meta.ts's DATE_DEFAULTS_TO_TODAY instead.
  // ---------------------------------------------------------------------
  review: {
    domain: "review",
    entities: {
      night_plan_task: {
        entity: "night_plan_task",
        actions: {
          dump: {
            action: "dump",
            description: "Persist one dumped Night Plan line for tonight's (or today's, for a same-day replan) plan. Returns the new row's id so it can be starred/crowned via save_ranks.",
            patchShape: "{ title: string, mode?: 'tonight'|'today' }",
            idempotent: false,
            idempotencyVerification: "dumpLineCore does a plain INSERT -- a retry creates a second dumped line with the same title.",
            handler: async (ctx, patch) => {
              const title = requireString(patch, "title");
              const mode = patch.mode === undefined ? "tonight" : requireEnum(patch, "mode", ["tonight", "today"] as const);
              const plannedDate = planningDateForCore(mode as PlanMode, ctx.now, ctx.timezone);
              const result = await dumpLineCore(ctx.userClient, ctx.userId, plannedDate, title);
              if ("error" in result) throw new ToolInputError(result.error);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ ...result, planned_date: plannedDate }) }],
                  structuredContent: { id: result.id, updated_at: ctx.now.toISOString(), planned_date: plannedDate },
                },
                summary: `dumped "${title}" for ${plannedDate}`,
              };
            },
          },
          claim_seeds: {
            action: "claim_seeds",
            description: "Turn still-unclaimed seed lines (open worries or unfinished goal milestones/school-risk items shown in the dump) into real dumped lines. NOT atomic across seeds -- each is its own statement; a mid-batch failure is recoverable. Returns the seed-id -> real-task-id map (identity for worries, new ids for milestone/school_risk seeds).",
            patchShape: "{ seeds: { id: string, title: string, source: 'worry'|'goal_milestone'|'school_risk' }[], mode?: 'tonight'|'today' }",
            idempotent: false,
            idempotencyVerification: "claimSeedLinesCore mixes an UPDATE (worry seeds, naturally idempotent -- a re-claim matches 0 rows and is dropped, not erred) with a plain INSERT (goal_milestone/school_risk seeds, NOT idempotent -- a retry creates a duplicate dumped row). Any insert-shaped seed in the batch makes the whole call non-idempotent.",
            handler: async (ctx, patch) => {
              const seedsRaw = patch.seeds;
              if (!Array.isArray(seedsRaw) || seedsRaw.length === 0) {
                throw new ToolInputError("patch.seeds must be a non-empty array of { id, title, source }.");
              }
              const seeds: SeedLine[] = seedsRaw.map((raw, i) => {
                if (typeof raw !== "object" || raw === null) throw new ToolInputError(`patch.seeds[${i}] must be an object.`);
                const r = raw as Record<string, unknown>;
                if (typeof r.id !== "string" || !r.id) throw new ToolInputError(`patch.seeds[${i}].id is required.`);
                if (typeof r.title !== "string" || !r.title) throw new ToolInputError(`patch.seeds[${i}].title is required.`);
                const allowedSources: readonly SeedSource[] = ["worry", "goal_milestone", "school_risk"];
                if (typeof r.source !== "string" || !(allowedSources as readonly string[]).includes(r.source)) {
                  throw new ToolInputError(`patch.seeds[${i}].source must be one of: ${allowedSources.join(", ")}. Got: ${JSON.stringify(r.source)}.`);
                }
                return { id: r.id, title: r.title, source: r.source as SeedSource };
              });
              const mode = patch.mode === undefined ? "tonight" : requireEnum(patch, "mode", ["tonight", "today"] as const);
              const plannedDate = planningDateForCore(mode as PlanMode, ctx.now, ctx.timezone);
              const result = await claimSeedLinesCore(ctx.userClient, ctx.userId, plannedDate, seeds);
              if ("error" in result) throw new ToolInputError(result.error);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), claimed: result.claimed },
                },
                summary: `claimed ${result.claimed.length} of ${seeds.length} seed line(s) for ${plannedDate}`,
              };
            },
          },
          save_ranks: {
            action: "save_ranks",
            description: "Write the plan's star/crown ranks (clears this planned_date's stale ranks first, then upserts the computed ones in one statement). crowned must also be in starred, and at most 3 may be starred -- assignRanks enforces both.",
            patchShape: "{ starred: string[], crowned: string|null, mode?: 'tonight'|'today' }",
            idempotent: true,
            idempotencyVerification: "savePlanRanksCore clears mit_rank for this planned_date then upserts the SAME computed ranks from the patch's own starred/crowned -- a retry lands on the identical final state. The clear-then-upsert is two separate statements (the core's own header names this), so a crash strictly BETWEEN them is a real risk window, not that retries diverge from each other.",
            handler: async (ctx, patch) => {
              const starredRaw = patch.starred;
              if (!Array.isArray(starredRaw) || !starredRaw.every((s) => typeof s === "string")) {
                throw new ToolInputError("patch.starred must be an array of strings.");
              }
              const crownedRaw = patch.crowned;
              if (crownedRaw !== null && typeof crownedRaw !== "string") {
                throw new ToolInputError(`patch.crowned must be a string or null. Got: ${JSON.stringify(crownedRaw)}.`);
              }
              const mode = patch.mode === undefined ? "tonight" : requireEnum(patch, "mode", ["tonight", "today"] as const);
              const plannedDate = planningDateForCore(mode as PlanMode, ctx.now, ctx.timezone);
              const result = await savePlanRanksCore(ctx.userClient, ctx.userId, plannedDate, starredRaw, crownedRaw);
              if ("error" in result) throw new ToolInputError(result.error);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ ok: true, planned_date: plannedDate }) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), planned_date: plannedDate },
                },
                summary: `saved plan ranks for ${plannedDate} (${starredRaw.length} starred${crownedRaw ? ", 1 crowned" : ""})`,
              };
            },
          },
        },
      },
      worry: {
        entity: "worry",
        actions: {
          set_handled: {
            action: "set_handled",
            description: "Mark a worry handled. SET, not toggle. Scoped to dump_source='worry' as defense in depth -- can never mark an ordinary task 'handled' by accident. Requires the top-level id.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "markWorryHandledCore sets a fixed value (completed:true) after an existence check -- a retry sets the identical value (completed_at does advance, same benign-timestamp reasoning as deen.prayer.log).",
            handler: async (ctx) => {
              const id = requireId(ctx);
              const result = await markWorryHandledCore(ctx.userClient, ctx.userId, id);
              if (!result.ok) throw new ToolNotFoundError(result.error);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, handled: true }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), handled: true } },
                summary: `marked worry ${id} handled`,
              };
            },
          },
          reopen: {
            action: "reopen",
            description: "Reopen a handled worry -- clears completed, completed_at, and worry_outcome (a stale outcome on a reopened worry would misinform the next Anti-Worry Hour session). Requires the top-level id.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "reopenWorryCore sets fixed values after an existence check -- a retry sets the identical values.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              const result = await reopenWorryCore(ctx.userClient, ctx.userId, id);
              if (!result.ok) throw new ToolNotFoundError(result.error);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, handled: false }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), handled: false } },
                summary: `reopened worry ${id}`,
              };
            },
          },
        },
      },
      sleep_intent: {
        entity: "sleep_intent",
        actions: {
          set: {
            action: "set",
            description: "Set tonight's intended bedtime (HH:MM, 24-hour). Upserts on (user_id, today's local date).",
            patchShape: "{ time: string }",
            idempotent: true,
            idempotencyVerification: "saveSleepIntentCore upserts on (user_id,intent_date) with the time taken verbatim from the patch -- a retry upserts the identical value.",
            handler: async (ctx, patch) => {
              const time = requireString(patch, "time");
              const dateStr = localDateString(ctx.now, ctx.timezone);
              const result = await saveSleepIntentCore(ctx.userClient, ctx.userId, dateStr, time);
              if (!result.ok) throw new ToolInputError(result.message);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ date: dateStr, time }) }], structuredContent: { updated_at: ctx.now.toISOString(), date: dateStr, time } },
                summary: `set sleep intent for ${dateStr} to ${time}`,
              };
            },
          },
          clear: {
            action: "clear",
            description: "Clear tonight's intended bedtime, if one was set.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "clearSleepIntentCore deletes matching (user_id,intent_date) -- 0 rows on retry is a no-op, same value either way.",
            handler: async (ctx) => {
              const dateStr = localDateString(ctx.now, ctx.timezone);
              const result = await clearSleepIntentCore(ctx.userClient, ctx.userId, dateStr);
              if (!result.ok) throw new ToolInputError(result.message);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ date: dateStr }) }], structuredContent: { updated_at: ctx.now.toISOString(), date: dateStr } },
                summary: `cleared sleep intent for ${dateStr}`,
              };
            },
          },
        },
      },
    },
  },
  day: {
    domain: "day",
    entities: {
      day_start: {
        entity: "day_start",
        actions: {
          start: {
            action: "start",
            description: "Mark today's day as started (the morning open's one write). Idempotent by a real DB unique key (user_id, local_date) -- tapping/calling twice the same local day never creates a second mark or moves the first one's woke_at.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "markDayStarted (lib/day-structure/day-start.ts) upserts with ignoreDuplicates:true on the DB's own unique(user_id,local_date) constraint -- a retry is a true INSERT...ON CONFLICT DO NOTHING no-op, not merely one this code happens to tolerate.",
            handler: async (ctx) => {
              const result = await markDayStarted(ctx.userClient, ctx.userId, ctx.timezone, ctx.now);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), local_date: result.localDate, woke_at: result.wokeAtIso },
                },
                summary: `started day ${result.localDate}`,
              };
            },
          },
        },
      },
      // P3-01: nested under `day`, not a new top-level domain -- the
      // source inventory groups "Start Day tap" and "Morning Routine
      // checklist" together under one Day Structure ritual. Named
      // `routine_item` (P4-31) -- P3-01 originally shipped this as the
      // terser `item` only to fit the account-map's then-800-token wire
      // budget; P4-31 raised that budget deliberately and restored the
      // clearer name, since `item` alone (unlike `task`, `vote`, `goal`)
      // doesn't say what it's an item OF without the domain name doing
      // all the work.
      routine_item: {
        entity: "routine_item",
        actions: {
          create: {
            action: "create",
            description: "Create a morning routine checklist item (up to a soft ceiling of MAX_ROUTINE_ITEMS active items -- an app-code pre-check, not a DB-enforced scarcity index, since a checklist has no rank/slot the way identity habits do).",
            patchShape: "{ label: string }",
            idempotent: false,
            idempotencyVerification: "createMorningRoutineItemCore does a plain INSERT -- a retry creates a SECOND item with the same label, not a no-op.",
            handler: async (ctx, patch) => {
              const label = requireString(patch, "label");
              const result = await createMorningRoutineItemCore(ctx.userClient, ctx.userId, label);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `created morning routine item "${label}"`,
              };
            },
          },
          archive: {
            action: "archive",
            description: "Archive a morning routine item -- NEVER a hard delete, so past checks survive. Scoped to archived_at IS NULL in the core: archiving an already-archived or foreign id is a DELIBERATE no-op (0 rows, not an error), same reasoning as habits.identity_habit.archive. Requires the top-level id.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "archiveMorningRoutineItemCore scopes its UPDATE to archived_at IS NULL -- once archived, a retry matches 0 rows and leaves the already-archived state untouched.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              await archiveMorningRoutineItemCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, archived: true }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), archived: true } },
                summary: `archived morning routine item ${id}`,
              };
            },
          },
          check: {
            action: "check",
            description: "Check off a routine item for the caller's own local today. Checks may only be applied to today -- missing date defaults to today; an explicit date that isn't today is rejected server-side. A cross-tenant item_id is rejected by the database's composite tenancy FK, surfaced as a clean not-found. Requires the top-level id (the item).",
            patchShape: "{ date?: string }",
            idempotent: true,
            idempotencyVerification: "checkMorningRoutineItemCore upserts with ignoreDuplicates:true on the DB's own one-check-per-item-per-day unique constraint -- explicitly race-proof, not merely tolerant of a retry.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const date = requireString(patch, "date");
              try {
                await checkMorningRoutineItemCore(ctx.userClient, ctx.userId, id, date, ctx.now, ctx.timezone);
              } catch (err) {
                if (pgCode(err) === FK_VIOLATION) throw new ToolNotFoundError(`No morning routine item found with id "${id}".`);
                throw err;
              }
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, date, checked: true }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), date, checked: true } },
                summary: `checked off routine item ${id} for ${date}`,
              };
            },
          },
          uncheck: {
            action: "uncheck",
            description: "Uncheck today's check for a routine item, if one exists (undo-shaped -- deletes only today's own check row, never the item itself). Same today-only restriction as check. Requires the top-level id (the item).",
            patchShape: "{ date?: string }",
            idempotent: true,
            idempotencyVerification: "uncheckMorningRoutineItemCore deletes matching (user_id,item_id,checked_date) -- 0 rows on retry (nothing to uncheck, or already unchecked) is a no-op, same SET-not-toggle reasoning as check.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const date = requireString(patch, "date");
              try {
                await uncheckMorningRoutineItemCore(ctx.userClient, ctx.userId, id, date, ctx.now, ctx.timezone);
              } catch (err) {
                if (pgCode(err) === FK_VIOLATION) throw new ToolNotFoundError(`No morning routine item found with id "${id}".`);
                throw err;
              }
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, date, checked: false }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), date, checked: false } },
                summary: `unchecked routine item ${id} for ${date}`,
              };
            },
          },
        },
      },
    },
  },
  goals: {
    domain: "goals",
    entities: {
      goal: {
        entity: "goal",
        actions: {
          create: {
            action: "create",
            description: "Create a goal for a month, at an explicit rank 1-5. The 5-per-month ceiling is enforced by the database (goals_rank_per_month_idx, partial unique on status='active') -- a rank collision surfaces as a real Postgres error, not a pre-check here.",
            patchShape: "{ month_start: string, title: string, reason: string, rank: 1|2|3|4|5, domain?: string|null }",
            idempotent: false,
            idempotencyVerification: "createGoal does a plain INSERT -- a retry attempts a SECOND goal at the same rank, which the database's own unique index rejects (not silently accepted, but also not a clean no-op retry).",
            handler: async (ctx, patch) => {
              const monthStart = requireString(patch, "month_start");
              const title = requireString(patch, "title");
              const reason = requireString(patch, "reason");
              const rank = requireNumberEnum(patch, "rank", [1, 2, 3, 4, 5] as const);
              const domainField = optionalNullableString(patch, "domain") ?? null;
              const result = await createGoal(ctx.userClient, ctx.userId, { monthStart, title, reason, rank, domain: domainField });
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `created goal "${title}" for ${monthStart} at rank ${rank}`,
              };
            },
          },
          set_status: {
            action: "set_status",
            description: "Mark a goal done or dropped (there is no path back to 'active' -- completing/dropping releases its rank for the month). Scoped to status='active' in the core: completing/dropping an already-resolved goal is a DELIBERATE no-op (0 rows, not an error) -- already-resolved and doesn't-exist are indistinguishable by this design, so this action does NOT throw not-found. Requires the top-level id.",
            patchShape: "{ status: 'done'|'dropped' }",
            idempotent: true,
            idempotencyVerification: "completeGoal/dropGoal scope their UPDATE to status='active' -- once transitioned, a retry matches 0 rows and leaves the already-set state untouched. Same end state regardless of retry count.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const status = requireEnum(patch, "status", ["done", "dropped"] as const);
              if (status === "done") await completeGoal(ctx.userClient, ctx.userId, id);
              else await dropGoal(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, status }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), status } },
                summary: `set goal ${id} to ${status}`,
              };
            },
          },
        },
      },
      milestone: {
        entity: "milestone",
        actions: {
          add: {
            action: "add",
            description: "Add a milestone to a goal. month_start is the goal's own month, passed explicitly (denormalised onto this table by design, see addMilestone's own header) -- not re-derived from the goal here. A cross-tenant goal_id is rejected by the database's own composite tenancy FK (migration 165), surfaced as a clean not-found rather than a raw constraint error.",
            patchShape: "{ goal_id: string, month_start: string, title: string }",
            idempotent: false,
            idempotencyVerification: "addMilestone does a plain INSERT -- a retry creates a second milestone with the same title.",
            handler: async (ctx, patch) => {
              const goalId = requireString(patch, "goal_id");
              const monthStart = requireString(patch, "month_start");
              const title = requireString(patch, "title");
              try {
                const result = await addMilestone(ctx.userClient, ctx.userId, { goalId, monthStart, title });
                return {
                  result: {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                    structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                  },
                  summary: `added milestone "${title}" to goal ${goalId}`,
                };
              } catch (err) {
                if (pgCode(err) === FK_VIOLATION) throw new ToolNotFoundError(`No goal found with id "${goalId}".`);
                throw err;
              }
            },
          },
          set_done: {
            action: "set_done",
            description: "Set (not toggle) a milestone's done state. Unlike goal.set_status, this core has NO status scoping -- 0 rows unambiguously means the milestone doesn't exist for this user, so this DOES throw not-found (checked explicitly here, since completeMilestone/reopenMilestone don't report rows-affected themselves). Requires the top-level id.",
            patchShape: "{ done: boolean }",
            idempotent: true,
            idempotencyVerification: "completeMilestone sets done_at=now() (advances like logged_at on deen.prayer.log -- benign, never read as this entity's real-world state beyond set/unset); reopenMilestone sets done_at=null, stable on retry.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const done = requireBoolean(patch, "done");
              const { data: existing, error: existErr } = await ctx.userClient.from("goal_milestones").select("id").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
              if (existErr) throw existErr;
              if (!existing) throw new ToolNotFoundError(`No milestone found with id "${id}".`);
              if (done) await completeMilestone(ctx.userClient, ctx.userId, id);
              else await reopenMilestone(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, done }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), done } },
                summary: `set milestone ${id} done to ${done}`,
              };
            },
          },
        },
      },
    },
  },
  habits: {
    domain: "habits",
    entities: {
      identity_habit: {
        entity: "identity_habit",
        actions: {
          create: {
            action: "create",
            description: "Create an identity habit, auto-assigned the lowest free rank (an internal slot number, up to MAX_ACTIVE_HABITS -- not a user-facing priority order). The ceiling is enforced by the database's own partial unique index, not this action's pre-check.",
            patchShape: "{ identity_statement: string }",
            idempotent: false,
            idempotencyVerification: "createIdentityHabitCore does a plain INSERT into the next free rank -- a retry finds a DIFFERENT free rank and creates a SECOND habit, not a no-op.",
            handler: async (ctx, patch) => {
              const identityStatement = requireString(patch, "identity_statement");
              const result = await createIdentityHabitCore(ctx.userClient, ctx.userId, identityStatement);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `created identity habit "${identityStatement}"`,
              };
            },
          },
          archive: {
            action: "archive",
            description: "Soft-archive an identity habit, releasing its rank. Scoped to status='active' in the core: archiving an already-archived or foreign id is a DELIBERATE no-op (0 rows, not an error), same reasoning as goals.goal.set_status -- this does NOT throw not-found. Requires the top-level id.",
            patchShape: "{}",
            idempotent: true,
            idempotencyVerification: "archiveIdentityHabitCore scopes its UPDATE to status='active' -- once archived, a retry matches 0 rows and leaves the already-archived state untouched.",
            handler: async (ctx) => {
              const id = requireId(ctx);
              await archiveIdentityHabitCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, archived: true }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), archived: true } },
                summary: `archived identity habit ${id}`,
              };
            },
          },
        },
      },
      vote: {
        entity: "vote",
        actions: {
          cast: {
            action: "cast",
            description: "Cast (affirm) a vote for a habit. Votes may only be cast for the caller's own local today -- missing date defaults to today; an explicit date that isn't today is rejected server-side. A cross-tenant habit_id is rejected by the database's composite tenancy FK, surfaced as a clean not-found. Requires the top-level id (the habit).",
            patchShape: "{ date?: string }",
            idempotent: true,
            idempotencyVerification: "castHabitVoteCore upserts with ignoreDuplicates:true on the DB's own one-vote-per-day unique constraint -- explicitly race-proof per the core's own header, not merely tolerant of a retry.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const date = requireString(patch, "date");
              try {
                await castHabitVoteCore(ctx.userClient, ctx.userId, id, date, ctx.now, ctx.timezone);
              } catch (err) {
                if (pgCode(err) === FK_VIOLATION) throw new ToolNotFoundError(`No identity habit found with id "${id}".`);
                throw err;
              }
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, date, voted: true }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), date, voted: true } },
                summary: `cast today's vote for habit ${id}`,
              };
            },
          },
          retract: {
            action: "retract",
            description: "Retract today's vote for a habit, if one exists. Same today-only restriction as cast. Requires the top-level id (the habit).",
            patchShape: "{ date?: string }",
            idempotent: true,
            idempotencyVerification: "retractHabitVoteCore deletes matching (user_id,habit_id,date) -- 0 rows on retry (nothing to retract, or already retracted) is a no-op, same SET-not-toggle reasoning as castHabitVoteCore.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const date = requireString(patch, "date");
              try {
                await retractHabitVoteCore(ctx.userClient, ctx.userId, id, date, ctx.now, ctx.timezone);
              } catch (err) {
                if (pgCode(err) === FK_VIOLATION) throw new ToolNotFoundError(`No identity habit found with id "${id}".`);
                throw err;
              }
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, date, voted: false }) }], structuredContent: { id, updated_at: ctx.now.toISOString(), date, voted: false } },
                summary: `retracted today's vote for habit ${id}`,
              };
            },
          },
        },
      },
    },
  },
};

export function getWriteAction(domain: string, entity: string, action: string): WriteActionDef | null {
  return WRITE_REGISTRY[domain]?.entities[entity]?.actions[action] ?? null;
}

export function listWriteActions(domain: string, entity: string): string[] {
  const entityDef = WRITE_REGISTRY[domain]?.entities[entity];
  return entityDef ? Object.keys(entityDef.actions) : [];
}

export function listWriteEntities(domain: string): string[] {
  return Object.keys(WRITE_REGISTRY[domain]?.entities ?? {});
}
