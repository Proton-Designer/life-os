/**
 * Which `weekly_goals.domain` values ("deen" | "business") are queried and shown. Both, for everyone.
 *
 * The "deen" slot is titled "Personal" in the UI and is open to every account: it holds whatever personal goal a
 * person sets for the week, so it must not depend on Faith being selected or Faith Mode being on. (It used to be
 * gated on both, which hid it and refused its saves for anyone without Faith.) The stored value stays "deen" - a
 * rename in the database would orphan every existing row for no gain.
 *
 * "business" is likewise unconditional (see showBusinessWeeklyGoal for the one place it can still be hidden).
 */
export function weeklyGoalDomains(): ("deen" | "business")[] {
  return ["deen", "business"];
}
