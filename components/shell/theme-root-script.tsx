import { PRESET_PREVIEW, type ThemePresetId } from "@/lib/theme-presets";

/**
 * Sets <html data-theme-preset> and the theme-color meta while the HTML is still
 * being parsed, i.e. BEFORE first paint, so a non-default preference never flashes
 * Midnight. Server component: a script rendered by a client component would be
 * re-evaluated by React on the client. Values come from the closed preset registry,
 * never from user input.
 */
export function ThemeRootScript({ preset }: { preset: ThemePresetId }) {
  const js = `document.documentElement.setAttribute("data-theme-preset",${JSON.stringify(preset)});var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",${JSON.stringify(PRESET_PREVIEW[preset].bg)});`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
