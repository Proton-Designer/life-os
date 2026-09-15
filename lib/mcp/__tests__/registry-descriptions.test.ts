import { describe, expect, it } from "vitest";
import { REGISTRY } from "../registry";

/**
 * P4-04 — every description in the read registry is shipped into a model's
 * context on list_capabilities. So it must be short and about the USER'S
 * data, not this codebase's history. Build history belongs in code comments
 * beside the entry. Red first: failed on HEAD (lengths, jargon, user_id).
 */

const MAX_DESCRIPTION_CHARS = 300;

/** Internal vocabulary a model can't use: migration numbers, rulings, plan labels, memo sections, file paths. */
const JARGON = /\bmigrations?\b|\bruling\b|\b[RL]\d+[a-z]?\b|memo\s*§|§\s*\d|\.tsx?\b|\.md\b|\.sql\b|\bdocs\/|\blib\/|\bapp\/|PROGRAM-PLAN|TOOL-ARCHITECTURE|\bT-\d{4}\b/i;

const descriptions: { where: string; text: string }[] = Object.values(REGISTRY).flatMap((d) => [
  { where: `domain ${d.domain}`, text: d.description },
  ...Object.values(d.entities).map((e) => ({ where: `${d.domain}.${e.entity}`, text: e.description })),
]);

describe("registry descriptions are model-facing", () => {
  it("the jargon pattern catches what it is meant to catch (positive control)", () => {
    for (const bad of ["see migration 149", "per ruling R5", "L11/R7 Tier 1", "memo §3", "lib/widgets/render.ts", "docs/ai-connector/X.md", "app/(app)/close/plan-actions.ts"]) {
      expect(JARGON.test(bad), bad).toBe(true);
    }
    for (const fine of ["Prayer log per day", "One workout session and its sets", "Rate 1-4 (again/hard/good/easy)"]) {
      expect(JARGON.test(fine), fine).toBe(false);
    }
  });

  it(`every domain and entity description is ≤${MAX_DESCRIPTION_CHARS} chars`, () => {
    const tooLong = descriptions.filter((d) => d.text.length > MAX_DESCRIPTION_CHARS).map((d) => `${d.where} (${d.text.length})`);
    expect(tooLong).toEqual([]);
  });

  it("no description carries migration/ruling/plan/file-path jargon", () => {
    const withJargon = descriptions.filter((d) => JARGON.test(d.text)).map((d) => `${d.where}: "${d.text.match(JARGON)?.[0]}"`);
    expect(withJargon).toEqual([]);
  });

  it("no entity advertises user_id -- every read is already the caller's own rows", () => {
    const leaking = Object.values(REGISTRY).flatMap((d) => Object.values(d.entities).filter((e) => e.fullColumns.includes("user_id") || e.summaryColumns.includes("user_id")).map((e) => `${d.domain}.${e.entity}`));
    expect(leaking).toEqual([]);
  });

  it("rangeFilterableColumns only name selectable columns", () => {
    const bad = Object.values(REGISTRY).flatMap((d) =>
      Object.values(d.entities).flatMap((e) => (e.rangeFilterableColumns ?? []).filter((c) => !e.fullColumns.includes(c)).map((c) => `${d.domain}.${e.entity}.${c}`)),
    );
    expect(bad).toEqual([]);
  });

  it("entities whose primary sort is a day or timestamp column can be range-filtered on it", () => {
    const missing = Object.values(REGISTRY).flatMap((d) =>
      Object.values(d.entities)
        .filter((e) => {
          const primary = e.orderBy[0]?.column ?? "";
          return /(^date$|_date$|_at$|_time$)/.test(primary) && e.fullColumns.includes(primary);
        })
        .filter((e) => !(e.rangeFilterableColumns ?? []).includes(e.orderBy[0].column))
        .map((e) => `${d.domain}.${e.entity}.${e.orderBy[0].column}`),
    );
    expect(missing).toEqual([]);
  });
});
