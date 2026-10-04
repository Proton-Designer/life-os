import type { DistractionDomain } from "./types";

/**
 * Deen Mode OFF hides the "deen" distraction domain everywhere it is listed
 * (capture chips, domain step, review groups, Home's action-plan list). A
 * render/behaviour filter only -- the trigger and event rows stay in the
 * database untouched (R4) and reappear when Deen Mode is turned back on.
 */
export function withoutDeenDomain<T extends { domain: DistractionDomain }>(items: T[], deenMode: boolean): T[] {
  return deenMode ? items : items.filter((i) => i.domain !== "deen");
}
