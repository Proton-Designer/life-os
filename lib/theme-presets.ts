/**
 * L10 (docs/ai-connector/PROGRAM-PLAN.md): ~5 accent-color presets, applied
 * via a `data-theme-preset` attribute the authenticated shell sets on a
 * `display:contents` wrapper (components/shell/app-shell-chrome.tsx) —
 * `app/globals.css` defines the override blocks this id selects between.
 *
 * DELIBERATELY NOT A LIGHT/DARK TOGGLE. components/settings/settings-form.tsx
 * has documented since v1 that this app is "dark-first... the only theme for
 * v1" — that decision stands. Presets vary only the per-domain ACCENT hues
 * (`--accent-deen`, `--accent-fitness`, `--accent-business`, `--accent-school`,
 * `--accent-coop`, `--accent-info`) against the same dark background/
 * foreground/card palette every preset shares. "warning"/"noise" (destructive)
 * stay constant across every preset on purpose — those are semantic system
 * colors (error, caution), not brand identity, and letting them drift per
 * cosmetic preset risks a preset making "this is dangerous" look ordinary.
 *
 * "oxblood" is the CURRENT palette's values, verbatim, and MUST stay the
 * default — an account that never touches this setting (everyone, until
 * this ships a UI for it) must see zero visual change.
 */

export const THEME_PRESET_IDS = ["oxblood", "ocean", "forest", "sunset", "mono"] as const;
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

export const DEFAULT_THEME_PRESET: ThemePresetId = "oxblood";

export function isThemePresetId(value: string): value is ThemePresetId {
  return (THEME_PRESET_IDS as readonly string[]).includes(value);
}

/** Falls back to the default for anything not a recognized preset id (a stale DB value, a bad upstream write) — never renders with an unknown/undefined preset. */
export function resolveThemePreset(value: string | null | undefined): ThemePresetId {
  if (value && isThemePresetId(value)) return value;
  return DEFAULT_THEME_PRESET;
}

export const THEME_PRESETS: Record<ThemePresetId, { label: string; description: string }> = {
  oxblood: { label: "Oxblood", description: "The original — amber, violet, green, blue, and magenta on the ember glow. Default." },
  ocean: { label: "Ocean", description: "Cool teal, sky blue, sea green, cyan, and indigo." },
  forest: { label: "Forest", description: "Warm gold, fern green, olive, pine, and clay." },
  sunset: { label: "Sunset", description: "Orange, rose, warm gold, and orchid." },
  mono: { label: "Mono", description: "Desaturated and minimal — soft tints instead of saturated color." },
};
