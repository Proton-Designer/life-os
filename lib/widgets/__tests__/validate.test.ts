import { describe, expect, it } from "vitest";
import { validateDataSource, validateDisplay, validateKind, validateSlot } from "../validate";

describe("validateDataSource", () => {
  it("rejects an unknown domain", () => {
    expect(() => validateDataSource({ domain: "nope", entity: "whatever" })).toThrow(/unknown domain/i);
  });

  it("rejects an unknown entity for a known domain", () => {
    expect(() => validateDataSource({ domain: "deen", entity: "nope" })).toThrow(/unknown entity/i);
  });

  it("rejects a filter column that isn't in the entity's filterableColumns", () => {
    expect(() => validateDataSource({ domain: "deen", entity: "prayer", filter: { logged_at: "2026-09-08" } })).toThrow(/not filterable/i);
  });

  it("requires the parentFilter column for a parent-scoped entity", () => {
    // school.schedule_event_override is parentFilter-scoped per registry.ts —
    // reading it unscoped ("every override the user has ever owned, across
    // every event") is exactly the flat-list shape parentFilter exists to
    // block (TOOL-ARCHITECTURE.md §5).
    expect(() => validateDataSource({ domain: "school", entity: "schedule_event_override" })).toThrow(/requires data_source\.filter/i);
  });

  it("accepts a valid data source and returns the entity's real fullColumns", () => {
    const { dataSource, fullColumns } = validateDataSource({ domain: "deen", entity: "prayer" });
    expect(dataSource).toEqual({ domain: "deen", entity: "prayer", filter: undefined });
    expect(fullColumns.length).toBeGreaterThan(0);
  });

  // The hard structural requirement from the lead: a widget must never
  // become a path to a column the visibility registry excludes. This is
  // the DATA SOURCE half of the two checks that make that true — the
  // entity is resolvable (it's registered, on purpose, per its own
  // "existence is not secret, content is" comment), but its allowlist is
  // registered EMPTY, so there is nothing for a widget's display to ever
  // point at. See validateDisplay's tests below for the DISPLAY half.
  it("resolves self_mastery.source_chunks (the deliberately excluded book-text entity) but hands back an EMPTY fullColumns", () => {
    const { fullColumns } = validateDataSource({ domain: "self_mastery", entity: "source_chunks" });
    expect(fullColumns).toEqual([]);
  });
});

