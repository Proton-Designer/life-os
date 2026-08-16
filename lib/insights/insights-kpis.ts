import { createClient } from "@/lib/supabase/server";
import { addDaysToDateString } from "@/lib/date-utils";
import { SEGMENT_MAP } from "./focus-map";

export type InsightsKpisDataSource = {
  getAllCheckins: (
    userId: string,
    startIso: string,
    endIso: string
  ) => Promise<{ checkin_time: string; tag_type: string | null; answered: boolean }[]>;
};

export type InsightsKpisResult = {
  coveragePct: number;
  answeredCount: number;
  totalSlots: number;
  mostFocusedDomain: string | null;
  noiseSharePct: number;
  noiseShareDeltaPct: number;
};

function defaultDataSource(): InsightsKpisDataSource {
  return {
    async getAllCheckins(userId, startIso, endIso) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("checkins")
        .select("checkin_time, tag_type, answered")
        .eq("user_id", userId)
        .gte("checkin_time", startIso)
        .lt("checkin_time", endIso);
      return data ?? [];
    },
  };
}

function noiseSharePct(rows: { tag_type: string | null; answered: boolean }[]): number {
  const answered = rows.filter((r) => r.answered && r.tag_type);
  if (answered.length === 0) return 0;
  return (answered.filter((r) => r.tag_type === "noise").length / answered.length) * 100;
}

/**
 * The Insights KPI row is pinned to a fixed this-week/last-week window,
 * independent of the Focus Map/donut's own Day/Week toggle below it — one
 * stable "how's my week going" summary, not three cards that silently
 * change meaning every time the chart toggle is flipped. Single bulk
 * 2-week range query, bucketed in memory, per the data-layer convention.
 */
export async function getInsightsKpis(
  userId: string,
  weekStart: string,
  previousWeekStart: string,
  dataSource: InsightsKpisDataSource = defaultDataSource()
): Promise<InsightsKpisResult> {
  const weekEndIso = `${addDaysToDateString(weekStart, 7)}T00:00:00.000Z`;
  const weekStartIso = `${weekStart}T00:00:00.000Z`;
  const previousWeekStartIso = `${previousWeekStart}T00:00:00.000Z`;

  const rows = await dataSource.getAllCheckins(userId, previousWeekStartIso, weekEndIso);
  const thisWeek = rows.filter((r) => r.checkin_time >= weekStartIso && r.checkin_time < weekEndIso);
  const lastWeek = rows.filter((r) => r.checkin_time >= previousWeekStartIso && r.checkin_time < weekStartIso);

  const thisWeekAnswered = thisWeek.filter((r) => r.answered);
  const coveragePct = thisWeek.length === 0 ? 0 : (thisWeekAnswered.length / thisWeek.length) * 100;

  const domainCounts = new Map<string, number>();
  for (const r of thisWeekAnswered) {
    if (!r.tag_type) continue;
    const domain = SEGMENT_MAP[r.tag_type] ?? r.tag_type;
    if (domain === "noise" || domain === "other_work") continue;
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  let mostFocusedDomain: string | null = null;
  let maxCount = 0;
  for (const [domain, count] of domainCounts) {
    if (count > maxCount) {
      maxCount = count;
      mostFocusedDomain = domain;
    }
  }

  const thisWeekNoisePct = noiseSharePct(thisWeek);
  const lastWeekNoisePct = noiseSharePct(lastWeek);

  return {
    coveragePct,
    answeredCount: thisWeekAnswered.length,
    totalSlots: thisWeek.length,
    mostFocusedDomain,
    noiseSharePct: thisWeekNoisePct,
    noiseShareDeltaPct: thisWeekNoisePct - lastWeekNoisePct,
  };
}
