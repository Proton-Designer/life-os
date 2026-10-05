import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// HOME-01b: the morning brief's collapsed state is read per brief_date and shared between the panel and the
// Home header. A page render needs ~25 mocks, so the wiring is pinned in the source (controls below).
const page = readFileSync(join(__dirname, "../page.tsx"), "utf8");

describe("Home morning-brief wiring", () => {
  it("reads the collapsed flag for TODAY's brief date, only when a brief exists", () => {
    expect(page).toContain("isMorningBriefCollapsed(supabase, userId, dateStr)");
    expect(page).toMatch(/brief \? await isMorningBriefCollapsed/);
  });
  it("the provider wraps the header + panel, and the toggle sits immediately LEFT of the edit button", () => {
    expect(page).toContain("<MorningBriefProvider briefDate={dateStr}");
    const start = page.indexOf("actions={");
    const actions = page.slice(start, page.indexOf("</>", start));
    expect(actions.indexOf("<MorningBriefToggle")).toBeGreaterThan(-1);
    expect(actions.indexOf("<MorningBriefToggle")).toBeLessThan(actions.indexOf("<WidgetManagerButton"));
    expect(page).toContain("<MorningBriefPanel text={morningBrief} />");
  });
  it("positive control: a header with the toggle AFTER the edit button would fail the order check", () => {
    const wrong = "<WidgetManagerButton /><MorningBriefToggle />";
    expect(wrong.indexOf("<MorningBriefToggle")).toBeGreaterThan(wrong.indexOf("<WidgetManagerButton"));
  });
});
