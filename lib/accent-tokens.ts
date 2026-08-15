// Single source of truth mapping an accent name to its CSS custom property.
// Domain accents plus the two chrome accents (info = general-purpose signal
// blue, noise = destructive/red) used by IconChip, StatCard, and nav pills.
export type AccentToken = "deen" | "business" | "fitness" | "school" | "info" | "noise";

export const ACCENT_VAR: Record<AccentToken, string> = {
  deen: "--accent-deen",
  business: "--accent-business",
  fitness: "--accent-fitness",
  school: "--accent-school",
  info: "--accent-info",
  noise: "--accent-noise",
};
