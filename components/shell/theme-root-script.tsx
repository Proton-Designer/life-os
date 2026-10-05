"use client";

import { PRESET_PREVIEW, type ThemePresetId } from "@/lib/theme-presets";

/**
 * Sets <html data-theme-preset> and the theme-color meta while the HTML is still being parsed, i.e. BEFORE first paint,
 * so a non-default preference never flashes Midnight. Values come from the closed preset registry, never user input.
 *
 * React 19 logs "Encountered a script tag while rendering React component" whenever the CLIENT renders an executable
 * <script> (scripts in a component tree never run on the client). So: on the server pass (typeof window === "undefined",
 * which is the HTML the browser parses) the script is a normal executable one; on the client it renders as an inert
 * `application/json` data block (React does not warn for those and the browser never runs it again). The attribute
 * differs between the two passes on purpose, hence suppressHydrationWarning. After first paint ThemeRootSync owns the
 * attribute (applyThemePreset), so nothing is lost by the client copy being inert.
 */
export function ThemeRootScript({ preset }: { preset: ThemePresetId }) {
  const js = `document.documentElement.setAttribute("data-theme-preset",${JSON.stringify(preset)});var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",${JSON.stringify(PRESET_PREVIEW[preset].bg)});`;
  return <script type={typeof window === "undefined" ? undefined : "application/json"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: js }} />;
}
