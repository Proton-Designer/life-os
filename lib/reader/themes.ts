import type { ReaderTheme } from "./types";

// Reader themes as CSS custom properties scoped to the reader root (the app theme is dark-only, so light/sepia
// cannot come from it). Contrast of fg/muted/focal against bg is pinned in __tests__/themes.test.ts.
export const READER_THEMES: ReaderTheme[] = ["dark", "light", "sepia", "contrast"];

export const READER_THEME_LABEL: Record<ReaderTheme, string> = {
  dark: "Dark",
  light: "Light",
  sepia: "Sepia",
  contrast: "High contrast",
};

export interface ReaderPalette {
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  border: string;
  focal: string;
  hlBg: string;
  hlFg: string;
}

export const READER_PALETTES: Record<ReaderTheme, ReaderPalette> = {
  dark: { bg: "#0a0a0c", surface: "#131316", fg: "#f2efec", muted: "#9a9aa2", border: "#2a2a30", focal: "#e85050", hlBg: "#35353d", hlFg: "#f2efec" },
  light: { bg: "#fafaf7", surface: "#ffffff", fg: "#1a1a1c", muted: "#5f5f66", border: "#d9d9d2", focal: "#c62828", hlBg: "#fde68a", hlFg: "#1a1a1c" },
  sepia: { bg: "#f4ecd8", surface: "#ebe0c5", fg: "#433422", muted: "#6e5b44", border: "#d6c7a1", focal: "#b3261e", hlBg: "#e6d3a3", hlFg: "#433422" },
  contrast: { bg: "#000000", surface: "#0d0d0d", fg: "#ffffff", muted: "#d0d0d0", border: "#ffffff", focal: "#ff6b6b", hlBg: "#ffd400", hlFg: "#000000" },
};

export function readerThemeVars(theme: ReaderTheme): Record<string, string> {
  const p = READER_PALETTES[theme];
  return {
    "--reader-bg": p.bg,
    "--reader-surface": p.surface,
    "--reader-fg": p.fg,
    "--reader-muted": p.muted,
    "--reader-border": p.border,
    "--reader-focal": p.focal,
    "--reader-hl-bg": p.hlBg,
    "--reader-hl-fg": p.hlFg,
  };
}
