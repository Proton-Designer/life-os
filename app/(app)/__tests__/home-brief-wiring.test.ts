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
    expect(page).toContain("<MorningBriefPanel text={morningBrief.text} sourceLabel={briefSourceLabel(morningBrief.provider, morningBrief.model)} />");
  });
  it("positive control: a header with the toggle AFTER the edit button would fail the order check", () => {
    const wrong = "<WidgetManagerButton /><MorningBriefToggle />";
    expect(wrong.indexOf("<MorningBriefToggle")).toBeGreaterThan(wrong.indexOf("<WidgetManagerButton"));
  });

  // eng1 review L2/L3: a settings read must not take down the 'Your day' card or the brief.
  it("the focus target falls back to the default, the brief flag to expanded, and the derived Promise.all is guarded", () => {
    expect(page).toMatch(/loadFocusTargetMinutes\(supabase, userId, dateStr\)\.catch\(\(\) => DEFAULT_FOCUS_TARGET_MINUTES\)/);
    expect(page).toMatch(/isMorningBriefCollapsed\(supabase, userId, dateStr\)\.catch\(\(\) => false\)/);
    expect(page).toContain("const dayCardPromise = Promise.all([rhythmPromise, focusTargetPromise])");
    expect(page).toMatch(/for \(const p of \[[^\]]*dayCardPromise/); // included in the .catch guard list
    expect(page).toContain("<Stream promise={dayCardPromise}");
  });
  it("positive control: an unguarded read would not match the guarded pattern", () => {
    expect("loadFocusTargetMinutes(supabase, userId, dateStr);").not.toMatch(/\.catch\(\(\) => DEFAULT_FOCUS_TARGET_MINUTES\)/);
  });
});
