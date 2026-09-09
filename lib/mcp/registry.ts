import "server-only";

/**
 * The internal dispatch table Eng2's TOOL-ARCHITECTURE.md (§3, §5) calls for:
 * the single source of truth `list_capabilities` describes and `read`
 * dispatches against. L3 populates exactly one domain (`deen`) with exactly
 * one entity (`prayer`) — "the dispatch table matters more than the
 * coverage; L5 fans it out" (team-lead). Adding a second entity, or a
 * second domain, is adding another object to these maps, never a new code
 * path — that extensibility IS the proof this architecture works, not
 * something to demonstrate by rushing more entities in before each one's
 * been checked the way `prayer` was below.
 *
 * EVERY ENTITY'S COLUMN LISTS ARE A VISIBILITY REGISTRY, not a convenience
 * projection (memo §3): `detail`/`fields` narrow within `fullColumns`, they
 * never widen past it. A column absent from `fullColumns` is not reachable
 * by this entity no matter what the caller asks for — that is the
 * mechanism that keeps e.g. a future `user_api_keys` entity's
 * `encrypted_key` off MCP without trusting every future caller to remember
 * to ask nicely.
 */

export interface EntityDef {
  /** The entity name as used in `read(domain, entity, ...)` — e.g. "prayer". */
  entity: string;
  table: string;
  description: string;
  idColumn: string;
  /**
   * The REAL "last modified" source for this row, or `null` when the
   * table genuinely has no such column and none should be invented.
   *
   * FOUND DURING THIS BUILD, NOT ASSUMED: TOOL-ARCHITECTURE.md's "`updated_at`
   * on every entity, no exceptions" is a design rule, not yet a fact about
   * the schema — grepped the full baseline + every migration and found
   * a genuine, trigger-maintained `updated_at` on exactly ONE table in the
   * entire 68-table schema (`ingestion_jobs`, migration 074's
   * `touch_updated_at()` trigger). None of `deen`'s 8 tables has one.
   * `prayers.logged_at` is used here as `prayer`'s stand-in ONLY because it
   * was verified, not assumed, to be a faithful proxy: `markPrayer`
   * (app/(app)/deen/actions.ts) is the table's ONLY write path and sets
   * `logged_at` on every upsert; `unmarkPrayer` deletes the row outright
   * rather than leaving a stale one. A future entity must not copy this
   * column name by pattern-matching — it must be verified the same way,
   * table by table, or left `null` here honestly. A fabricated
   * `updated_at` would silently break `detail:"ids"`'s entire reuse
   * promise (a row that changed would read as unchanged forever), which is
   * a worse failure than admitting the column doesn't exist.
   */
  updatedAtColumn: string | null;
  /**
   * team-lead's ruling on the finding above: "the registry declares an
   * explicit `updatedAtColumn` per entity, and it must be verified against
   * that table's real write paths — never inferred from a name... put a
   * one-line note in the registry entry recording HOW it was verified, so
   * the next person doesn't have to redo it." This is that note — one
   * sentence, naming the actual write path(s) checked, not a restatement
   * of the column name.
   */
  updatedAtVerification: string;
  /** Returned at `detail:"summary"` (plus id/updated_at, always forced — see readTool). */
  summaryColumns: string[];
  /** Returned at `detail:"full"` — the maximal projection this entity will EVER return, including to `fields`. Must be a superset of summaryColumns. */
  fullColumns: string[];
  /** Columns `filter` may reference. Never `fullColumns` by default — an allowlist, so a caller can't filter on a column that isn't even selectable. */
  filterableColumns: string[];
  /** Default sort, applied for deterministic pagination. Always includes the id column as a tiebreaker. */
  orderBy: { column: string; ascending: boolean }[];
  /**
   * Applied to EVERY query for this entity, in addition to `user_id` and
   * any caller-supplied `filter` — never overridable by the caller. Exists
   * for a table shared by more than one MCP entity: `weekly_goals` backs
   * both a (future) `deen.weekly_goal` and `business.weekly_goal`, keyed
   * apart by its own `domain` column. Without a fixed filter, exposing
   * `domain` as a normal filterable field would let a caller read/write
   * the OTHER entity's rows through this one's name — the same shape of
   * mistake the visibility registry (memo §3) exists to prevent for
   * columns, just applied to rows instead.
   */
  fixedFilter?: Record<string, string>;
}

