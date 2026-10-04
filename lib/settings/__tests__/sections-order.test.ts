import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "../sections";

const page = readFileSync(join(__dirname, "../../../app/(app)/settings/page.tsx"), "utf8");
const streamed = readFileSync(join(__dirname, "../../../components/settings/streamed-panels.tsx"), "utf8");
// NAV-01b: the integration panels moved into <StreamedIntegrationPanels />, whose Suspense fallbacks
// declare the section ids in render order. Expand the marker so the order check still sees them.
const streamedIds = [...streamed.slice(streamed.indexOf("export function StreamedIntegrationPanels")).matchAll(/<PanelFallback id="([\w-]+)"/g)].map((m) => m[1]);
const panelIds = (chunk: string): string[] =>
  [...chunk.matchAll(/<Panel id="([\w-]+)"|<StreamedIntegrationPanels \/>/g)].flatMap((m) => (m[1] ? [m[1]] : streamedIds));

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

  it("the streamed integration panels are expanded in the check (positive control: they are real section ids)", () => {
    expect(streamedIds).toEqual(["ai", "canvas", "rescuetime", "whoop", "connectors", "webhooks"]);
    expect(page).toContain("<StreamedIntegrationPanels />");
  });

  it("the page's tab list is the shared SETTINGS_SECTIONS, not a private copy", () => {
    expect(page).toContain('SETTINGS_SECTIONS as SECTIONS } from "@/lib/settings/sections"');
    expect(page).not.toContain("const SECTIONS = [");
  });
});
