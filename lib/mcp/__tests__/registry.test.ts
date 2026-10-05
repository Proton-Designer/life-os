import { describe, expect, it } from "vitest";
import { REGISTRY, listDomains, getDomain, getEntity } from "../registry";

describe("registry", () => {
  it("lists exactly the domains actually wired so far", () => {
    expect(listDomains().map((d) => d.domain).sort()).toEqual([
      "business",
      "calendar",
      "checkins",
      "deen",
      "distractions",
      "fitness",
      "home",
      "review",
      "school",
      "self_mastery",
      "settings",
      "widgets",
      "work",
    ]);
  });

  it("self_mastery/source_chunks is registered but exposes ZERO columns — existence only, content deliberately unreachable", () => {
    const entity = getEntity("self_mastery", "source_chunks");
    expect(entity).not.toBeNull();
    expect(entity!.summaryColumns).toEqual([]);
    expect(entity!.fullColumns).toEqual([]);
    expect(entity!.filterableColumns).toEqual([]);
  });

  it("getDomain returns null for an unregistered domain, never throws", () => {
    expect(getDomain("nonexistent_domain")).toBeNull();
  });

  it("getEntity returns null for a known domain but a truly unknown entity", () => {
    expect(getEntity("deen", "fasting")).toBeNull();
  });

  it("deen has exactly the 10 entities wired (prayer + the 7 added once 131/133 landed + quran_plan, QURAN-01 + weekly_goal read, the write's missing other half)", () => {
    expect(Object.keys(REGISTRY.deen.entities).sort()).toEqual([
      "adhkar",
      "habit",
      "habit_log",
      "prayer",
      "quran_plan",
      "quran_session",
      "reflection_entry",
      "sunnah_log",
      "weekly_focus",
      "weekly_goal",
    ]);
  });

  it("every entity records a non-empty updatedAtVerification — the one-line 'how was this checked' note, never skipped", () => {
    for (const domain of Object.values(REGISTRY)) {
      for (const entity of Object.values(domain.entities)) {
        expect(entity.updatedAtVerification.length).toBeGreaterThan(10);
      }
    }
  });

  it("append-only entities (quran_session, reflection_entry) use created_at, not a fabricated column", () => {
    expect(getEntity("deen", "quran_session")!.updatedAtColumn).toBe("created_at");
    expect(getEntity("deen", "reflection_entry")!.updatedAtColumn).toBe("created_at");
  });

  it("genuinely mutable entities use the real trigger-backed updated_at migration 133 adds — never created_at", () => {
    for (const entity of ["sunnah_log", "adhkar", "habit", "habit_log", "weekly_focus"]) {
      expect(getEntity("deen", entity)!.updatedAtColumn).toBe("updated_at");
    }
  });

  it("getEntity returns null for an unknown domain regardless of entity name", () => {
    expect(getEntity("fitness", "prayer")).toBeNull();
  });

  it("the deen/prayer entity's fullColumns is a superset of summaryColumns — detail:'full' must never return LESS than 'summary'", () => {
    const entity = getEntity("deen", "prayer");
    expect(entity).not.toBeNull();
    for (const col of entity!.summaryColumns) {
      expect(entity!.fullColumns).toContain(col);
    }
  });

  it("every filterableColumn is actually selectable (present in fullColumns) — filtering on an unselectable column would be incoherent", () => {
    for (const domain of Object.values(REGISTRY)) {
      for (const entity of Object.values(domain.entities)) {
        for (const col of entity.filterableColumns) {
          expect(entity.fullColumns).toContain(col);
        }
      }
    }
  });

  it("every orderBy column is listed somewhere in the entity's own columns (sortable implies visible)", () => {
    for (const domain of Object.values(REGISTRY)) {
      for (const entity of Object.values(domain.entities)) {
        for (const { column } of entity.orderBy) {
          expect(
            entity.fullColumns.includes(column) || column === entity.idColumn || column === entity.updatedAtColumn,
          ).toBe(true);
        }
      }
    }
  });

  it("migration 135's 4 tables now use the real trigger-backed updated_at — no longer honestly null", () => {
    for (const [domain, entity] of [
      ["work", "target"],
      ["work", "task"],
      ["business", "kill_list_item"],
      ["business", "weekly_goal"],
    ] as const) {
      const def = getEntity(domain, entity)!;
      expect(def.updatedAtColumn).toBe("updated_at");
      expect(def.fullColumns).toContain("updated_at");
    }
  });

  it("work.work_session is trigger-backed via migration 146 — ended_at stopped being faithful once goal_minutes/class_id could change without it", () => {
    expect(getEntity("work", "work_session")!.updatedAtColumn).toBe("updated_at");
  });

  it("school has exactly the 6 read entities wired (task, class, class_assessment, schedule_event, schedule_event_override, schedule_event_cancellation)", () => {
    expect(Object.keys(REGISTRY.school.entities).sort()).toEqual([
      "class",
      "class_assessment",
      "schedule_event",
      "schedule_event_cancellation",
      "schedule_event_override",
      "task",
    ]);
  });

  it("school's override/cancellation entities are parentFilter-scoped to one schedule_events row, domain='school' — retrofitted once fitness needed the same mechanism", () => {
    for (const entity of ["schedule_event_override", "schedule_event_cancellation"]) {
      const def = getEntity("school", entity)!;
      expect(def.parentFilter).toEqual({ column: "event_id", parentTable: "schedule_events", parentIdColumn: "id", parentFixedFilter: { domain: "school" } });
      expect(def.filterableColumns).toContain("event_id");
    }
  });

  it("schedule_event_cancellation stays created_at — migration 136 deliberately excluded it (ignoreDuplicates upsert never fires the trigger)", () => {
    expect(getEntity("school", "schedule_event_cancellation")!.updatedAtColumn).toBe("created_at");
  });

  it("schedule_event_override uses the real trigger-backed updated_at from migration 136", () => {
    expect(getEntity("school", "schedule_event_override")!.updatedAtColumn).toBe("updated_at");
  });

  it("school.task and school.schedule_event are fixedFilter-scoped to domain='school' — both tables are shared with co_op", () => {
    expect(getEntity("school", "task")!.fixedFilter).toEqual({ domain: "school" });
    expect(getEntity("school", "schedule_event")!.fixedFilter).toEqual({ domain: "school" });
  });

  it("school.class and school.class_assessment have no fixedFilter — neither table is shared with another domain", () => {
    expect(getEntity("school", "class")!.fixedFilter).toBeUndefined();
    expect(getEntity("school", "class_assessment")!.fixedFilter).toBeUndefined();
  });

  it("migration 136's 4 registered school entities now use the real trigger-backed updated_at — no longer honestly null", () => {
    for (const entity of ["task", "class", "class_assessment", "schedule_event"]) {
      const def = getEntity("school", entity)!;
      expect(def.updatedAtColumn).toBe("updated_at");
      expect(def.fullColumns).toContain("updated_at");
    }
  });

  it("school.class never exposes syllabus_path — an internal storage path, not a fetchable value", () => {
    expect(getEntity("school", "class")!.fullColumns).not.toContain("syllabus_path");
  });

  it("fitness has exactly the 15 named tables' worth of read entities wired", () => {
    expect(Object.keys(REGISTRY.fitness.entities).sort()).toEqual([
      "active_workout_plan",
      "body_metric",
      "exercise",
      "fitness_benchmark",
      "fitness_cycle_anchor",
      "plan_micro_exercise",
      "plan_session",
      "plan_session_exercise",
      "rep_goal",
      "session_set",
      "workout",
      "workout_exercise",
      "workout_plan",
      "workout_schedule",
      "workout_session",
    ]);
  });

  it("fitness's 5 parent-owned child tables are all parentFilter-scoped, never a flat cross-parent list", () => {
    expect(getEntity("fitness", "workout_exercise")!.parentFilter).toEqual({ column: "workout_id", parentTable: "workouts", parentIdColumn: "id" });
    expect(getEntity("fitness", "plan_session")!.parentFilter).toEqual({ column: "plan_id", parentTable: "workout_plans", parentIdColumn: "id" });
    expect(getEntity("fitness", "plan_session_exercise")!.parentFilter).toEqual({ column: "session_id", parentTable: "plan_sessions", parentIdColumn: "id" });
    expect(getEntity("fitness", "plan_micro_exercise")!.parentFilter).toEqual({ column: "plan_id", parentTable: "workout_plans", parentIdColumn: "id" });
    expect(getEntity("fitness", "session_set")!.parentFilter).toEqual({ column: "session_id", parentTable: "workout_sessions", parentIdColumn: "id" });
  });

  it("fitness's top-level/flat entities have no parentFilter — exercise, workout_plan, workout, body_metric, fitness_benchmark, workout_schedule, active_workout_plan, fitness_cycle_anchor, rep_goal, workout_session are each legitimately browsed unscoped", () => {
    for (const entity of ["exercise", "workout_plan", "workout", "body_metric", "fitness_benchmark", "workout_schedule", "active_workout_plan", "fitness_cycle_anchor", "rep_goal", "workout_session"]) {
      expect(getEntity("fitness", entity)!.parentFilter).toBeUndefined();
    }
  });

  it("append-only fitness entities (workout_session, session_set, fitness_cycle_anchor, rep_goal) use created_at, never a fabricated column", () => {
    for (const entity of ["workout_session", "session_set", "fitness_cycle_anchor", "rep_goal"]) {
      expect(getEntity("fitness", entity)!.updatedAtColumn).toBe("created_at");
    }
  });

  it("active_workout_plan uses its real, app-set updated_at — already faithful, no migration needed", () => {
    expect(getEntity("fitness", "active_workout_plan")!.updatedAtColumn).toBe("updated_at");
  });

  it("fitness's genuinely-mutated-in-place entities are trigger-backed via migration 138 (docs/ai-connector/FITNESS-UPDATED-AT-NEEDED.md, applied)", () => {
    for (const entity of ["body_metric", "fitness_benchmark", "exercise", "workout", "workout_plan"]) {
      expect(getEntity("fitness", entity)!.updatedAtColumn).toBe("updated_at");
    }
  });

  it("fitness's delete-then-reinsert-shaped children (no timestamp column exists at all, and never will need one) are also null, but deliberately NOT proposed as a migration", () => {
    for (const entity of ["workout_exercise", "plan_session", "plan_session_exercise", "plan_micro_exercise", "workout_schedule"]) {
      expect(getEntity("fitness", entity)!.updatedAtColumn).toBeNull();
    }
  });

  it("active_workout_plan and fitness_cycle_anchor use user_id as their idColumn — singleton-per-user tables, same pattern as settings.profile/settings.user_setting", () => {
    expect(getEntity("fitness", "active_workout_plan")!.idColumn).toBe("user_id");
    expect(getEntity("fitness", "fitness_cycle_anchor")!.idColumn).toBe("user_id");
  });
});
