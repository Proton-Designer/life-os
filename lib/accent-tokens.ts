import type { Domain } from "@/lib/home/types";

// Single source of truth mapping an accent name to its CSS custom property.
// Domain accents plus the two chrome accents (info = general-purpose signal
// blue, noise = destructive/red) used by IconChip, StatCard, and nav pills.
export type AccentToken = "deen" | "business" | "fitness" | "school" | "coop" | "info" | "noise" | "neutral" | "warning";

export const ACCENT_VAR: Record<AccentToken, string> = {
  deen: "--accent-deen",
  business: "--accent-business",
  fitness: "--accent-fitness",
  school: "--accent-school",
  coop: "--accent-coop",
  info: "--accent-info",
  noise: "--accent-noise",
  neutral: "--muted-foreground",
  // Semantic role, aliased to --accent-deen's hex (Phase H) — for callers
  // that mean "the app's warning color," not "the Deen domain." See
  // globals.css's --accent-warning definition for the full reasoning.
  warning: "--accent-warning",
};

// Which accent token a domain renders with. Work used to fold onto School's
// accent (a real bug — the two are indistinguishable the moment they appear
// together, e.g. in the Focus Map) until the 2026-08-15 structural refactor
// gave it its own --accent-coop.
export const DOMAIN_ACCENT: Record<Domain, AccentToken> = {
  deen: "deen",
  business: "business",
  fitness: "fitness",
  school: "school",
  co_op: "coop",
};
