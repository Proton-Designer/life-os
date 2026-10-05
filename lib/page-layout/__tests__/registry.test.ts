import { describe, expect, it } from "vitest";
import { WIDGET_REGISTRY, DOMAIN_KEYS, widgetsForDomain, findWidget } from "../registry";

describe("WIDGET_REGISTRY", () => {
  it("every entry has a non-empty widgetKey, domainKey, label, and description", () => {
    for (const w of WIDGET_REGISTRY) {
      expect(w.widgetKey.length).toBeGreaterThan(0);
      expect(w.domainKey.length).toBeGreaterThan(0);
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.description.length).toBeGreaterThan(0);
    }
  });

  it("(domainKey, widgetKey) is unique -- no domain accidentally registers the same widget twice", () => {
    const seen = new Set<string>();
    for (const w of WIDGET_REGISTRY) {
      const key = `${w.domainKey}:${w.widgetKey}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("defaultPosition is a contiguous 0-based sequence within each domain, matching declaration order", () => {
    for (const domainKey of DOMAIN_KEYS) {
      const positions = widgetsForDomain(domainKey).map((w) => w.defaultPosition);
      expect(positions).toEqual(positions.map((_, i) => i));
    }
  });

  it("every one of the 11 named pages has at least one registered widget", () => {
    const expectedDomains = ["home", "school", "work", "business", "deen", "fitness", "self_mastery", "habits", "goals", "insights", "weekly_review"];
    for (const domainKey of expectedDomains) {
      expect(widgetsForDomain(domainKey).length).toBeGreaterThan(0);
    }
  });
});

describe("widgetsForDomain", () => {
  it("returns an empty array for an unknown domain, never throws", () => {
    expect(widgetsForDomain("not_a_real_domain")).toEqual([]);
  });
});

describe("findWidget", () => {
  it("finds a real (domainKey, widgetKey) pair", () => {
    const found = findWidget("school", "task_list");
    expect(found?.label).toBe("Task list");
  });

  it("returns undefined for a widgetKey that exists under a DIFFERENT domain -- lookup is scoped, not global", () => {
    expect(findWidget("home", "task_list")).toBeUndefined();
  });

  it("returns undefined for an unknown widgetKey, never throws", () => {
    expect(findWidget("school", "not_a_real_widget")).toBeUndefined();
  });
});

describe("cross-domain widgets", () => {
  it("a Work key is valid on Business and a Business key is valid on Work, but neither leaks anywhere else", () => {
    expect(findWidget("business", "pipeline")?.fromDomain).toBe("work");
    expect(findWidget("work", "kill_list")?.fromDomain).toBe("business");
    expect(findWidget("school", "kill_list")).toBeUndefined();
    expect(findWidget("business", "kill_list")?.fromDomain).toBeUndefined(); // native there
  });
  it("every offered widget starts hidden; no native widget does", () => {
    for (const w of WIDGET_REGISTRY) expect(Boolean(w.defaultHidden)).toBe(Boolean(w.fromDomain));
  });
});
