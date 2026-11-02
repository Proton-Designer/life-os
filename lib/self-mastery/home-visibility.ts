// One decision for "does Self-Mastery appear on Home". Pure and client-safe so Home and its tests share it. The preference
// (user_settings.self_mastery_on_home, default ON) is the master switch: OFF beats everything, including a legacy account (which has
// every module) and a School-only account whose due questions would otherwise raise the study-session card.

export interface SelfMasteryHome {
  /** false = Home does no Self-Mastery work at all (no due summary, no in-progress books, no arbiter candidate) and renders none of it. */
  show: boolean;
  /** The Learning area is selected (drives the session card and the arbiter exactly as before). */
  hasSelfMastery: boolean;
  /** "Continue reading": the Learning area, or a legacy account. */
  continueReading: boolean;
}

export function resolveSelfMasteryHome(input: { onHome: boolean; hasLearningArea: boolean; legacy: boolean }): SelfMasteryHome {
  if (!input.onHome) return { show: false, hasSelfMastery: false, continueReading: false };
  return { show: true, hasSelfMastery: input.hasLearningArea, continueReading: input.hasLearningArea || input.legacy };
}