export interface DomainDef {
  domain: string;
  description: string;
  entities: Record<string, EntityDef>;
}

export const REGISTRY: Record<string, DomainDef> = {
  deen: {
    domain: "deen",
    description: "Prayer tracking and related worship habits.",
    entities: {
      prayer: {
        entity: "prayer",
        table: "prayers",
        description: "One prayer's logged status for one date (fajr/dhuhr/asr/maghrib/isha; on_time/qada/missed/pending).",
        idColumn: "id",
        updatedAtColumn: "logged_at",
        updatedAtVerification:
          "markPrayer (app/(app)/deen/actions.ts) is the table's ONLY write path and sets logged_at on every upsert; unmarkPrayer deletes the row outright rather than leaving a stale one.",
        summaryColumns: ["date", "prayer_name", "status"],
        fullColumns: ["date", "prayer_name", "status", "logged_at", "user_id"],
        filterableColumns: ["date", "prayer_name", "status"],
        orderBy: [
          { column: "date", ascending: false },
          { column: "prayer_name", ascending: true },
        ],
      },
      sunnah_log: {
        entity: "sunnah_log",
        table: "sunnah_logs",
        description: "One rawatib (voluntary prayer) slot's completion for one date/prayer.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "toggleSunnah (app/(app)/deen/actions.ts) upserts `completed` on an existing row without touching created_at, which would go stale on a second toggle -- migration 133 adds a real trigger-backed updated_at for exactly this reason; verified NOT faithfully served by created_at before adding it.",
        summaryColumns: ["date", "prayer_name", "slot", "completed"],
        fullColumns: ["date", "prayer_name", "slot", "completed", "created_at", "user_id"],
        filterableColumns: ["date", "prayer_name", "slot", "completed"],
        orderBy: [
          { column: "date", ascending: false },
          { column: "prayer_name", ascending: true },
        ],
      },
      adhkar: {
        entity: "adhkar",
        table: "adhkar_logs",
        description: "Morning/evening dhikr completion for one date.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "toggleAdhkar (app/(app)/deen/actions.ts) upserts `completed` on an existing row; the table had NO created_at or any timestamp at all before migration 133 added a real trigger-backed updated_at.",
        summaryColumns: ["date", "period", "completed"],
        fullColumns: ["date", "period", "completed", "user_id"],
        filterableColumns: ["date", "period", "completed"],
        orderBy: [
          { column: "date", ascending: false },
          { column: "period", ascending: true },
        ],
      },
      quran_session: {
        entity: "quran_session",
        table: "quran_sessions",
        description: "One logged Qur'an reading session.",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "logQuranSession (app/(app)/deen/actions.ts) only ever INSERTs -- no update or delete path for this table exists anywhere in actions.ts -- so created_at IS the true last-modified time; deliberately no new column added (team-lead's ruling: append-only tables are legitimately served by created_at).",
        summaryColumns: ["date", "pages_read", "surah", "juz"],
        fullColumns: ["date", "pages_read", "surah", "juz", "created_at", "user_id"],
        filterableColumns: ["date"],
        orderBy: [{ column: "date", ascending: false }],
      },
      reflection_entry: {
        entity: "reflection_entry",
        table: "reflection_entries",
        description: "One tally of a logged self-reflection, tier 1-3.",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "logReflectionEntry inserts; decrementReflectionEntry (both app/(app)/deen/actions.ts) deletes the single most recent row of a tier -- no row is ever UPDATEd in place, so created_at IS the true last-modified time; no new column added, same append-only reasoning as quran_session.",
        summaryColumns: ["date", "tier"],
        fullColumns: ["date", "tier", "created_at", "user_id"],
        filterableColumns: ["date", "tier"],
        orderBy: [
          { column: "date", ascending: false },
          { column: "created_at", ascending: false },
        ],
      },
      habit: {
        entity: "habit",
        table: "deen_habits",
        description: "A committed worship habit being built (name, cue, stage).",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "updateDeenHabit, archiveDeenHabit, setDeenHabitStageOverride, and setDeenHabitCommittedDate (all app/(app)/deen/actions.ts) each UPDATE an existing row post-creation -- created_at would go stale on the very first edit; migration 133 adds a real trigger-backed updated_at.",
        summaryColumns: ["name", "committed_date", "archived"],
        fullColumns: ["name", "committed_date", "archived", "anchor_cue", "commitment_note", "stage_override", "created_at", "user_id"],
        filterableColumns: ["archived"],
        orderBy: [
          { column: "committed_date", ascending: false },
          { column: "name", ascending: true },
        ],
      },
      habit_log: {
        entity: "habit_log",
        table: "deen_habit_logs",
        description: "One day's completion record for one habit.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "toggleDeenHabitLog and setDeenHabitLogStatus (both app/(app)/deen/actions.ts) upsert `completed` on an existing (habit_id,date) row; the table had no created_at at all before migration 133 added a real trigger-backed updated_at.",
        summaryColumns: ["habit_id", "date", "completed"],
        fullColumns: ["habit_id", "date", "completed", "user_id"],
        filterableColumns: ["habit_id", "date", "completed"],
        orderBy: [{ column: "date", ascending: false }],
      },
      weekly_focus: {
        entity: "weekly_focus",
        table: "deen_weekly_focus",
        description: "Which habit is this week's focus.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "setWeeklyFocus (app/(app)/deen/actions.ts) upserts `habit_id` on (user_id,week_start_date) conflict, which can genuinely replace a week's focus habit without touching created_at; migration 133 adds a real trigger-backed updated_at.",
        summaryColumns: ["week_start_date", "habit_id"],
        fullColumns: ["week_start_date", "habit_id", "created_at", "user_id"],
        filterableColumns: ["week_start_date"],
        orderBy: [{ column: "week_start_date", ascending: false }],
      },
    },
  },
  work: {
    domain: "work",
    description: "The Work Targets strip and its task pipeline, plus deep-work/deep-study sessions.",
    entities: {
      target: {
        entity: "target",
        table: "coop_targets",
        description: "One of the (at most 3) active targets or any number of stretch goals on the Work strip. position <= 3 means target, > 3 means stretch goal.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Migration 135 (applied, verified on production by the lead -- a stale 2000-01-01 value was overwritten to today) added a real trigger-backed updated_at to coop_targets, reusing migration 074's touch_updated_at(), after editTarget/completeTarget/moveTarget (app/(app)/work/targets-actions.ts) were found to all UPDATE an existing row with completed_at reflecting only completion, never edits or reordering.",
        summaryColumns: ["title", "deadline", "status", "position"],
        fullColumns: ["title", "deadline", "status", "position", "completed_at", "created_at", "updated_at", "user_id"],
        filterableColumns: ["status"],
        orderBy: [{ column: "position", ascending: true }],
      },
      task: {
        entity: "task",
        table: "coop_tasks",
        description: "One task on a target's pipeline (backlog/in_progress/review/complete/blocked).",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Migration 135 (applied, verified on production by the lead) added a real trigger-backed updated_at to coop_tasks, reusing migration 074's touch_updated_at(), after editTask/advanceTask/retreatTask/blockTask/unblockTask (app/(app)/work/tasks-actions.ts) were found to all UPDATE an existing row with completed_at reflecting only the complete/not-complete transition, never every status change or a title/deadline edit.",
        summaryColumns: ["target_id", "title", "deadline", "status", "blocked_from"],
        fullColumns: ["target_id", "title", "deadline", "status", "blocked_from", "completed_at", "created_at", "updated_at", "user_id"],
        filterableColumns: ["target_id", "status"],
        orderBy: [{ column: "created_at", ascending: false }],
      },
      work_session: {
        entity: "work_session",
        table: "work_sessions",
        description: "One deep-work or deep-study session (Lock-In). At most one active (ended_at IS NULL) session per user, enforced at the write layer, not the schema.",
        idColumn: "id",
        updatedAtColumn: "ended_at",
        updatedAtVerification:
          "startWorkSession/endWorkSession (app/(app)/business/actions.ts -- work_sessions is filed under the /business route but is the work-domain entity per the owner's own table list) are the table's only writes: insert on start, one UPDATE on end setting ended_at, never re-set. ended_at is therefore a real, faithful last-modified signal -- null while active is honest (still in progress), not fabricated. created_at/started_at cover the create-time case for detail tiers that include them.",
        summaryColumns: ["kind", "started_at", "ended_at"],
        fullColumns: ["kind", "started_at", "ended_at", "created_at", "counts_toward_hours", "user_id"],
        filterableColumns: ["kind"],
        orderBy: [{ column: "started_at", ascending: false }],
      },
    },
  },
  business: {
    domain: "business",
    description: "The daily kill list and business-domain weekly goals.",
    entities: {
      kill_list_item: {
        entity: "kill_list_item",
        table: "kill_list_items",
        description: "One of a day's (up to 3) kill-list items, by fixed slot 0/1/2 -- not a freely orderable list (see work.target for the entity with real reordering).",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Migration 135 (applied, verified on production by the lead) added a real trigger-backed updated_at to kill_list_items, reusing migration 074's touch_updated_at(), after setKillListItem/toggleKillListItem (app/(app)/business/actions.ts) were found to leave completed_at reflecting only the completion toggle, never a text edit to an existing slot.",
        summaryColumns: ["date", "position", "text", "completed"],
        fullColumns: ["date", "position", "text", "completed", "completed_at", "created_at", "updated_at", "user_id"],
        filterableColumns: ["date", "position", "completed"],
        orderBy: [
          { column: "date", ascending: false },
          { column: "position", ascending: true },
        ],
      },
      weekly_goal: {
        entity: "weekly_goal",
        table: "weekly_goals",
        description: "One week's business-domain goal (headline + milestones). weekly_goals is shared with `deen`'s own weekly goals via its `domain` column -- fixedFilter keeps this entity strictly to domain='business' rows, never exposing `domain` as a settable/filterable field a caller could widen.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Migration 135 (applied, verified on production by the lead) added a real trigger-backed updated_at to weekly_goals, reusing migration 074's touch_updated_at(), after saveBusinessWeeklyGoal (app/(app)/business/actions.ts) was found to upsert on (user_id,week_start_date,domain) conflict -- which can overwrite headline/milestones on an existing row -- with no other timestamp on the table to reflect it.",
        summaryColumns: ["week_start_date", "headline", "milestones", "locked"],
        fullColumns: ["week_start_date", "headline", "milestones", "locked", "quran_page_target", "created_at", "updated_at", "user_id"],
        filterableColumns: ["week_start_date", "locked"],
        orderBy: [{ column: "week_start_date", ascending: false }],
        fixedFilter: { domain: "business" },
      },
    },
  },
  school: {
    domain: "school",
    description:
      "Classes, their assessments, the class schedule (and its per-occurrence overrides/cancellations), and school-owned tasks. " +
      "`schedule_event_overrides`/`schedule_event_cancellations` are deliberately NOT registered as their own read entities here " +
      "(see the long comment on `schedule_event` below) -- they remain reachable only through `write`'s schedule_event actions.",
    entities: {
      task: {
        entity: "task",
        table: "tasks",
        description:
          "A school task/assignment/reminder. `tasks` is shared with `co_op` (and, for a Night Plan dump item, domain=NULL, migration 119) -- fixedFilter keeps this entity strictly to domain='school' rows.",
        idColumn: "id",
        updatedAtColumn: null, // needs migration -- see docs/ai-connector/SCHOOL-UPDATED-AT-NEEDED.md
        updatedAtVerification:
          "Checked every write path: updateTaskCore updates title/due_date/task_type/class_id; toggleTaskCore updates completed/completed_at; updateClassAssessmentCore's task-sync step updates a linked task's title/due_date/task_type. completed_at only reflects the complete/not-complete transition (same gap migration 135 fixed for coop_tasks), and no other column is a faithful last-modified proxy -- honestly null until a real trigger-backed updated_at lands.",
        summaryColumns: ["title", "due_date", "task_type", "completed", "class_id"],
        fullColumns: ["title", "due_date", "due_time", "task_type", "task_type_other_label", "completed", "completed_at", "class_id", "created_at", "user_id"],
        filterableColumns: ["due_date", "task_type", "completed", "class_id"],
        orderBy: [
          { column: "due_date", ascending: true },
          { column: "created_at", ascending: false },
        ],
        fixedFilter: { domain: "school" },
      },
      class: {
        entity: "class",
        table: "classes",
        description: "One class (course): abbreviation, code, room, instructor, risk-engine inputs. `syllabus_path` is deliberately never exposed here -- it's an internal storage path, not a fetchable value (see write-registry's header comment on why syllabus upload/remove stay off MCP entirely).",
        idColumn: "id",
        updatedAtColumn: null, // needs migration -- see docs/ai-connector/SCHOOL-UPDATED-AT-NEEDED.md
        updatedAtVerification:
          "updateClass (app/(app)/school/class-actions.ts, now updateClassCore) updates short_name/room/instructor on an existing row; uploadClassSyllabus/removeClassSyllabus update syllabus_path. created_at is set once at creation and never reflects any of these -- no faithful existing column, honestly null until a real trigger-backed updated_at lands.",
        summaryColumns: ["short_name", "code", "room", "instructor", "position"],
        fullColumns: ["short_name", "code", "room", "instructor", "position", "difficulty_rating", "confidence_rating", "target_grade_pct", "created_at", "user_id"],
        filterableColumns: ["code"],
        orderBy: [
          { column: "position", ascending: true },
          { column: "code", ascending: true },
        ],
      },
      class_assessment: {
        entity: "class_assessment",
        table: "class_assessments",
        description: "One assessment (quiz/exam/midterm_final) for a class, with its grade-engine inputs. Adding one also creates a linked task (ruling R5) -- see write-registry's class_assessment.add.",
        idColumn: "id",
        updatedAtColumn: null, // needs migration -- see docs/ai-connector/SCHOOL-UPDATED-AT-NEEDED.md
        updatedAtVerification:
          "updateClassAssessmentCore (lib/school/actions-core.ts, extracted from the original updateClassAssessment) updates name/type/date/weight_pct on an existing row. created_at is set once at creation and never reflects an edit -- no faithful existing column, honestly null until a real trigger-backed updated_at lands.",
        summaryColumns: ["class_id", "name", "type", "date"],
        fullColumns: ["class_id", "name", "type", "date", "weight_pct", "points_earned", "points_possible", "is_excused", "task_id", "created_at", "user_id"],
        filterableColumns: ["class_id", "type", "date"],
        orderBy: [{ column: "date", ascending: false }],
      },
      /**
       * `schedule_event_overrides` and `schedule_event_cancellations`
       * (the lead's own named tables) are DELIBERATELY NOT their own read
       * entities, found and flagged rather than silently worked around:
       * neither table carries its own `domain` column -- domain lives on
       * the `schedule_events` row the override/cancellation's `event_id`
       * points at. `fixedFilter` (this file's own mechanism, see
       * EntityDef's own comment above) only ever applies a same-table
       * `.eq(col, value)` -- confirmed by reading lib/mcp/tools/read.ts's
       * query builder directly, which never embeds/joins a foreign table.
       * Registering either table as its own entity with no fixedFilter
       * would read BOTH school's and co_op's overrides/cancellations
       * through a "school"-named entity -- exactly the cross-domain leak
       * fixedFilter exists to prevent, just for a table it cannot reach.
       *
       * Not silently resolved: flagged to the lead. Two real fixes exist
       * (either works, neither attempted here because both are
       * cross-cutting, not school-specific): (1) extend `fixedFilter`/
       * `read.ts` to support a filter through a named foreign-key join, or
       * (2) denormalize a `domain` column onto both tables, copied from
       * the parent event at write time (cheap, additive, no new join
       * logic needed). Their DATA remains reachable today through
       * `write`'s `schedule_event.set_override`/`cancel_occurrence`
       * actions, which scope correctly because they always act via a
       * caller-supplied, domain-checked event id (see write-registry.ts's
       * `assertRowDomain`) -- only LISTING/reading them back as their own
       * entity is the open gap.
       */
      schedule_event: {
        entity: "schedule_event",
        table: "schedule_events",
        description:
          "A class's recurring meeting pattern (or a one-off school event). `schedule_events` is shared with `co_op` -- fixedFilter keeps this entity strictly to domain='school' rows. Per-occurrence overrides/cancellations are NOT included here -- see this entity's own header comment above.",
        idColumn: "id",
        updatedAtColumn: null, // needs migration -- see docs/ai-connector/SCHOOL-UPDATED-AT-NEEDED.md
        updatedAtVerification:
          "updateScheduleEventCore updates day_of_week/event_time/end_time; updateClassEvent (app/(app)/school/actions.ts, multi-day class-group editing, not core-extracted this phase) updates title/event_time/end_time/location/instructor on existing rows. created_at is set once at creation and never reflects either -- no faithful existing column, honestly null until a real trigger-backed updated_at lands.",
        summaryColumns: ["title", "is_recurring", "day_of_week", "event_date", "event_time", "end_time"],
        fullColumns: ["title", "is_recurring", "day_of_week", "event_date", "event_time", "end_time", "location", "instructor", "class_id", "created_at", "user_id"],
        filterableColumns: ["is_recurring", "day_of_week", "class_id"],
        orderBy: [
          { column: "day_of_week", ascending: true },
          { column: "event_time", ascending: true },
        ],
        fixedFilter: { domain: "school" },
      },
    },
  },
  self_mastery: {
    domain: "self_mastery",
    description: "Book ingestion and spaced-repetition study.",
    entities: {
      /**
       * REGISTERED, DELIBERATELY EMPTY — the concrete worked case from
       * TOOL-ARCHITECTURE.md §3: "the owner was explicit that the source
       * text itself stays off MCP, and the visibility registry is where
       * that's enforced, not left to a `detail` parameter the model could
       * otherwise turn up to 'full'." `source_chunks.text` is the actual
       * book content ingestion extracts; `.embedding` is its pgvector
       * representation. Neither may ever reach a model's context.
       *
       * An ALLOWLIST enforces this by construction: `summaryColumns` and
       * `fullColumns` are both `[]`, so `read`'s own `resolveColumns` (see
       * lib/mcp/tools/read.ts) has nothing to select beyond the id/
       * updated_at every entity forces — and a `fields` request for
       * `"text"` or `"embedding"` is rejected the same way a request for
       * `user_api_keys.encrypted_key` would be: a clear error naming what
       * IS available (nothing), never a silent 200 with the value in it.
       * This is the "registered as excluded, same mechanism as the two
       * RLS-deny-all operational tables, just decided by us instead of by
       * Postgres" case the memo names explicitly.
       *
       * This entity is listed in `list_capabilities` — existence is not
       * secret, content is. A caller that discovers `source_chunks` and
       * tries `read(detail:"full")` gets `{id, updated_at}` and nothing
       * else, which is itself the honest answer: "this exists, you cannot
       * read it."
       */
      source_chunks: {
        entity: "source_chunks",
        table: "source_chunks",
        description: "Raw ingested book text and its embedding — existence only; content is deliberately never exposed over MCP.",
        idColumn: "id",
        updatedAtColumn: null, // no created_at/updated_at on this table either (migration 063) — honestly null, not invented
        updatedAtVerification:
          "Checked migration 063 directly: source_chunks has no created_at/updated_at column at all. Moot anyway -- summaryColumns/fullColumns are both empty, so no row-level field including a timestamp is ever exposed for this entity.",
        summaryColumns: [],
        fullColumns: [],
        filterableColumns: [],
        orderBy: [{ column: "id", ascending: true }],
      },
    },
  },
};

export function listDomains(): { domain: string; description: string }[] {
  return Object.values(REGISTRY).map((d) => ({ domain: d.domain, description: d.description }));
}

export function getDomain(domain: string): DomainDef | null {
  return REGISTRY[domain] ?? null;
}

export function getEntity(domain: string, entity: string): EntityDef | null {
  return REGISTRY[domain]?.entities[entity] ?? null;
}
