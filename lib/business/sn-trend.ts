import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { bucketAllocationMinutes, type AllocationRow } from "./sn-ratio";

export type SnAllocationRow = AllocationRow & { windowStartIso: string };
export type WeekBoundary = { weekStartIso: string; weekEndIso: string; label: string };
export type WeekSignalNoise = {
  label: string;
  signalMinutes: number;
  noiseMinutes: number;
  otherCommitmentsMinutes: number;
  wastedMinutes: number;
  display: string;
};

/**
 * Buckets a single bulk range of allocation rows into per-week signal/noise
 * (minutes), per the spec's data-layer note: "must not be built by looping
 * [the per-week helper] — that is N round-trips per chart." Same
 * signal/noise rule as getWeeklySignalNoiseRatio, reusing
 * bucketAllocationMinutes/computeRatioDisplay so the domain split and the
 * "No data"/"All Signal" display handling aren't duplicated a third time.
 *
 * `weeks` boundaries must already be resolved to local midnight (see
 * getWeeklySignalNoiseRatio's own note) — this function's filtering is a
 * plain ISO-string range comparison, timezone-agnostic by construction.
 */
export function bucketSignalNoiseByWeek(rows: SnAllocationRow[], weeks: WeekBoundary[]): WeekSignalNoise[] {
  return weeks.map((week) => {
    const inWeek = rows.filter((r) => r.windowStartIso >= week.weekStartIso && r.windowStartIso < week.weekEndIso);
    const { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes } = bucketAllocationMinutes(inWeek);
    return {
      label: week.label,
      signalMinutes,
      noiseMinutes,
      otherCommitmentsMinutes,
      wastedMinutes,
      display: computeRatioDisplay(signalMinutes, noiseMinutes, signalMinutes + noiseMinutes > 0),
    };
  });
}