describe("validateDisplay — refuses any field outside the data source's fullColumns", () => {
  it("refuses a metric_card display field on source_chunks (raw book text) — the excluded-column case the lead asked to be proven", () => {
    const { fullColumns } = validateDataSource({ domain: "self_mastery", entity: "source_chunks" });
    expect(() => validateDisplay("metric_card", { aggregate: "field", field: "text" }, fullColumns)).toThrow(/not a column on this widget's data source/i);
  });

  it("refuses a list titleField on source_chunks the same way", () => {
    const { fullColumns } = validateDataSource({ domain: "self_mastery", entity: "source_chunks" });
    expect(() => validateDisplay("list", { titleField: "embedding" }, fullColumns)).toThrow(/not a column on this widget's data source/i);
  });

  it("refuses settings.api_key's encrypted_key (a credential, never a bare table exposure) the same way", () => {
    const { fullColumns } = validateDataSource({ domain: "settings", entity: "api_key" });
    expect(fullColumns).not.toContain("encrypted_key");
    expect(() => validateDisplay("metric_card", { aggregate: "field", field: "encrypted_key" }, fullColumns)).toThrow(/not a column/i);
  });

  it("refuses settings.profile's pin_hash the same way", () => {
    const { fullColumns } = validateDataSource({ domain: "settings", entity: "profile" });
    expect(fullColumns).not.toContain("pin_hash");
    expect(() => validateDisplay("metric_card", { aggregate: "field", field: "pin_hash" }, fullColumns)).toThrow(/not a column/i);
  });

  it("accepts a metric_card count display unconditionally (no field to check)", () => {
    expect(validateDisplay("metric_card", { aggregate: "count" }, [])).toEqual({ aggregate: "count" });
  });

  it("accepts a metric_card field display when the field IS in fullColumns", () => {
    const { fullColumns } = validateDataSource({ domain: "deen", entity: "prayer" });
    const field = fullColumns[0];
    expect(validateDisplay("metric_card", { aggregate: "field", field }, fullColumns)).toEqual({ aggregate: "field", field });
  });

  it("rejects a metric_card display with neither 'count' nor 'field'", () => {
    expect(() => validateDisplay("metric_card", { aggregate: "sum" }, [])).toThrow(/must be 'count' or 'field'/);
  });

  it("accepts a list display with a valid titleField, optional subtitleField, and default limit", () => {
    const { fullColumns } = validateDataSource({ domain: "deen", entity: "prayer" });
    const [titleField, subtitleField] = fullColumns;
    expect(validateDisplay("list", { titleField }, fullColumns)).toEqual({ titleField, subtitleField: undefined, limit: 5 });
    expect(validateDisplay("list", { titleField, subtitleField }, fullColumns)).toEqual({ titleField, subtitleField, limit: 5 });
  });

  it("rejects a list limit outside 1-10", () => {
    const { fullColumns } = validateDataSource({ domain: "deen", entity: "prayer" });
    const titleField = fullColumns[0];
    expect(() => validateDisplay("list", { titleField, limit: 0 }, fullColumns)).toThrow(/between 1 and 10/);
    expect(() => validateDisplay("list", { titleField, limit: 11 }, fullColumns)).toThrow(/between 1 and 10/);
  });

  // R11's first extended-vocabulary kind -- same discipline as metric_card/list:
  // a "count" aggregate needs no field (nothing to check), a "sum" aggregate
  // MUST name a column inside fullColumns, and the excluded-column proof
  // (source_chunks/encrypted_key/pin_hash) applies here too, not just to the
  // two original kinds.
  describe("progress_against_goal", () => {
    it("accepts a count aggregate with a positive goal", () => {
      expect(validateDisplay("progress_against_goal", { aggregate: { type: "count" }, goal: 20 }, [])).toEqual({
        aggregate: { type: "count" },
        goal: 20,
      });
    });

    it("accepts a sum aggregate when the field IS in fullColumns", () => {
      const { fullColumns } = validateDataSource({ domain: "deen", entity: "prayer" });
      const field = fullColumns[0];
      expect(validateDisplay("progress_against_goal", { aggregate: { type: "sum", field }, goal: 50 }, fullColumns)).toEqual({
        aggregate: { type: "sum", field },
        goal: 50,
      });
    });

    it("refuses a sum aggregate's field on source_chunks (raw book text) — the same excluded-column proof as metric_card/list", () => {
      const { fullColumns } = validateDataSource({ domain: "self_mastery", entity: "source_chunks" });
      expect(() => validateDisplay("progress_against_goal", { aggregate: { type: "sum", field: "text" }, goal: 10 }, fullColumns)).toThrow(
        /not a column on this widget's data source/i,
      );
    });

    it("rejects a missing/non-positive/non-finite goal", () => {
      expect(() => validateDisplay("progress_against_goal", { aggregate: { type: "count" } }, [])).toThrow(/goal is required/i);
      expect(() => validateDisplay("progress_against_goal", { aggregate: { type: "count" }, goal: 0 }, [])).toThrow(/goal is required/i);
      expect(() => validateDisplay("progress_against_goal", { aggregate: { type: "count" }, goal: -5 }, [])).toThrow(/goal is required/i);
      expect(() => validateDisplay("progress_against_goal", { aggregate: { type: "count" }, goal: Infinity }, [])).toThrow(/goal is required/i);
    });

    it("rejects an aggregate.type outside 'count'/'sum'", () => {
      expect(() => validateDisplay("progress_against_goal", { aggregate: { type: "average" }, goal: 10 }, [])).toThrow(/must be 'count' or 'sum'/);
    });

    it("rejects a sum aggregate with no field", () => {
      expect(() => validateDisplay("progress_against_goal", { aggregate: { type: "sum" }, goal: 10 }, [])).toThrow(/aggregate\.field is required/i);
    });
  });
});

describe("validateKind / validateSlot", () => {
  it("accepts the three real kinds and rejects anything else", () => {
    expect(validateKind("metric_card")).toBe("metric_card");
    expect(validateKind("list")).toBe("list");
    expect(validateKind("progress_against_goal")).toBe("progress_against_goal");
    expect(() => validateKind("chart")).toThrow(/kind must be one of/);
  });

  it("defaults slot to 'home' when omitted, and rejects anything but 'home'", () => {
    expect(validateSlot(undefined)).toBe("home");
    expect(validateSlot("home")).toBe("home");
    expect(() => validateSlot("sidebar")).toThrow(/slot must be one of/);
  });
});
