import type { Domain } from "@/lib/home/types";

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

// Which accent token a domain renders with — co_op has no color of its own,
// so it shares School's (same fold-in convention as get-domain-pulse.ts's
// pulse fraction and priority-list.tsx's DOMAIN_ACCENT_CLASS).
export const DOMAIN_ACCENT: Record<Domain, AccentToken> = {
  deen: "deen",
  business: "business",
  fitness: "fitness",
  school: "school",
  co_op: "school",
};
