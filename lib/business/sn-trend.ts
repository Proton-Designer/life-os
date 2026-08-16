import { computeRatioDisplay } from "@/lib/insights/ratio-display";

export type SnCheckin = { checkin_time: string; tag_type: string | null; answered: boolean };
export type WeekBoundary = { weekStartIso: string; weekEndIso: string; label: string };
export type WeekSignalNoise = { label: string; signal: number; noise: number; display: string };

/**
 * Buckets a single bulk range of checkins into per-week signal/noise, per
 * the spec's data-layer note: "must not be built by looping [the per-week
 * helper] — that is N round-trips per chart." Same signal/noise rule as
 * getWeeklySignalNoiseRatio (answered kill_list/noise only), reusing
 * computeRatioDisplay so the "No data"/"All Signal" handling isn't
 * duplicated a third time.
 */
export function bucketSignalNoiseByWeek(checkins: SnCheckin[], weeks: WeekBoundary[]): WeekSignalNoise[] {
  return weeks.map((week) => {
    const inWeek = checkins.filter(
      (c) => c.checkin_time >= week.weekStartIso && c.checkin_time < week.weekEndIso
    );
    const answered = inWeek.filter((c) => c.answered);
    const signal = answered.filter((c) => c.tag_type === "kill_list").length;
    const noise = answered.filter((c) => c.tag_type === "noise").length;
    return { label: week.label, signal, noise, display: computeRatioDisplay(signal, noise, answered.length > 0) };
  });
}
