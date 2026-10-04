/**
 * Deen Mode OFF hides goals tagged "deen" everywhere goals are listed (the
 * /goals board, Night Plan milestone seeds) -- including the user's own goal
 * text, since "strip everything religious" was the instruction. A
 * render/behaviour filter only: the goal and milestone rows are never touched
 * (R4) and reappear when Deen Mode is turned back on.
 */
export function withoutDeenGoals<T extends { domain: string | null }>(goals: T[], deenMode: boolean): T[] {
  return deenMode ? goals : goals.filter((g) => g.domain !== "deen");
}
