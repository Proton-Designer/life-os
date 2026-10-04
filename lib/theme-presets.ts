/**
 * Appearance presets (L10, rebuilt by THEME-01). Each preset is a COMPLETE colour
 * scheme -- background, surfaces, borders, text, glow, chrome accent and the
 * per-domain accents -- defined as one block in app/globals.css
 * (`:root[data-theme-preset="<id>"]`) and applied to <html> so the body, dialogs,
 * popovers and toasts (which render in portals outside the app shell) all follow.
 *
 * Still dark-first: no light/dark toggle (components/settings/settings-form.tsx has
 * documented that since v1). Semantic colours (destructive/noise, warning) stay
 * constant across presets on purpose -- "this is dangerous" must not look ordinary
 * because of a cosmetic choice.
 *
 * "Midnight" is today's look, verbatim, and the default. Its stored id stays
 * `oxblood`: profiles.theme_preset has a CHECK constraint on that literal
 * (migration 134), so the id is an internal key and `label` is what people see.
 * Adding a preset = one id here + one `:root[data-theme-preset]` block in
 * globals.css + one PRESET_PREVIEW entry (the registry test checks all three agree).
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
  oxblood: { label: "Midnight", description: "The original: near-black with an ember glow. Amber, violet, green, blue and magenta accents. Default." },
  ocean: { label: "Ocean", description: "Deep navy and teal surfaces with sea-green and sky-blue accents." },
  forest: { label: "Forest", description: "Dark pine surfaces with fern, olive and warm-gold accents." },
  sunset: { label: "Sunset", description: "Plum-dusk surfaces with orange, rose and orchid accents." },
  mono: { label: "Mono", description: "Neutral graphite with soft, desaturated tints." },
};

/**
 * Literal values per preset, mirroring app/globals.css exactly (a swatch must show a
 * preset that is NOT the one applied right now, so it can't read live CSS variables).
 * `bg` also drives <meta name="theme-color">. Kept in step with the CSS by
 * lib/__tests__/theme-presets.test.ts.
 */
export const PRESET_PREVIEW: Record<
  ThemePresetId,
  { bg: string; card: string; foreground: string; accents: { deen: string; fitness: string; business: string; school: string; coop: string; info: string } }
> = {
  oxblood: { bg: "#0a0a0c", card: "#131316", foreground: "#f2efec", accents: { deen: "#e0a030", fitness: "#9085e9", business: "#4caf7d", school: "#6aa9ff", coop: "#d55181", info: "#5b8fd9" } },
  ocean: { bg: "#06141b", card: "#0b1f2b", foreground: "#e8f3f6", accents: { deen: "#3ba7a0", fitness: "#5b8fd9", business: "#2ecc9c", school: "#4fc3d9", coop: "#7a8bea", info: "#38b6cc" } },
  forest: { bg: "#09130d", card: "#101d16", foreground: "#ecf2e6", accents: { deen: "#d4a04a", fitness: "#5fae7a", business: "#7fae4a", school: "#3f9e7a", coop: "#c27c5a", info: "#6fae5a" } },
  sunset: { bg: "#170b12", card: "#231220", foreground: "#f8ede6", accents: { deen: "#f0a050", fitness: "#e06590", business: "#f2c14e", school: "#c76bd9", coop: "#ef7d5c", info: "#e88a5c" } },
  mono: { bg: "#111111", card: "#1b1b1b", foreground: "#ededed", accents: { deen: "#c9c2b8", fitness: "#a8a4c9", business: "#a8c2ae", school: "#a8b8c9", coop: "#c9a8b8", info: "#b0b0b8" } },
};
