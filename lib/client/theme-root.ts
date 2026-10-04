import { PRESET_PREVIEW, resolveThemePreset, type ThemePresetId } from "@/lib/theme-presets";

/**
 * The theme preset lives on <html data-theme-preset> so the body, portals (dialogs,
 * popovers, toasts) and the PWA theme-color all follow it. This module is the one
 * client-side writer.
 *
 * `chosen` is what the user picked in THIS tab. While it is set it wins over the
 * server-rendered value, so a stale RSC payload (cached routes, a refresh that
 * started before the last click) can never flip the app back to an older preset.
 * A full reload clears it and the server value (the saved preference) is correct.
 */
let chosen: ThemePresetId | null = null;

function writeRoot(preset: ThemePresetId) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme-preset", preset);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", PRESET_PREVIEW[preset].bg);
}

/** The user picked (or reverted to) a preset: apply it now and remember it for this tab. */
export function applyThemePreset(preset: ThemePresetId): void {
  chosen = preset;
  writeRoot(preset);
}

/** The server-rendered preset arrived; ignored once the user has chosen one in this tab. */
export function syncServerThemePreset(serverValue: string | null | undefined): void {
  if (chosen) return;
  writeRoot(resolveThemePreset(serverValue));
}

export function resetThemeRootForTests(): void {
  chosen = null;
}
