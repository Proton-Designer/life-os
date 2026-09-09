import { describe, expect, it } from "vitest";
import { REGISTRY, listDomains, getDomain, getEntity } from "../registry";

describe("registry", () => {
  it("lists exactly the domains actually wired so far — deen, self_mastery, work, business, school", () => {
    expect(listDomains().map((d) => d.domain).sort()).toEqual(["business", "deen", "school", "self_mastery", "work"]);
  });

  it("self_mastery/source_chunks is registered but exposes ZERO columns — existence only, content deliberately unreachable", () => {
    const entity = getEntity("self_mastery", "source_chunks");
    expect(entity).not.toBeNull();
    expect(entity!.summaryColumns).toEqual([]);
    expect(entity!.fullColumns).toEqual([]);
    expect(entity!.filterableColumns).toEqual([]);
  });

  it("getDomain returns null for an unregistered domain, never throws", () => {
    expect(getDomain("fitness")).toBeNull();
  });

  it("getEntity returns null for a known domain but a truly unknown entity", () => {
    expect(getEntity("deen", "fasting")).toBeNull();
  });

  it("deen has exactly the 8 entities wired (prayer + the 7 added once 131/133 landed)", () => {
    expect(Object.keys(REGISTRY.deen.entities).sort()).toEqual([
      "adhkar",
      "habit",
      "habit_log",
      "prayer",
      "quran_session",
      "reflection_entry",
      "sunnah_log",
      "weekly_focus",
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

  it("work.work_session keeps ended_at — migration 135 deliberately excluded it (already faithful)", () => {
    expect(getEntity("work", "work_session")!.updatedAtColumn).toBe("ended_at");
  });

  it("school has exactly the 4 read entities wired (task, class, class_assessment, schedule_event) — overrides/cancellations deliberately excluded, see schedule_event's own comment", () => {
    expect(Object.keys(REGISTRY.school.entities).sort()).toEqual(["class", "class_assessment", "schedule_event", "task"]);
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
});
