import { describe, expect, it } from "vitest";
import { REGISTRY, listDomains, getDomain, getEntity } from "../registry";

describe("registry", () => {
  it("lists exactly the domains actually wired for L3 — deen and self_mastery, nothing aspirational", () => {
    expect(listDomains().map((d) => d.domain).sort()).toEqual(["deen", "self_mastery"]);
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

  it("getEntity returns null for a known domain but unknown entity", () => {
    expect(getEntity("deen", "habit")).toBeNull();
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
});
