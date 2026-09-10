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

/**
 * One `fixedFilter` target: either a plain equality value, or an explicit
 * IS-NULL discriminant (`{ is: null }`). Two independent tables needed the
 * null form before this existed — `tasks.domain IS NULL` for Night Plan
 * items (review.night_plan_task below) and migration 108's
 * `checkin_allocations.is_wasted`/`domain IS NULL` split — which is the
 * bar this codebase uses for building a real mechanism instead of a
 * one-off (see AGENTS.md-adjacent precedent: `parentFilter` itself was
 * built the same way, generalized once school AND fitness needed it).
 * `checkin_allocations` doesn't need to actually USE this today — its
 * `domain`/`is_wasted` are both plain columns on `checkins.allocation`, not
 * fixedFilter-scoped, because that entity isn't split per-domain the way
 * `tasks` is split into school/co_op/night-plan. Noted here so the next
 * person who DOES want a domain-scoped allocation entity doesn't have to
 * rediscover that the mechanism already covers it.
 *
 * Never `{ is: "null" }` (a string) or a bare `null` value — both would be
 * silently misread as "filter on the literal value `null`"/"no filter at
 * all" respectively rather than IS NULL. The `{ is: null }` object shape is
 * deliberately unambiguous with a plain string equality target.
 */
export type FixedFilterValue = string | { is: null };

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
   *
   * Each value is a `FixedFilterValue` (see its own comment above) — a
   * plain string for `.eq(col, value)`, or `{ is: null }` for `.is(col,
   * null)` when the discriminant is IS NULL rather than an equality (e.g.
   * review.night_plan_task's `domain: { is: null }`).
   */
  fixedFilter?: Record<string, FixedFilterValue>;
  /**
   * Declares this entity as a child of a NAMED parent row — never reachable
   * as a flat "every row the user has ever owned, across every parent"
   * list. Built for the shape `schedule_event_overrides`/
   * `schedule_event_cancellations` (school) and `plan_session_exercises`/
   * `session_sets`/`plan_micro_exercises`/`workout_exercises` (fitness) all
   * share: a child table that is only ever meaningfully read "for THIS
   * session/event/plan," never unscoped. team-lead's ruling: "a narrow
   * parentFilter -- a declared FK plus the parent column to constrain on --
   * not a general join engine."
   *
   * `read.ts` enforces two things when this is set:
   *  1. A LIST call (no `id`) MUST supply `filter[column]` — an unscoped
   *     list across every parent is refused with a clear error, never
   *     silently returned.
   *  2. The named parent row (found by `filter[column]`, or — for an
   *     `id`-based read — by the fetched child row's own `column` value)
   *     is looked up and must itself belong to this user AND pass
   *     `parentFixedFilter` (if set). This is what actually closes the
   *     school gap: `schedule_event_overrides` has no `domain` column of
   *     its own, but verifying its parent `schedule_events` row passes
   *     `domain='school'` achieves the same scoping `fixedFilter` gives a
   *     table that DOES carry the column directly — without denormalizing
   *     anything onto the child (the lead's explicit ruling against that).
   *     A parent that fails this check is reported as "not found," the
   *     same posture `fixedFilter` uses elsewhere — never a distinguishable
   *     "exists but wrong domain" leak.
   *
   * For an entity with no cross-domain sharing at all (every fitness table
   * this applies to), the parent check is a harmless no-op beyond what
   * `user_id` already guarantees — it's applied anyway, for the other half
   * of the value: requiring a named parent keeps `read` from ever handing
   * back an incoherent flat dump of every set/exercise a user has logged
   * across every session/plan they've ever had, which matches how every
   * other reader in this codebase actually queries these tables (always
   * scoped to one parent).
   */
  parentFilter?: {
    /** The FK column on THIS entity's own table. Must also be listed in `filterableColumns`. */
    column: string;
    /** The parent's real table name (not an MCP entity name — this is a same-table-family check, not a join). */
    parentTable: string;
    /** The parent table's id column, usually "id". */
    parentIdColumn: string;
    /** Applied to the parent lookup, same semantics as this entity's own `fixedFilter` — e.g. `{domain: "school"}` to verify a schedule_events row is actually school's. */
    parentFixedFilter?: Record<string, string>;
  };
  /**
   * Per-column max length, enforced in `read.ts`'s own response mapping
   * (`toItem`) — never left to trust in whatever a write path happens to
   * store. Built for `self_mastery.lesson.provenance_quote` (team-lead's
   * ruling): the extraction prompt asks for "one sentence," and that holds
   * on average (276 lessons, avg 138 chars) but NOT always (max 477 chars
   * measured on production, ~75 words) — prompt discipline is not an
   * enforcement mechanism, and a future provider swap could ignore the
   * prompt entirely. A column can be exposed as "a citation, not the book"
   * only if something at OUR layer guarantees it stays citation-sized,
   * regardless of what any provider ever writes. A truncated value is
   * still marked truncated in the returned string (a trailing "…"), never
   * silently cut with no sign anything was removed.
   */
  truncateColumns?: Record<string, number>;
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
        // blocked_reason is in summaryColumns DELIBERATELY, not just
        // fullColumns (migration 148, the legacy-account program's own
        // track -- coop_tasks, not ours to migrate). `status: "blocked"`
        // with no reason reads as complete information: a caller sees a
        // status and has no signal anything is missing, so it either
        // reports "blocked" as the finished answer or burns a second
        // round trip discovering the field that should have arrived with
        // it. A summary that omits the one field its own status exists to
        // qualify isn't a summary -- it's a truncation that looks whole.
        // Same family as this registry's own denylist-vs-allowlist
        // discipline: the failure mode is invisible, not loud.
        //
        // HOLD: 148 must be APPLIED to production before this lands --
        // these names are the literal select list. Landing early means
        // every coop_tasks read 500s on a nonexistent column: a missing
        // field is invisible-but-recoverable, a broken read takes the
        // whole entity down. Confirmed with the lead before committing.
        summaryColumns: ["target_id", "title", "deadline", "status", "blocked_from", "blocked_reason"],
        fullColumns: ["target_id", "title", "deadline", "status", "blocked_from", "blocked_reason", "blocked_since", "completed_at", "created_at", "updated_at", "user_id"],
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
      "Classes, their assessments, the class schedule, its per-occurrence overrides/cancellations (each parentFilter-scoped to one event), and school-owned tasks.",
    entities: {
      task: {
        entity: "task",
        table: "tasks",
        description:
          "A school task/assignment/reminder. `tasks` is shared with `co_op` (and, for a Night Plan dump item, domain=NULL, migration 119) -- fixedFilter keeps this entity strictly to domain='school' rows.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Migration 136 (applied, verified on production by the lead -- 5 columns, 5 triggers, trigger confirmed firing on tasks) added a real trigger-backed updated_at to tasks, reusing migration 074's touch_updated_at(), after updateTaskCore/toggleTaskCore/updateClassAssessmentCore's task-sync step were found to each UPDATE an existing row with completed_at reflecting only the complete/not-complete transition, never a title/due_date/class_id edit (same gap migration 135 fixed for coop_tasks).",
        summaryColumns: ["title", "due_date", "task_type", "completed", "class_id"],
        fullColumns: ["title", "due_date", "due_time", "task_type", "task_type_other_label", "completed", "completed_at", "class_id", "created_at", "updated_at", "user_id"],
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
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Migration 136 (applied, verified on production by the lead) added a real trigger-backed updated_at to classes, reusing migration 074's touch_updated_at(), after updateClassCore (short_name/room/instructor) and uploadClassSyllabus/removeClassSyllabus (syllabus_path) were found to each UPDATE an existing row with no faithful existing column to reflect it.",
        summaryColumns: ["short_name", "code", "room", "instructor", "position"],
        fullColumns: ["short_name", "code", "room", "instructor", "position", "difficulty_rating", "confidence_rating", "target_grade_pct", "created_at", "updated_at", "user_id"],
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
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Migration 136 (applied, verified on production by the lead) added a real trigger-backed updated_at to class_assessments, reusing migration 074's touch_updated_at(), after updateClassAssessmentCore (lib/school/actions-core.ts) was found to UPDATE name/type/date/weight_pct on an existing row with no faithful existing column to reflect it.",
        summaryColumns: ["class_id", "name", "type", "date"],
        fullColumns: ["class_id", "name", "type", "date", "weight_pct", "points_earned", "points_possible", "is_excused", "task_id", "created_at", "updated_at", "user_id"],
        filterableColumns: ["class_id", "type", "date"],
        orderBy: [{ column: "date", ascending: false }],
      },
      schedule_event: {
        entity: "schedule_event",
        table: "schedule_events",
        description:
          "A class's recurring meeting pattern (or a one-off school event). `schedule_events` is shared with `co_op` -- fixedFilter keeps this entity strictly to domain='school' rows. Per-occurrence overrides/cancellations are separate entities below (schedule_event_override/schedule_event_cancellation), each scoped via parentFilter to THIS entity's own rows.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Migration 136 (applied, verified on production by the lead) added a real trigger-backed updated_at to schedule_events, reusing migration 074's touch_updated_at(), after updateScheduleEventCore (day_of_week/event_time/end_time) and updateClassEvent (app/(app)/school/actions.ts, multi-day class-group editing, not core-extracted this phase; title/event_time/end_time/location/instructor) were found to each UPDATE an existing row with no faithful existing column to reflect it.",
        summaryColumns: ["title", "is_recurring", "day_of_week", "event_date", "event_time", "end_time"],
        fullColumns: ["title", "is_recurring", "day_of_week", "event_date", "event_time", "end_time", "location", "instructor", "class_id", "created_at", "updated_at", "user_id"],
        filterableColumns: ["is_recurring", "day_of_week", "class_id"],
        orderBy: [
          { column: "day_of_week", ascending: true },
          { column: "event_time", ascending: true },
        ],
        fixedFilter: { domain: "school" },
      },
      /**
       * RETROFITTED onto `parentFilter` once fitness needed the same
       * mechanism for 2+ tables (team-lead's conditional ruling). Neither
       * `schedule_event_overrides` nor `schedule_event_cancellations`
       * carries its own `domain` column -- domain lives on the
       * `schedule_events` row their `event_id` points at, and `fixedFilter`
       * can only ever apply a same-table `.eq()`. `parentFilter` closes
       * this WITHOUT denormalizing `domain` onto either table (the lead's
       * explicit ruling against that, since it would create a second
       * source of truth that drifts): every read looks up the named
       * `event_id`'s OWN `schedule_events` row and verifies it passes
       * `domain: "school"` before returning any override/cancellation rows
       * for it. A co_op event's overrides are therefore unreachable through
       * THIS entity -- not filtered out of a returned list, REFUSED before
       * the list query ever runs.
       */
      schedule_event_override: {
        entity: "schedule_event_override",
        table: "schedule_event_overrides",
        description: "A single occurrence's temporary time change ('move next Tuesday's class'), without touching the permanent pattern. Always read scoped to one event via filter.event_id (parentFilter) -- never as a flat list across every event.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Migration 136 (applied, verified on production by the lead) added a real trigger-backed updated_at to schedule_event_overrides, after setScheduleEventOverrideCore's upsert (onConflict: event_id,date) was found to MERGE event_time/end_time on an existing row -- a true update, not a no-op -- which created_at never reflected.",
        summaryColumns: ["event_id", "date", "event_time", "end_time"],
        fullColumns: ["event_id", "date", "event_time", "end_time", "created_at", "updated_at", "user_id"],
        filterableColumns: ["event_id", "date"],
        orderBy: [{ column: "date", ascending: true }],
        parentFilter: { column: "event_id", parentTable: "schedule_events", parentIdColumn: "id", parentFixedFilter: { domain: "school" } },
      },
      schedule_event_cancellation: {
        entity: "schedule_event_cancellation",
        table: "schedule_event_cancellations",
        description: "A single cancelled occurrence ('cancel this one instance'), without touching the permanent pattern. Always read scoped to one event via filter.event_id (parentFilter) -- never as a flat list across every event.",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "cancelScheduleOccurrenceCore upserts with ignoreDuplicates:true -- a TRUE no-op on conflict (the row is never modified after insert; the table carries no other mutable column at all, existence/absence IS the entire fact). created_at is therefore a genuinely faithful last-modified proxy, same append-only reasoning as deen.quran_session. Migration 136 deliberately excluded this table for exactly this reason -- a trigger here would simply never fire.",
        summaryColumns: ["event_id", "date"],
        fullColumns: ["event_id", "date", "created_at", "user_id"],
        filterableColumns: ["event_id", "date"],
        orderBy: [{ column: "date", ascending: true }],
        parentFilter: { column: "event_id", parentTable: "schedule_events", parentIdColumn: "id", parentFixedFilter: { domain: "school" } },
      },
    },
  },
  fitness: {
    domain: "fitness",
    description:
      "The largest domain in the app (15 tables). Logging (workout_session/session_set) and body-metric/benchmark writes are " +
      "fully wired -- the owner's 'checking off logs' requirement in its heaviest form (team-lead's framing). Plan-editing " +
      "(workout_plan/plan_session/plan_session_exercise/plan_micro_exercise/workout_exercise/workout_schedule/active_workout_plan) " +
      "is READ-ONLY here, deliberately -- see docs/ai-connector/FITNESS-WRITE-SCOPE-DECISIONS.md.",
    entities: {
      workout_session: {
        entity: "workout_session",
        table: "workout_sessions",
        description: "One logged workout (confirmed from a workout/plan-session template, or quick-add/adhoc). Immutable by design (spec: 'editing must never rewrite history') -- no update or delete path exists anywhere in the app.",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "INSERT-ONLY, all three write paths checked: quickLogExerciseCore, confirmWorkoutSessionCore (RPC confirm_workout_session, 029), confirmPlanSessionCore (all lib/fitness/actions-core.ts) each only ever INSERT. No UPDATE or DELETE on workout_sessions exists anywhere in app code or in any RPC. created_at IS the true last-modified time, same append-only reasoning as deen.quran_session.",
        summaryColumns: ["date", "workout_id", "workout_name", "source"],
        fullColumns: ["date", "workout_id", "workout_name", "source", "plan_session_id", "created_at", "user_id"],
        filterableColumns: ["date", "workout_id", "source", "plan_session_id"],
        orderBy: [{ column: "date", ascending: false }],
      },
      session_set: {
        entity: "session_set",
        table: "session_sets",
        description: "One exercise's sets/reps/load within a logged session -- exercise_name is a snapshot (survives the exercise being later archived/renamed). Immutable by design, same as workout_session. Always read scoped to one session via filter.session_id (parentFilter) -- never as a flat list across every session ever logged.",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "INSERT-ONLY: every write path (quickLogExerciseCore, confirmWorkoutSessionCore's RPC, confirmPlanSessionCore) only ever INSERTs session_sets rows as part of creating their parent session; no UPDATE/DELETE exists anywhere. created_at IS the true last-modified time.",
        summaryColumns: ["session_id", "exercise_id", "exercise_name", "position", "sets", "reps", "load"],
        fullColumns: ["session_id", "exercise_id", "exercise_name", "position", "sets", "reps", "load", "created_at", "user_id"],
        filterableColumns: ["session_id", "exercise_id"],
        orderBy: [{ column: "position", ascending: true }],
        parentFilter: { column: "session_id", parentTable: "workout_sessions", parentIdColumn: "id" },
      },
      body_metric: {
        entity: "body_metric",
        table: "body_metrics",
        description: "One date's weight and/or waist measurement. The CHECK (weight_lb IS NOT NULL OR waist_in IS NOT NULL) means at least one is always present; a null field is unmeasured that day, never zero.",
        idColumn: "id",
        updatedAtColumn: null, // needs migration -- see docs/ai-connector/FITNESS-UPDATED-AT-NEEDED.md
        updatedAtVerification:
          "logWeightCore/logWaistCore/logCycleBenchmark's combined call (app/(app)/fitness/actions.ts, lib/fitness/actions-core.ts) all upsert on (user_id,date) conflict, each preserving the sibling field by reading it first -- a genuine UPDATE-in-place on a re-logged date. created_at is set once at first insert and never reflects a later re-log. No faithful existing column -- honestly null until a real trigger-backed updated_at lands.",
        summaryColumns: ["date", "weight_lb", "waist_in"],
        fullColumns: ["date", "weight_lb", "waist_in", "created_at", "user_id"],
        filterableColumns: ["date"],
        orderBy: [{ column: "date", ascending: false }],
      },
      fitness_benchmark: {
        entity: "fitness_benchmark",
        table: "fitness_benchmarks",
        description: "One exercise's max-reps benchmark for a date (Cycle Progress checks, every 4-week boundary). One row per (user, date, exercise).",
        idColumn: "id",
        updatedAtColumn: null, // needs migration -- see docs/ai-connector/FITNESS-UPDATED-AT-NEEDED.md
        updatedAtVerification:
          "logBenchmarkRepsCore (lib/fitness/actions-core.ts) and logCycleBenchmark's own reps loop (app/(app)/fitness/actions.ts) both upsert on (user_id,date,exercise_id) conflict -- re-logging the same exercise/date genuinely UPDATEs max_reps in place. created_at is set once at first insert and never reflects that. No faithful existing column -- honestly null until a real trigger-backed updated_at lands.",
        summaryColumns: ["date", "exercise_id", "max_reps"],
        fullColumns: ["date", "exercise_id", "max_reps", "created_at", "user_id"],
        filterableColumns: ["date", "exercise_id"],
        orderBy: [{ column: "date", ascending: false }],
      },
      fitness_cycle_anchor: {
        entity: "fitness_cycle_anchor",
        table: "fitness_cycle_anchor",
        description:
          "The one-time anchor date 4-week Cycle Progress windows are computed from (lib/fitness/cycle.ts's cycleForDate, a pure function over this stored value). FOUND DURING THIS BUILD: no write path for this table exists ANYWHERE in the current app -- grepped every .ts file outside supabase/migrations and the one test-only route (app/api/test/clear-fitness-cycle-anchor) that DELETEs it for e2e teardown. Migration 039's own comment describes the intended default ('first plan activation, spec's logic-gap resolution #6'), but nothing in activatePlan/setActiveSlot actually sets it -- the Cycle Progress feature is half-built. Flagged to the lead, not fixed here (building a missing feature is out of scope for an MCP fan-out pass). Registered read-only and honestly: a caller will get an empty list until this is wired, which is the truth, not a bug in this registration.",
        idColumn: "user_id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "No write path exists at all today (see description) -- moot either way, but even the SPEC's own intent ('anchored once') describes a true single-insert-ever table, never updated in place, so created_at would remain faithful even once the missing write path is built.",
        summaryColumns: ["anchor_date"],
        fullColumns: ["anchor_date", "created_at"],
        filterableColumns: [],
        orderBy: [{ column: "user_id", ascending: true }],
      },
      active_workout_plan: {
        entity: "active_workout_plan",
        table: "active_workout_plans",
        description:
          "The two active-plan slots (micro, routine) -- at most one row per user. READ-ONLY: migration 129's own header is the reason (a composite tenancy FK whose unqualified ON DELETE SET NULL made deleting an active plan impossible in production for weeks, fixed there but still the program's clearest 'obvious operation, isn't' trap). Writing here directly would also bypass lib/fitness/sync-workout-schedule.ts's shim, desyncing workout_schedule for the nine legacy readers outside fitness. See docs/ai-connector/FITNESS-WRITE-SCOPE-DECISIONS.md.",
        idColumn: "user_id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "setActiveSlot (both app/(app)/fitness/workouts/plan-actions.ts and template-actions.ts, the table's only writers) explicitly sets `updated_at: new Date().toISOString()` on every upsert -- app-set, not trigger-maintained, but real and verified against the actual write, not inferred from the column existing. Same posture as settings.api_key's updated_at.",
        summaryColumns: ["micro_plan_id", "routine_plan_id"],
        fullColumns: ["micro_plan_id", "routine_plan_id", "updated_at"],
        filterableColumns: [],
        orderBy: [{ column: "user_id", ascending: true }],
      },
      exercise: {
        entity: "exercise",
        table: "exercises",
        description: "One exercise in the library (name, primary/secondary muscle groups). Archived, never hard-deleted -- workout_exercises/session_sets reference it with no cascading delete.",
        idColumn: "id",
        updatedAtColumn: null, // needs migration -- see docs/ai-connector/FITNESS-UPDATED-AT-NEEDED.md
        updatedAtVerification:
          "archiveExerciseCore (lib/fitness/actions-core.ts) UPDATEs `archived` on an existing row post-creation -- created_at goes stale on the very first archive. No faithful existing column -- honestly null until a real trigger-backed updated_at lands.",
        summaryColumns: ["name", "primary_muscles", "secondary_muscles", "archived"],
        fullColumns: ["name", "primary_muscles", "secondary_muscles", "archived", "created_at", "user_id"],
        filterableColumns: ["archived"],
        orderBy: [{ column: "name", ascending: true }],
      },
      workout: {
        entity: "workout",
        table: "workouts",
        description: "One named workout template -- either standalone or the backing row for a routine plan's session (plan_sessions.workout_id, migration 040's legacy-reader mirror). Archived, never hard-deleted.",
        idColumn: "id",
        updatedAtColumn: null, // needs migration -- see docs/ai-connector/FITNESS-UPDATED-AT-NEEDED.md
        updatedAtVerification:
          "renameWorkoutCore/archiveWorkoutCore (lib/fitness/actions-core.ts) and the save_workout RPC (031, its own `update public.workouts set name = ...`) each UPDATE an existing row post-creation. No faithful existing column -- honestly null until a real trigger-backed updated_at lands.",
        summaryColumns: ["name", "archived"],
        fullColumns: ["name", "archived", "created_at", "user_id"],
        filterableColumns: ["archived"],
        orderBy: [{ column: "name", ascending: true }],
      },
      workout_exercise: {
        entity: "workout_exercise",
        table: "workout_exercises",
        description: "One exercise's target sets/reps/load within a workout template. Always read scoped to one workout via filter.workout_id (parentFilter) -- never as a flat list across every workout.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification:
          "The table has NO created_at/updated_at column at all (migration 025's schema, confirmed directly). Moot anyway: save_workout (031) is the ONLY write path and always does a full delete-then-reinsert of a workout's whole exercise list, never an in-place UPDATE of one row -- a changed row IS a different row (fresh id), so there is no 'went stale while the id stayed the same' failure mode a timestamp would even need to guard against. No migration requested for this shape -- see docs/ai-connector/FITNESS-UPDATED-AT-NEEDED.md.",
        summaryColumns: ["workout_id", "exercise_id", "position", "target_sets", "target_reps_low", "target_reps_high"],
        fullColumns: ["workout_id", "exercise_id", "position", "target_sets", "target_reps_low", "target_reps_high", "target_load", "user_id"],
        filterableColumns: ["workout_id", "exercise_id"],
        orderBy: [{ column: "position", ascending: true }],
        parentFilter: { column: "workout_id", parentTable: "workouts", parentIdColumn: "id" },
      },
      workout_plan: {
        entity: "workout_plan",
        table: "workout_plans",
        description: "A 'micro' (loose exercises, no sessions) or 'routine' (named sessions) plan. Deleted (not archived) via deletePlan -- read-only here, so a deleted plan simply stops appearing; not itself reachable by id once gone.",
        idColumn: "id",
        updatedAtColumn: null, // needs migration -- see docs/ai-connector/FITNESS-UPDATED-AT-NEEDED.md
        updatedAtVerification:
          "savePlan (app/(app)/fitness/workouts/plan-actions.ts) UPDATEs `name` on an existing row when editing a plan that already has an id. No faithful existing column -- honestly null until a real trigger-backed updated_at lands.",
        summaryColumns: ["name", "kind", "archived"],
        fullColumns: ["name", "kind", "archived", "created_at", "user_id"],
        filterableColumns: ["kind", "archived"],
        orderBy: [{ column: "name", ascending: true }],
      },
      plan_session: {
        entity: "plan_session",
        table: "plan_sessions",
        description: "A routine plan's named, individually-scheduled session. Always read scoped to one plan via filter.plan_id (parentFilter) -- never as a flat list across every plan.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification:
          "The table has NO created_at/updated_at column at all (migration 036's schema, confirmed directly). Moot anyway: savePlan always does a full delete-then-reinsert of a routine plan's whole session list (see its own comment: 'Cascades to plan_session_exercises via ON DELETE CASCADE'), never an in-place UPDATE -- same delete+reinsert shape as workout_exercises, same reasoning for why no migration is requested.",
        summaryColumns: ["plan_id", "name", "position", "schedule_days", "start_time"],
        fullColumns: ["plan_id", "name", "position", "schedule_days", "start_time", "workout_id", "user_id"],
        filterableColumns: ["plan_id"],
        orderBy: [{ column: "position", ascending: true }],
        parentFilter: { column: "plan_id", parentTable: "workout_plans", parentIdColumn: "id" },
      },
      plan_session_exercise: {
        entity: "plan_session_exercise",
        table: "plan_session_exercises",
        description: "One exercise's target duration/load/sets/reps within a plan session. Always read scoped to one session via filter.session_id (parentFilter) -- never as a flat list across every session.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification:
          "The table has NO created_at/updated_at column at all (migration 036's schema, confirmed directly). Moot anyway: savePlan deletes and reinserts a session's whole exercise list on every save, same delete+reinsert shape as workout_exercises/plan_sessions -- no migration requested.",
        summaryColumns: ["session_id", "exercise_id", "position", "duration_minutes", "target_sets", "target_reps"],
        fullColumns: ["session_id", "exercise_id", "position", "duration_minutes", "target_sets", "target_reps", "load_lb", "user_id"],
        filterableColumns: ["session_id", "exercise_id"],
        orderBy: [{ column: "position", ascending: true }],
        parentFilter: { column: "session_id", parentTable: "plan_sessions", parentIdColumn: "id" },
      },
      plan_micro_exercise: {
        entity: "plan_micro_exercise",
        table: "plan_micro_exercises",
        description: "A micro plan's independently-scheduled, independently-goaled (daily_total vs frequency) loose exercise. Always read scoped to one plan via filter.plan_id (parentFilter) -- never as a flat list across every plan.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification:
          "The table has NO created_at/updated_at column at all (migration 036's schema, confirmed directly). Moot anyway: savePlan deletes and reinserts a micro plan's whole exercise list on every save ('delete eq plan_id, then insert rows'), same delete+reinsert shape as workout_exercises -- no migration requested.",
        summaryColumns: ["plan_id", "exercise_id", "position", "schedule_days", "goal_type", "goal_value"],
        fullColumns: ["plan_id", "exercise_id", "position", "schedule_days", "goal_type", "goal_value", "notes", "user_id"],
        filterableColumns: ["plan_id", "exercise_id"],
        orderBy: [{ column: "position", ascending: true }],
        parentFilter: { column: "plan_id", parentTable: "workout_plans", parentIdColumn: "id" },
      },
      workout_schedule: {
        entity: "workout_schedule",
        table: "workout_schedule",
        description:
          "The day-of-week -> workout pointer nine legacy readers outside fitness still key off. READ-ONLY, deliberately: while a routine plan is active, this table is entirely wiped-and-regenerated on every plan mutation by lib/fitness/sync-workout-schedule.ts's shim -- a write here would be silently undone by the next savePlan/activatePlan/deactivateSlot/deletePlan call, with no way for a caller to know whether a routine is currently active. See docs/ai-connector/FITNESS-WRITE-SCOPE-DECISIONS.md.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification:
          "The table has NO created_at/updated_at column at all (baseline + migration 023's schema, confirmed directly). Not requested as a migration -- low value given this table is read-only via MCP and already churns via the sync shim's own delete-then-reinsert.",
        summaryColumns: ["day_of_week", "workout_name", "time", "workout_id"],
        fullColumns: ["day_of_week", "workout_name", "time", "duration_minutes", "workout_id", "user_id"],
        filterableColumns: ["day_of_week", "workout_id"],
        orderBy: [{ column: "day_of_week", ascending: true }],
      },
      rep_goal: {
        entity: "rep_goal",
        table: "rep_goals",
        description:
          "LEGACY/DEAD, kept readable for history: superseded by plan_micro_exercises (migration 036 materializes every active rep_goals row into a 'Starter Reps' micro plan). Confirmed zero writers anywhere in current app code via grep -- read only by app/(app)/settings/export/route.ts's data export.",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "Zero writers confirmed (grepped the whole tree outside supabase/migrations for `from(\"rep_goals\")`/`from('rep_goals')` and found none) -- a frozen historical artifact, same append-only reasoning as deen.quran_session, just for a table nothing writes to anymore rather than one that only ever inserted.",
        summaryColumns: ["exercise_id", "daily_target", "active_days", "archived"],
        fullColumns: ["exercise_id", "daily_target", "active_days", "archived", "created_at", "user_id"],
        filterableColumns: ["exercise_id", "archived"],
        orderBy: [{ column: "created_at", ascending: false }],
      },
    },
  },
  self_mastery: {
    domain: "self_mastery",
    description:
      "Book ingestion and spaced-repetition study -- library metadata, chapter structure, extracted lessons, " +
      "spaced-repetition cards and their FSRS state, the append-only review log, promotion/verdict tracking " +
      "for adopted lessons, and CollegeOS's class question bank (shares this study engine's review log). " +
      "The raw book text itself (source_chunks.text/.embedding) is structurally excluded -- see that entity below.",
    entities: {
      /**
       * RULED ON BY THE LEAD (measured, not judged): `provenance_quote`
       * below is genuinely verbatim book text, not a paraphrase -- the
       * extraction prompt (lib/self-mastery/ingestion/llm/ollama-provider.ts
       * ~line 161) instructs the model to copy "the ONE sentence (or short
       * span)... that exact span, copied verbatim (same words, same order,
       * same punctuation)", and `isGrounded()` (llm/grounding.ts) enforces
       * that it verbatim-matches a substring of the source chunk for every
       * provider, not just as documentation. Measured against production
       * (276 lessons): avg 138 chars -- one sentence, as intended -- but
       * MAX 477 chars (~75 words). The "400-word extract is arguably the
       * book" scenario named in the brief is not hypothetical; prompt
       * discipline alone has already been exceeded at least once.
       *
       * RULING: keep it (its purpose is grounding/citation -- proving the
       * claim isn't hallucinated -- and core_claim/mechanism/action_template,
       * the fields that actually carry the book's IDEAS, are independently
       * required to be substantially reworded away from it by
       * `passesClaimNotQuote`), but enforce "citation-sized" at the layer WE
       * control rather than inherit it from a prompt: `truncateColumns:
       * {provenance_quote: 240}` below caps it in `read.ts`'s own response
       * mapping, regardless of what any provider (including a future one
       * that ignores the prompt entirely) ever stores. See EntityDef.
       * truncateColumns's own comment for the mechanism.
       *
       * Checked and ruled OUT as separate concerns, for the record:
       * `cards.prompt`/`.answer` are AI-generated Q&A pairs, never a direct
       * copy of the quote -- passesAntiLeak/passesTopicality (invariants.ts)
       * gate them against EACH OTHER, and cloze cards are built from
       * `core_claim` (itself already required to be non-quote-like), never
       * from `provenance_quote` directly. `lesson_promotions.accepted_text`/
       * `.cue` are the USER's own wording (migration 124's own comment:
       * "never a copy of lessons.action_template"). `reviews.answered_text`/
       * `.ai_feedback` are the user's typed answer and feedback on it, not
       * book content. None of these carry verbatim source text.
       */
      lesson: {
        entity: "lesson",
        table: "lessons",
        description:
          "One extracted, hallucination-firewalled lesson from a book: a claim, its mechanism, an action template, " +
          "and the verbatim quote that grounds it (see this entity's own header comment above). Flat, not " +
          "parent-scoped -- the owner explicitly wants 'all those mini reflections' browsable across the whole " +
          "library, not book-by-book only; filter.book_id narrows to one book when wanted.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification:
          "FLAGGED, NOT INVENTED -- lessons has no updated_at column, only created_at, and created_at is not a " +
          "faithful proxy: worker-stages.ts UPDATEs this table repeatedly post-creation (rank reordering at " +
          "generating_cards time, status transitions active/failed) with created_at never touching. Checked for " +
          "non-code writers per the standing rule, and found one: migration 140's composite-FK sweep changed " +
          "lessons.section_id/source_chunk_id to ON DELETE SET NULL -- deleting a book_section or source_chunk " +
          "silently nulls a column on this row via the FK action itself, no trigger, no app code involved. " +
          "Exactly the active_workout_plans class of bug. A real updated_at needs a migration; until then, null " +
          "is the honest answer, not a fabricated created_at that would make detail:'ids' reuse silently wrong.",
        summaryColumns: ["title", "core_claim", "status", "book_id"],
        fullColumns: [
          "title",
          "core_claim",
          "mechanism",
          "action_template",
          "evidence_strength",
          "provenance_quote",
          "page_ref",
          "rank",
          "status",
          "relevance_floor",
          "extracted_by",
          "book_id",
          "section_id",
          "source_chunk_id",
          "created_at",
        ],
        // `embedding` (vector(384)) deliberately excluded -- meaningless
        // numeric noise to a model, same reasoning as card/source_chunks
        // below, not a security concern for this one.
        filterableColumns: ["book_id", "status", "section_id"],
        orderBy: [{ column: "created_at", ascending: false }],
        // See this entity's header comment (above) for the full ruling.
        truncateColumns: { provenance_quote: 240 },
      },
      book: {
        entity: "book",
        table: "books",
        description: "One uploaded book: title/author, ingestion progress, and lifecycle timestamps. Never the file itself -- see file_path's exclusion note below.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification:
          "FLAGGED, NOT INVENTED -- books has created_at but no updated_at, and this row is mutated extensively " +
          "post-creation: the ingestion worker (worker-stages.ts) UPDATEs status/stage/progress_pct/error_message/" +
          "lesson_count/ready_at repeatedly through the pipeline; complete_session (079) sets deck_completed_at; " +
          "delete_book/restore_book (081) set/clear deleted_at. created_at never reflects any of this. Checked for " +
          "non-code writers: books_create_source (069) fires AFTER INSERT only (creates the paired `sources` row, " +
          "doesn't touch `books` itself), so no trigger mutates this table -- the staleness here is entirely from " +
          "the missing column, not a hidden writer. Needs a real migration for a trustworthy updated_at.",
        summaryColumns: ["title", "author", "status", "stage", "progress_pct"],
        fullColumns: [
          "title",
          "author",
          "status",
          "stage",
          "progress_pct",
          "page_count",
          "lesson_count",
          "error_message",
          "cover_hue",
          "created_at",
          "ready_at",
          "deck_completed_at",
        ],
        // `file_path`/`file_size_bytes` deliberately excluded, a narrower
        // call than source_chunks' but the same spirit: file_path is a live
        // Storage retrieval key for the ORIGINAL PDF/book file -- exposing
        // it hands a widget/MCP caller a working pointer to "the actual
        // book/pdf" the owner explicitly asked to keep off this connector,
        // even though it isn't raw text like source_chunks.text. `deleted_at`
        // also excluded, not for secrecy but because it's pointless: RLS's
        // own books_own_row policy already restricts every row a caller can
        // see to deleted_at IS NULL, so the column would read as an always-
        // null field in every row this entity could ever return.
        filterableColumns: ["status", "stage"],
        orderBy: [{ column: "created_at", ascending: false }],
      },
      book_section: {
        entity: "book_section",
        table: "book_sections",
        description:
          "One book's chapter/section structure (title, page range, nesting level) -- the table the per-chapter " +
          "summary this connector is supposed to expose would live on. Parent-scoped: always read for one named " +
          "book via filter.book_id, never as a flat cross-book list (a section has no meaning outside its book).",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification: "No created_at/updated_at column at all (062_ulm_book_sections.sql) -- honestly null, not invented. Currently 0 rows in production, so there is nothing to go stale yet either way.",
        summaryColumns: ["title", "sort_order", "page_start", "page_end"],
        fullColumns: ["title", "sort_order", "page_start", "page_end", "level", "book_id"],
        filterableColumns: ["book_id"],
        orderBy: [{ column: "sort_order", ascending: true }],
        parentFilter: { column: "book_id", parentTable: "books", parentIdColumn: "id" },
      },
      card: {
        entity: "card",
        table: "cards",
        description:
          "One spaced-repetition prompt/answer pair generated from a lesson. Flat, not parent-scoped, same " +
          "reasoning as `lesson` -- filter.book_id or filter.lesson_id narrows when wanted.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification:
          "FLAGGED, NOT INVENTED -- cards has no created_at/updated_at column at all, and it is genuinely mutated " +
          "post-creation by TWO DB TRIGGERS, not application code: migration 126's " +
          "suspend_cards_on_adopted_verdict (AFTER INSERT on lesson_verdicts, sets suspended_at/suspended_reason " +
          "on every card of an adopted lesson) and suspend_new_card_if_lesson_adopted (BEFORE INSERT on cards " +
          "itself, for a re-ingested deck of an already-adopted lesson). Checked precisely because this is the " +
          "active_workout_plans class of bug -- a non-code writer changing a row with nothing to record when. " +
          "There is no faithful column to use; a real updated_at needs a migration.",
        summaryColumns: ["prompt", "prompt_type", "book_id", "lesson_id"],
        fullColumns: ["prompt", "answer", "prompt_type", "sort_order", "book_id", "lesson_id", "suspended_at", "suspended_reason"],
        filterableColumns: ["book_id", "lesson_id", "prompt_type"],
        orderBy: [{ column: "sort_order", ascending: true }],
      },
      card_state: {
        entity: "card_state",
        table: "card_states",
        description: "FSRS spaced-repetition scheduling state for one card (or, in CollegeOS's half of this shared engine, one question -- see `question` below; nothing in this app writes that half yet).",
        idColumn: "id",
        updatedAtColumn: "last_review_at",
        updatedAtVerification:
          "Verified against the real write path: submit_review (081, rewritten by 111) is the ONLY place this " +
          "table is UPDATEd, and it unconditionally sets `last_review_at = now()` in the same statement as every " +
          "other field it touches (stability/difficulty/due_at/reps/lapses/state/learning_steps/last_rating) -- " +
          "there is no way this row changes without last_review_at moving too. Checked for non-code writers: the " +
          "table's FKs (card_id/book_id/question_id -> cards/books/questions, all ON DELETE CASCADE) only ever " +
          "DELETE this row, never UPDATE it, so no cascade can silently change it out from under this column. " +
          "Null on a brand-new (never-reviewed) row -- correct, since nothing has happened to it yet.",
        summaryColumns: ["state", "due_at", "stability", "book_id"],
        fullColumns: ["state", "due_at", "stability", "difficulty", "reps", "lapses", "learning_steps", "last_review_at", "last_rating", "book_id", "card_id", "question_id"],
        filterableColumns: ["book_id", "state", "card_id", "question_id"],
        orderBy: [{ column: "due_at", ascending: true }],
      },
      review: {
        entity: "review",
        table: "reviews",
        description: "One append-only grading event from a study session -- the sacred log FSRS parameter fitting and the drift instrument depend on. Never overwritten, never deleted.",
        idColumn: "id",
        updatedAtColumn: "reviewed_at",
        updatedAtVerification:
          "The safest case in this whole domain: reviews_no_update/reviews_no_delete (072) reject ANY UPDATE or " +
          "DELETE unconditionally at the trigger level, no role exemption (the one sanctioned door, " +
          "purge_user_data, disables the trigger only for whole-account deletion, which removes rows rather than " +
          "changing them). A row is byte-identical forever after its one INSERT, so reviewed_at (set once, then) " +
          "cannot go stale by construction -- there is no non-code-writer question to even ask here.",
        summaryColumns: ["rating", "reviewed_at", "book_id"],
        fullColumns: [
          "rating",
          "confidence",
          "correct",
          "elapsed_ms",
          "answered_text",
          "ai_feedback",
          "ai_suggested_rating",
          "state_before",
          "state_after",
          "stability_before",
          "stability_after",
          "difficulty_before",
          "difficulty_after",
          "scheduled_days",
          "request_retention",
          "learning_steps_after",
          "reviewed_at",
          "book_id",
          "card_id",
          "question_id",
        ],
        filterableColumns: ["book_id", "card_id", "question_id", "rating"],
        orderBy: [{ column: "reviewed_at", ascending: false }],
      },
      self_explanation: {
        entity: "self_explanation",
        table: "self_explanations",
        description: "One ungraded self-explanation interstitial (the user restating a lesson in their own words; a skip is recorded as a null response, never penalised).",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "Verified genuinely immutable: submitSelfExplanation (lib/self-mastery/session/build-session.ts) is the " +
          "ONLY write path in this repository and it only ever INSERTs -- grepped for every '.from(\"self_explanations\")' " +
          "call and found no UPDATE. No FK on this table targets it with an ON DELETE SET NULL/CASCADE action " +
          "that would mutate rather than remove it. created_at is a faithful proxy because nothing changes after it.",
        summaryColumns: ["prompt", "response", "lesson_id"],
        fullColumns: ["prompt", "response", "lesson_id", "created_at"],
        filterableColumns: ["lesson_id"],
        orderBy: [{ column: "created_at", ascending: false }],
      },
      lesson_promotion: {
        entity: "lesson_promotion",
        table: "lesson_promotions",
        description: "A lesson's action_template accepted by the user as a real, dated commitment ('the promotion IS the commitment') -- current state; `lesson_verdict` below is its append-only judgement log.",
        idColumn: "id",
        updatedAtColumn: "retired_at",
        updatedAtVerification:
          "Checked for non-code writers per the standing rule, and found exactly the active_workout_plans shape: " +
          "promoteLesson (lib/promotions/actions.ts) only ever INSERTs this row; the ONLY thing that ever changes " +
          "it afterward is trg_retire_promotion_on_terminal_verdict (migration 124), a DB TRIGGER that fires AFTER " +
          "INSERT on lesson_verdicts (a different table) and sets retired_at on this one -- no application code " +
          "path touches it directly. That trigger is also the row's ONLY possible mutation (guarded by " +
          "coalesce(retired_at, ...), so it fires at most once) -- retired_at is therefore a completely faithful " +
          "updated_at: null for an active (never-modified) promotion, set exactly once at the row's one real " +
          "change, never touched again.",
        summaryColumns: ["accepted_text", "lesson_id", "area_id", "retired_at"],
        fullColumns: ["accepted_text", "lesson_id", "area_id", "cadence", "cue", "started_at", "verdict_due_at", "retired_at", "created_at"],
        filterableColumns: ["lesson_id", "area_id"],
        orderBy: [{ column: "started_at", ascending: false }],
      },
      lesson_verdict: {
        entity: "lesson_verdict",
        table: "lesson_verdicts",
        description: "One append-only judgement (adopted / abandoned / still_testing) against a lesson_promotion. `still_testing` is non-terminal by design; adopted/abandoned retire the promotion via trigger.",
        idColumn: "id",
        updatedAtColumn: "verdict_at",
        updatedAtVerification: "lesson_verdicts_no_update (124) rejects ANY UPDATE/DELETE unconditionally, same append-only shape as `review` above -- verdict_at cannot go stale, no non-code-writer question applies.",
        summaryColumns: ["verdict", "promotion_id", "verdict_at"],
        fullColumns: ["verdict", "reason", "promotion_id", "verdict_at"],
        filterableColumns: ["promotion_id", "verdict"],
        orderBy: [{ column: "verdict_at", ascending: false }],
      },
      source: {
        entity: "source",
        table: "sources",
        description:
          "The queue-visibility record pairing this study engine to one book (CollegeOS pairs the same table to a " +
          "class via kind='course', kept out of this entity by fixedFilter -- see below). Existence/linkage only; " +
          "no content of its own.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification:
          "No created_at/updated_at column at all (068_ulm_sources.sql). Genuinely immutable in practice too: " +
          "books_create_source (069) is the ONLY writer anywhere (an AFTER INSERT trigger on `books`, not " +
          "application code -- checked, no '.from(\"sources\")' write call exists in this repository), and it only " +
          "ever INSERTs, never UPDATEs. Honestly null, not invented.",
        summaryColumns: ["book_id"],
        fullColumns: ["kind", "book_id"],
        // fixedFilter, not a denylist -- `sources` is the shared table this
        // file's own header names explicitly (num_nonnulls(book_id,
        // class_id)=1: ULM's books XOR CollegeOS's classes, one row shape,
        // two owners). Scoping this entity to kind='book' is the same
        // mechanism weekly_goals' domain-column fixedFilter uses to keep one
        // MCP entity from becoming a read path into a DIFFERENT domain's
        // rows through a shared table. `class_id` is excluded from
        // fullColumns for the same reason -- under this fixedFilter it is
        // guaranteed always null, so exposing it would only ever mislead.
        fixedFilter: { kind: "book" },
        filterableColumns: ["book_id"],
        orderBy: [{ column: "id", ascending: true }],
      },
      /**
       * NOT A ULM/book table -- CollegeOS's class-linked question bank,
       * unified into this SAME study engine's `review`/`card_state` log by
       * migration 111 (reviews.question_id / card_states.question_id, XOR
       * with card_id) specifically so "am I better calibrated on class
       * questions than on book cards" is one query, not two disjoint logs.
       * Registered under self_mastery, not school, on that basis -- it's
       * part of the retrieval-practice engine this domain is about, even
       * though its content comes from a class.
       *
       * VERIFICATION GAP, RESOLVED BY THE LEAD (measured, not judged):
       * grepped this entire repository for any '.from("questions")' call,
       * in either direction, and found NONE -- no Server Action, RPC
       * caller, or ingestion path anywhere in tracking-app creates, edits,
       * or retires a question. The table (and its real, NOT NULL
       * `updated_at` column) exists in production because migration 111
       * created it. The lead queried production directly rather than
       * leaving it at "presumably CollegeOS": zero triggers on `questions`,
       * zero rows in the table, zero rows where `updated_at >
       * created_at`. No evidence this column is EVER maintained by
       * anything. Ruling: `updatedAtColumn: null` -- a marker we cannot
       * verify is worse than an absent one (the lead's own words:
       * "absence is visible and a lie is not," the exact
       * active_workout_plans failure mode). Registering the real column
       * anyway would have been asserting a guarantee with zero evidence
       * behind it; if CollegeOS's own code starts maintaining it, that's a
       * one-line change made WITH evidence, not assumed now.
       */
      question: {
        entity: "question",
        table: "questions",
        description: "One retrieval-practice question from a class's question bank (CollegeOS). Scheduler state is NOT stored here -- it's replayed from `review`/`card_state`, same engine as book cards.",
        idColumn: "id",
        updatedAtColumn: null,
        updatedAtVerification: "See this entity's own header comment above -- the column is real (111_ulm_reviews_card_states_unify.sql) but production shows zero triggers, zero rows, and zero evidence it is ever maintained. Registering null rather than a marker nobody can verify.",
        summaryColumns: ["prompt", "topic", "active", "class_id"],
        fullColumns: ["prompt", "answer", "topic", "origin", "source_anchor", "source_skipped", "active", "class_id", "created_at", "updated_at"],
        filterableColumns: ["class_id", "active", "origin"],
        orderBy: [{ column: "created_at", ascending: false }],
      },
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
  settings: {
    domain: "settings",
    description: "Account-wide preferences: the profile row, ULM's per-user learning settings, and bring-your-own-key status (never the key itself).",
    entities: {
      profile: {
        entity: "profile",
        table: "profiles",
        description: "The one-row-per-account settings object: display/timezone/location, prayer-calc settings, check-in window, PIN-lock status, theme preset, and hidden nav features.",
        idColumn: "user_id",
        updatedAtColumn: null, // NEEDS a migration -- see docs/ai-connector/L11-migration-draft-cross-cutting-updated-at.sql
        updatedAtVerification:
          "MUTABLE, extremely widely: updateProfile (app/(app)/settings/actions.ts) upserts most of this row's columns (display_name/timezone/theme_preset/hidden_features/pin_hash/prayer settings/checkin window/etc.) on an EXISTING row for any settings change; skipCheckinsToday (app/(app)/checkin/actions.ts) updates paused_date directly. `created_at` is set once at account creation and goes stale the moment ANY setting is first changed -- no existing column is even a partial proxy. Flagged, not invented: draft migration staged, not self-numbered per ALLOCATIONS.md.",
        // pin_hash is EXCLUDED, same reasoning as user_api_keys.encrypted_key
        // below: it is credential material (a bcrypt hash of the user's
        // PIN), and the visibility registry (memo §3) is where that
        // exclusion is enforced by construction, not left to a `fields`
        // caller remembering not to ask. `pin_lock_enabled` (whether a PIN
        // is set at all) is exposed; the hash itself never is.
        summaryColumns: ["display_name", "timezone", "theme_preset"],
        fullColumns: [
          "display_name",
          "prayer_calc_method",
          "asr_madhab",
          "location_lat",
          "location_lng",
          "location_label",
          "timezone",
          "qada_owed",
          "pin_lock_enabled",
          "checkin_window_start",
          "checkin_window_end",
          "checkin_interval_minutes",
          "traveling_mode",
          "onboarding_completed",
          "paused_date",
          "tracking_started_on",
          "evening_close_time",
          "theme_preset",
          "hidden_features",
          "created_at",
        ],
        filterableColumns: [],
        orderBy: [{ column: "user_id", ascending: true }],
      },
      user_setting: {
        entity: "user_setting",
        table: "user_settings",
        description: "ULM's per-user learning settings: daily new-card limit, notification prefs, desired retention, AI grading opt-in, session length target, and weekday hour baselines (R58).",
        idColumn: "user_id",
        updatedAtColumn: null, // NEEDS a migration -- table has no created_at/updated_at at all today
        updatedAtVerification:
          "MUTABLE: saveWeekdayBaselines/clearWeekdayBaselines (app/(app)/settings/weekday-baseline-actions.ts) UPDATE an existing row; app/(app)/personal/self-mastery-session-actions.ts and lib/self-mastery/session/build-session.ts also touch this table. Confirmed directly against lib/supabase/database.types.ts's generated Row type: NO created_at or updated_at column exists at all -- nothing to even go stale, and nothing honest to declare here yet. Flagged, not invented: draft migration staged, not self-numbered.",
        summaryColumns: ["daily_new_limit", "notification_enabled", "session_target_minutes"],
        fullColumns: [
          "daily_new_limit",
          "notification_enabled",
          "notification_time",
          "desired_retention",
          "ai_grading_enabled",
          "session_target_minutes",
          "weekday_baselines",
        ],
        filterableColumns: [],
        orderBy: [{ column: "user_id", ascending: true }],
      },
      api_key: {
        entity: "api_key",
        table: "user_api_keys",
        description: "Bring-your-own-key status per provider -- existence, last 4 characters, and label ONLY. The encrypted key itself is never reachable over MCP, the same way source_chunks' text/embedding and profiles.pin_hash are not.",
        // READ-ONLY HERE, AND PERMANENTLY -- not a "not yet". Confirmed in
        // lib/mcp/write-registry.ts: `settings.api_key` has NO entity/
        // actions at all, unlike every other settings.* entity's deliberate
        // narrow-but-present write scope. team-lead's explicit ruling: a
        // model that could WRITE a provider key could exfiltrate one by
        // writing a key it controls -- the entire point of storing these
        // AES-256-GCM-encrypted (migration 104) is that nothing short of
        // the app's own verified provider round trip (saveApiKey's
        // verifyKey-before-store) should ever be trusted to accept one.
        // Same posture as user_api_keys.encrypted_key never being a
        // readable field: enforced by construction, not by a caller
        // remembering not to ask.

        // user_api_keys has NO single-column primary key -- its PK is the
        // COMPOSITE (user_id, provider) (migration 104). `provider` alone
        // is used as idColumn here deliberately: read.ts's id-lookup path
        // (readTool) always ANDs `.eq(def.idColumn, args.id)` with
        // `.eq("user_id", userId)`, so within one caller's own rows
        // `provider` IS the unique identifier -- it only fails to be
        // globally unique across the whole table, which this entity never
        // queries across (every query is user-scoped, by RLS and by the
        // belt-and-suspenders .eq("user_id", ...) read.ts always adds).
        //
        // THIS IS A PER-ENTITY ASSUMPTION, NOT A GENERAL RULE FOR COMPOSITE
        // PKS (team-lead's explicit flag on this entity) -- do not copy
        // "just pick the other half of a composite PK" onto a future
        // composite-PK table without re-checking it holds THERE. It works
        // here specifically because `provider` happens to be unique *within
        // one user's own rows* (the PK is literally (user_id, provider), so
        // fixing user_id via RLS + the belt-and-suspenders .eq leaves
        // provider alone doing all the remaining discrimination). A
        // composite PK whose non-user_id column is NOT unique per-user --
        // e.g. (user_id, week_start_date, domain) if that combination ever
        // became a table's PK -- would need either a real surrogate `id`
        // added, or idColumn left unable to express a single-row lookup at
        // all; there is no shortcut that generalizes from this one.
        idColumn: "provider",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "saveApiKey (app/(app)/settings/api-key-actions.ts) is the table's only UPDATE-shaped write path (an upsert on (user_id,provider) conflict) and explicitly sets `updated_at: new Date().toISOString()` on every call -- app-set, not trigger-maintained, but real and verified against the actual write, not inferred from the column existing. removeApiKey DELETEs the row outright rather than leaving a stale one, matching this registry's own unmarkPrayer precedent.",
        summaryColumns: ["provider", "key_last4"],
        // encrypted_key is not listed in fullColumns at all -- the same
        // allowlist-not-denylist mechanism as source_chunks' empty columns:
        // a `fields` request naming it is rejected by read.ts's
        // resolveColumns, not silently trimmed.
        fullColumns: ["provider", "key_last4", "label", "created_at", "updated_at"],
        filterableColumns: ["provider"],
        orderBy: [{ column: "provider", ascending: true }],
      },
    },
  },
  checkins: {
    domain: "checkins",
    description: "The per-window check-in prompt/answer log and the domain-minute allocations recorded against each answered allocation-style check-in.",
    entities: {
      checkin: {
        entity: "checkin",
        table: "checkins",
        description: "One check-in prompt and its answer -- either a legacy point-sample (`kind:\"point\"`, a single tag) or a windowed allocation prompt (`kind:\"allocation\"`, paired with `allocation` rows below).",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "INSERT-ONLY, all three write paths checked: answerCheckin and recordMissedCheckin (app/(app)/checkin/actions.ts) each INSERT a new row; save_allocation_checkin (migrations 020/022/108's RPC) also only INSERTs, and its unique_violation exception branch SELECTs the pre-existing row rather than updating it. No UPDATE on this table exists anywhere. created_at IS the true last-modified time, same append-only reasoning as deen.quran_session.",
        summaryColumns: ["checkin_time", "kind", "answered", "tag_type"],
        fullColumns: [
          "checkin_time",
          "kind",
          "answered",
          "tag_type",
          "tag_label",
          "tag_ref_id",
          "work_session_id",
          "window_start",
          "window_end",
          "created_at",
        ],
        filterableColumns: ["kind", "answered", "tag_type"],
        orderBy: [{ column: "checkin_time", ascending: false }],
      },
      allocation: {
        entity: "allocation",
        table: "checkin_allocations",
        description:
          "One domain's minutes for one allocation-style checkin. `domain` is nullable and `is_wasted` is a separate boolean (migration 108's sentinel split) -- an unaccounted-time row is `domain: null, is_wasted: true`, never a literal domain named \"wasted\". Not shared with any other MCP domain (its own `domain` column is a tag on ITS OWN rows, not a foreign table's ownership discriminator), so no fixedFilter is needed here the way weekly_goal/task/schedule_event need one.",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "INSERT-ONLY: written exclusively inside save_allocation_checkin's per-domain insert loop plus its is_wasted row (migration 108) -- never updated after insert, and the RPC's own conflict branch returns the existing checkin_id without touching any checkin_allocations row a second time. created_at IS the true last-modified time.",
        summaryColumns: ["checkin_id", "domain", "minutes", "is_wasted"],
        fullColumns: ["checkin_id", "domain", "minutes", "is_wasted", "created_at"],
        filterableColumns: ["checkin_id", "domain", "is_wasted"],
        orderBy: [{ column: "created_at", ascending: false }],
      },
    },
  },
  distractions: {
    domain: "distractions",
    description: "Named distraction triggers, the moments they fire, the action plan currently in force for each, and the daily followed/skipped outcome log that drives plan rewrites.",
    entities: {
      trigger: {
        entity: "trigger",
        table: "distraction_triggers",
        description: "A named, domain-tagged distraction (e.g. \"phone during study block\"). `archived` soft-deletes it out of pickers without losing its history.",
        idColumn: "id",
        updatedAtColumn: null, // NEEDS a migration -- see docs/ai-connector/L11-migration-draft-cross-cutting-updated-at.sql
        updatedAtVerification:
          "MUTABLE: updateTrigger (app/(app)/distractions/actions.ts) UPDATEs name/description on an existing row post-creation, so created_at goes stale on the first edit. (No write path currently sets archived:true -- grepped for `archived: true`/`archiveTrigger` and found neither -- but the name/description edit path alone is enough to need this.) Flagged, not invented: draft migration staged, not self-numbered.",
        summaryColumns: ["domain", "name", "archived"],
        fullColumns: ["domain", "name", "description", "archived", "created_at"],
        filterableColumns: ["domain", "archived"],
        orderBy: [{ column: "created_at", ascending: false }],
      },
      event: {
        entity: "event",
        table: "distraction_events",
        description: "One firing of a trigger on one local date, optionally paired with a tiered self-reflection (see deen.reflection_entry for the linked row).",
        idColumn: "id",
        updatedAtColumn: "created_at",
        updatedAtVerification:
          "INSERT-ONLY: insertEvent (app/(app)/distractions/actions.ts, the only writer for this table) always INSERTs; no update or delete path for distraction_events exists anywhere in actions.ts. created_at IS the true last-modified time.",
        summaryColumns: ["trigger_id", "date", "reflection_tier"],
        fullColumns: ["trigger_id", "date", "reflection_tier", "reflection_entry_id", "created_at"],
        filterableColumns: ["trigger_id", "date"],
        orderBy: [{ column: "date", ascending: false }],
      },
      action_plan: {
        entity: "action_plan",
        table: "trigger_action_plans",
        description: "One versioned action plan for a trigger. Exactly one row per trigger has `superseded_at: null` (the current plan, enforced by trigger_action_plans_one_current) -- prior versions stay readable for history.",
        idColumn: "id",
        updatedAtColumn: null, // NEEDS a migration -- see docs/ai-connector/L11-migration-draft-cross-cutting-updated-at.sql
        updatedAtVerification:
          "MUTABLE two different ways: saveActionPlan's direct branch (app/(app)/distractions/actions.ts) UPDATEs an existing current plan's `body` in place with no version bump; separately, save_trigger_plan (migration 041's RPC) UPDATEs the OLD row's superseded_at/supersede_reason the moment a new version is authored -- a change to a row that already has its own created_at. No column reflects either kind of change today. Flagged, not invented: draft migration staged, not self-numbered.",
        summaryColumns: ["trigger_id", "version", "superseded_at"],
        fullColumns: ["trigger_id", "body", "version", "superseded_at", "supersede_reason", "created_at"],
        filterableColumns: ["trigger_id", "version"],
        orderBy: [
          { column: "trigger_id", ascending: true },
          { column: "version", ascending: false },
        ],
      },
      plan_outcome: {
        entity: "plan_outcome",
        table: "trigger_plan_outcomes",
        description: "One day's followed/skipped answer for a trigger's then-current plan. At most one row per (user, trigger, date) -- a same-day resubmission overwrites, it does not accumulate.",
        idColumn: "id",
        updatedAtColumn: null, // NEEDS a migration -- see docs/ai-connector/L11-migration-draft-cross-cutting-updated-at.sql
        updatedAtVerification:
          "MUTABLE: record_plan_outcome (migration 043's RPC) does `insert ... on conflict (user_id, trigger_id, date) do update set followed = excluded.followed, plan_id = excluded.plan_id` -- a same-day resubmission genuinely overwrites an existing row, and created_at (the table's only timestamp) goes stale for that row. Flagged, not invented: draft migration staged, not self-numbered.",
        summaryColumns: ["trigger_id", "date", "followed"],
        fullColumns: ["trigger_id", "plan_id", "date", "followed", "created_at"],
        filterableColumns: ["trigger_id", "date", "followed"],
        orderBy: [{ column: "date", ascending: false }],
      },
    },
  },
  /**
   * `calendar`, `review`, and `home` are REGISTERED regardless of how few
   * (or zero) entities each owns, deliberately, not left out of REGISTRY
   * entirely -- `list_capabilities()` should report their existence (and
   * this comment's reasoning, via their `description`) the same honest way
   * source_chunks reports existing but unreadable, rather than a caller
   * getting an "unknown domain" error for something the owner explicitly
   * named as in scope.
   *
   * Read each surface's own Server Action before concluding this
   * (app/(app)/calendar/actions.ts's getWeekCalendar, app/(app)/review/
   * actions.ts's getReviewData, app/(app)/close/actions.ts's
   * getEveningCloseData) rather than assuming from the route names:
   *
   * CALENDAR aggregates schedule_events, weekly_goals, tasks, quran_sessions,
   * active_workout_plans/plan_sessions -- every row it renders is already
   * owned by another domain's own table (deen/business/school/fitness). It
   * introduces NO table or row of its own. A caller who wants this data
   * reads it through deen/business/school/fitness's own entities.
   *
   * REVIEW/CLOSE is almost the same story (distraction_triggers/
   * trigger_action_plans/trigger_plan_outcomes -- covered above by
   * `distractions`; work_sessions -- covered by work.work_session;
   * user_settings.weekday_baselines -- covered by settings.user_setting)
   * WITH ONE GENUINE EXCEPTION, now closed rather than left flagged: the
   * Night Plan's own rows on `tasks` -- `mit_rank`/`planned_date`/
   * `dump_source` with `domain IS NULL` (migrations 113/119/120; see
   * app/(app)/close/plan-actions.ts's dumpLine/savePlanRanks). These were
   * NOT reachable through school.task above, which fixedFilters
   * `domain: "school"` -- a plain fixedFilter was an `.eq()`, and
   * `domain IS NULL` cannot be expressed as one. Closed by widening
   * `fixedFilter`'s value type to accept an explicit `{ is: null }`
   * discriminant (see EntityDef's own `FixedFilterValue` comment) rather
   * than a denormalized boolean column on `tasks` -- the mechanism-not-a-
   * one-off bar was already met by two independent needs
   * (`review.night_plan_task` below AND migration 108's own
   * `checkin_allocations.domain IS NULL` sentinel, which could adopt the
   * same shape later if it's ever split into its own fixedFilter-scoped
   * entity). `review.night_plan_task` below is the first real user of it.
   *
   * HOME is aggregation only, no tables of its own (the owner's own
   * framing, quoted in the task that added these three domains).
   */
  calendar: {
    domain: "calendar",
    description:
      "The week-view calendar surface. Aggregates deen/business/school/fitness's own scheduling data (schedule_events, weekly_goals, tasks, quran_sessions, plan_sessions) -- it has no table of its own. Read the underlying rows through each owning domain's own entities.",
    entities: {},
  },
  review: {
    domain: "review",
    description:
      "The evening-close/night-plan ceremony and its Review popup. Mostly an aggregation of distractions' own entities (trigger/action_plan/plan_outcome above), work.work_session, and settings.user_setting -- plus its own genuinely-owned slice of `tasks`, the Night Plan's dumped/ranked items (domain IS NULL), below.",
    entities: {
      night_plan_task: {
        entity: "night_plan_task",
        table: "tasks",
        description:
          "One Night Plan item: a line dumped during the evening-close ceremony (app/(app)/close/plan-actions.ts's dumpLine), optionally starred/crowned for the next day (mit_rank 1-3 via savePlanRanks). Scoped to `domain IS NULL` rows only -- school's and co_op's own tasks (domain='school'/'co_op') are NOT this entity, see school.task above.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Same table, same migration as school.task above: migration 136 added a real trigger-backed updated_at to ALL of `tasks` (not scoped by domain), reusing 074's touch_updated_at(). dumpLine INSERTs; savePlanRanks UPDATEs mit_rank on existing rows (clear-then-set, see its own header) -- both write paths are covered by the same trigger school.task already relies on.",
        summaryColumns: ["title", "planned_date", "mit_rank", "completed"],
        fullColumns: ["title", "planned_date", "mit_rank", "dump_source", "completed", "completed_at", "created_at", "updated_at"],
        filterableColumns: ["planned_date", "mit_rank", "completed", "dump_source"],
        orderBy: [
          { column: "planned_date", ascending: false },
          { column: "created_at", ascending: false },
        ],
        // The null-discriminant this entity exists to prove out -- see
        // FixedFilterValue's own comment and this file's header comment
        // just above `calendar`. `domain` is NOT in filterableColumns: a
        // caller widening it to a real value would just be school.task or
        // a future co_op.task by another name, the exact cross-domain leak
        // fixedFilter exists to prevent.
        fixedFilter: { domain: { is: null } },
      },
    },
  },
  home: {
    domain: "home",
    description: "The Home dashboard. Aggregation only, no tables of its own -- every number it shows is read through some other domain's own entity.",
    entities: {},
  },
  widgets: {
    domain: "widgets",
    description:
      "L11/R7 Tier 1 declarative widgets -- a config row rendered by one audited renderer, never agent-authored code. " +
      "Created/edited/deleted through the dedicated widget_manage tool, not write() -- this entity exists so a caller can " +
      "list/inspect its own widgets through the same read() dispatch as everything else. REQUIRES the proposed " +
      "mcp_widgets table (docs/ai-connector/WIDGETS-MIGRATION-NEEDED.md) -- inert until that migration is applied.",
    entities: {
      widget: {
        entity: "widget",
        table: "mcp_widgets",
        description: "One dashboard widget: kind, title, its data source (a reference into another entity this registry already exposes), display options, slot, and position.",
        idColumn: "id",
        updatedAtColumn: "updated_at",
        updatedAtVerification:
          "Built with a real trigger-backed updated_at from day one (touch_updated_at(), migration 074) in the table's own proposal doc -- not retrofitted later the way 133/135/136/137/138 each had to be. createWidgetCore/updateWidgetCore/archiveWidgetCore (lib/widgets/actions-core.ts) are the ONLY write paths -- all three go through a plain INSERT/UPDATE the trigger covers. Checked for non-code writers per the team-lead's standing rule: the table's one FK (user_id -> auth.users, ON DELETE CASCADE) only ever DELETEs this row on account deletion, never UPDATEs it, so there is no cascade path that could touch updated_at without going through the trigger.",
        summaryColumns: ["kind", "title", "slot", "position", "status"],
        fullColumns: ["kind", "title", "data_source", "display", "slot", "position", "status", "created_at", "updated_at", "user_id"],
        filterableColumns: ["kind", "slot", "status"],
        orderBy: [
          { column: "slot", ascending: true },
          { column: "position", ascending: true },
        ],
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
