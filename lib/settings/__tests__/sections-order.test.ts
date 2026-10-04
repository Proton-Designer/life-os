import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "../sections";

const page = readFileSync(join(__dirname, "../../../app/(app)/settings/page.tsx"), "utf8");
const panelIds = (chunk: string) => [...chunk.matchAll(/<Panel id="([\w-]+)"/g)].map((m) => m[1]);

// The page hands server panels to SettingsForm through two slots; SettingsForm itself renders
// profile | afterProfile | prayer | location/timezone | checkins | afterCheckins | security | data.
// Together they must read in the SAME order as the left tab list (SETTINGS_SECTIONS). Extra
// panels that have no tab (optional-features, weekly shape) may sit anywhere inside their group.
describe("Settings page order matches the left tab list", () => {
  const afterProfile = page.slice(page.indexOf("afterProfile:"), page.indexOf("afterCheckins:"));
  const afterCheckins = page.slice(page.indexOf("afterCheckins:"), page.indexOf("initial={{"));
  const composed = ["profile", ...panelIds(afterProfile), "prayer", "location", "timezone", "checkins", ...panelIds(afterCheckins), "security", "data"];
  const tabIds = SETTINGS_SECTIONS.map((s) => s.id) as string[];

  it("every tab appears, once, in tab order (ignoring panels that have no tab)", () => {
    const withoutExtras = composed.filter((id) => tabIds.includes(id));
    expect(withoutExtras).toEqual(tabIds);
  });

  it("the page's tab list is the shared SETTINGS_SECTIONS, not a private copy", () => {
    expect(page).toContain('SETTINGS_SECTIONS as SECTIONS } from "@/lib/settings/sections"');
    expect(page).not.toContain("const SECTIONS = [");
  });
});
