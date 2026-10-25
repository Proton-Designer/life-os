import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The generator must never overwrite or delete an agent-written narrative that lands between its claim and its fill.
describe("weekly narrative generator vs an agent-written one", () => {
  const src = readFileSync("lib/weekly-review/weekly-narrative.ts", "utf8");
  it("fills only a still-empty claim", () => {
    const fill = src.slice(src.indexOf("async function fillNarrativeSlot"), src.indexOf("export interface DispatchWeeklyNarrativesResult"));
    expect(fill).toContain('.is("narrative_text", null)');
  });
  it("releases only a still-empty claim", () => {
    const release = src.slice(src.indexOf("async function releaseNarrativeSlot"), src.indexOf("async function fillNarrativeSlot"));
    expect(release).toContain('.is("narrative_text", null)');
  });
});
