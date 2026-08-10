import { createClient } from "@/lib/supabase/server";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";

export type SnDataSource = {
  getCheckins: (
    userId: string,
    weekStartIso: string,
    weekEndIso: string
  ) => Promise<{ tag_type: string | null; answered: boolean }[]>;
};

export type SignalNoiseResult = {
  signal: number;
  noise: number;
  display: string;
};

function defaultDataSource(): SnDataSource {
  return {
    async getCheckins(userId, weekStartIso, weekEndIso) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("checkins")
        .select("tag_type, answered")
        .eq("user_id", userId)
        .gte("checkin_time", weekStartIso)
        .lt("checkin_time", weekEndIso);
      return data ?? [];
    },
  };
}

/**
 * Weekly Business Signal:Noise ratio. `signal` = answered kill_list check-ins,
 * `noise` = answered noise check-ins. Missed (unanswered) check-ins and
 * 'other_work' are excluded from both counts, per spec. Also usable scoped
 * to any tag_type pair — Insights (Task 12.1) reuses this rather than
 * reimplementing the zero-noise / zero-data display-string handling.
 */
export async function getWeeklySignalNoiseRatio(
  userId: string,
  weekStart: Date,
  dataSource: SnDataSource = defaultDataSource()
): Promise<SignalNoiseResult> {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const checkins = await dataSource.getCheckins(
    userId,
    weekStart.toISOString(),
    weekEnd.toISOString()
  );

  const answered = checkins.filter((c) => c.answered);
  const signal = answered.filter((c) => c.tag_type === "kill_list").length;
  const noise = answered.filter((c) => c.tag_type === "noise").length;
  const display = computeRatioDisplay(signal, noise, answered.length > 0);

  return { signal, noise, display };
}
