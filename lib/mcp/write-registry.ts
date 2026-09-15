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
import { addTargetCore, addStretchGoalCore, editTargetCore, completeTargetCore, moveTargetCore } from "@/lib/coop/targets-core";
import { addAgendaTaskCore, editTaskCore, advanceTaskCore, retreatTaskCore, blockTaskCore, unblockTaskCore } from "@/lib/coop/tasks-core";
import { setKillListItemCore, toggleKillListItemCore, saveBusinessWeeklyGoalCore, startWorkSessionCore, endWorkSessionCore } from "@/lib/business/actions-core";
import { addTaskCore, updateTaskCore, toggleTaskCore, updateScheduleEventCore, setScheduleEventOverrideCore, cancelScheduleOccurrenceCore } from "@/lib/tasks/actions-core";
import { createClassCore, updateClassCore, addClassAssessmentCore, updateClassAssessmentCore, ASSESSMENT_TYPES } from "@/lib/school/actions-core";
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
import { recordVerdictCore } from "@/lib/promotions/actions-core";
import type { RunMcpToolOutcome } from "./tool-wrapper";
import { ToolInputError } from "./tool-input-error";

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

async function assertRowDomain(userClient: SupabaseClient, table: "tasks" | "schedule_events", id: string, userId: string, domain: "school" | "co_op"): Promise<void> {
  const { data, error } = await userClient.from(table).select("domain").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No ${table} row found with id "${id}" for this user.`);
  if (data.domain !== domain) {
    throw new Error(`id "${id}" belongs to domain "${data.domain ?? "none"}", not "${domain}" — refusing to write across the domain boundary.`);
  }
}

const TASK_TYPES = ["homework_assignment", "reading_review", "quiz", "exam", "final_midterm", "project_paper", "reminder", "other"] as const;
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
            description: "Full-replace edit of a school task's contents. Requires the top-level id.",
            patchShape: "{ title: string, due_date?: string, task_type?: TaskType, task_type_other_label?: string, class_id?: string|null }",
            idempotent: true,
            idempotencyVerification: "updateTaskCore (lib/tasks/actions-core.ts) UPDATEs to the exact given values -- a retry writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await assertRowDomain(ctx.userClient, "tasks", id, ctx.userId, "school");
              const title = requireString(patch, "title");
              const dueDate = optionalString(patch, "due_date");
              const taskType = patch.task_type === undefined ? undefined : requireEnum(patch, "task_type", TASK_TYPES);
              const taskTypeOtherLabel = optionalString(patch, "task_type_other_label");
              const classId = optionalNullableString(patch, "class_id");
              await updateTaskCore(ctx.userClient, ctx.userId, id, { title, dueDate, taskType, taskTypeOtherLabel, classId });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited school task ${id}`,
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
            description: "Create a class.",
            patchShape: "{ code: string, short_name?: string, room?: string, instructor?: string }",
            idempotent: false,
            idempotencyVerification: "createClassCore (lib/school/actions-core.ts) plain INSERT with a freshly-computed position (max+1) -- a retry creates a second, duplicate class, at a different position since the first insert already advanced the max.",
            handler: async (ctx, patch) => {
              const code = requireString(patch, "code");
              const shortName = optionalString(patch, "short_name");
              const room = optionalString(patch, "room");
              const instructor = optionalString(patch, "instructor");
              const id = await createClassCore(ctx.userClient, ctx.userId, { code, shortName, room, instructor });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `created class "${code}"`,
              };
            },
          },
          edit: {
            action: "edit",
            description: "Edit a class's short_name/room/instructor. Requires the top-level id.",
            patchShape: "{ short_name?: string|null, room?: string|null, instructor?: string|null }",
            idempotent: true,
            idempotencyVerification: "updateClassCore (lib/school/actions-core.ts) UPDATEs to the exact given values -- a retry writes the identical row.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await updateClassCore(ctx.userClient, ctx.userId, id, {
                shortName: optionalNullableString(patch, "short_name"),
                room: optionalNullableString(patch, "room"),
                instructor: optionalNullableString(patch, "instructor"),
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
            description: "Edit an assessment's name/type/date/weight, syncing its linked task's title/due_date. Requires the top-level id.",
            patchShape: "{ name: string, type: 'quiz'|'exam'|'final_midterm'|'homework_assignment'|'project_paper', date: string, weight_pct?: number|null }",
            idempotent: true,
            idempotencyVerification: "updateClassAssessmentCore (lib/school/actions-core.ts) UPDATEs the assessment and its linked task to the exact given values -- a retry writes the identical rows.",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const name = requireString(patch, "name");
              const type = requireEnum(patch, "type", ASSESSMENT_TYPES);
              const date = requireString(patch, "date");
              const weightPct = optionalNullableNumber(patch, "weight_pct");
              await updateClassAssessmentCore(ctx.userClient, ctx.userId, id, { name, type, date, weightPct });
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
              const result = await recordVerdictCore(ctx.userClient, ctx.userId, { promotionId, verdict, reason });
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
