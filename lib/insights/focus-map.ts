import { createClient } from "@/lib/supabase/server";

export type FocusMapDataSource = {
  getCheckins: (
    userId: string,
    startIso: string,
    endIso: string
  ) => Promise<{ tag_type: string | null; answered: boolean }[]>;
};

export type FocusMapResult = {
  segments: { domain: string; count: number; pct: number }[];
};

export const SEGMENT_MAP: Record<string, string> = {
  kill_list: "business",
  workout: "fitness",
  deen: "deen",
  school: "school_co_op",
  co_op: "school_co_op",
  noise: "noise",
  other_work: "other_work",
};

function defaultDataSource(): FocusMapDataSource {
  return {
    async getCheckins(userId, startIso, endIso) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("checkins")
        .select("tag_type, answered")
        .eq("user_id", userId)
        .gte("checkin_time", startIso)
        .lt("checkin_time", endIso);
      return data ?? [];
    },
  };
}

/**
 * Day/week segmented breakdown of time by domain, per spec's Focus Map —
 * still point-sample/tag_type-based, distinct from the allocation-minutes
 * Signal:Noise system (lib/business/sn-ratio.ts's getSignalNoiseForRange).
 * Missed (unanswered) check-ins are excluded entirely. 'other_work' gets
 * its own segment (real time spent, per spec's "neutral" framing).
 *
 * Deliberately segments-only (2026-08-19): this used to also compute a
 * global Signal:Noise ratio for Insights' donut, but that's a different
 * data model now — allocation minutes, not tag_type counts — so it moved
 * to its own function rather than this one serving two masters. Only
 * touch this function for Focus Map / RankedBars / Per-domain concerns.
 */
export async function getFocusMap(
  userId: string,
  range: "day" | "week",
  anchor: Date,
  dataSource: FocusMapDataSource = defaultDataSource()
): Promise<FocusMapResult> {
  const rangeMs = (range === "week" ? 7 : 1) * 24 * 60 * 60 * 1000;
  const end = new Date(anchor.getTime() + rangeMs);
  const checkins = await dataSource.getCheckins(userId, anchor.toISOString(), end.toISOString());

  const answered = checkins.filter((c) => c.answered && c.tag_type);
  const total = answered.length;

  const counts = new Map<string, number>();
  for (const c of answered) {
    const segment = SEGMENT_MAP[c.tag_type!] ?? c.tag_type!;
    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }

  const segments = [...counts.entries()].map(([domain, count]) => ({
    domain,
    count,
    pct: total === 0 ? 0 : (count / total) * 100,
  }));

  return { segments };
}
