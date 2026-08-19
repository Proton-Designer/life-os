import { createClient } from "@/lib/supabase/server";

export type FocusMapDataSource = {
  getAllocations: (
    userId: string,
    startIso: string,
    endIso: string
  ) => Promise<{ domain: string; minutes: number }[]>;
};

export type FocusMapSegment = { domain: string; minutes: number; pct: number };

export type FocusMapResult = {
  segments: FocusMapSegment[];
};

function defaultDataSource(): FocusMapDataSource {
  return {
    async getAllocations(userId, startIso, endIso) {
      const supabase = await createClient();
      // kind = 'allocation' — same exclusion as sn-ratio.ts: legacy
      // point-sample checkins predate checkin_allocations and have no
      // minutes rows to join against regardless.
      const { data } = await supabase
        .from("checkins")
        .select("checkin_allocations(domain, minutes)")
        .eq("user_id", userId)
        .eq("kind", "allocation")
        .gte("window_start", startIso)
        .lt("window_start", endIso);
      return (data ?? []).flatMap((c) => c.checkin_allocations ?? []);
    },
  };
}

/**
 * Day/week segmented breakdown of time by domain, in real minutes — the
 * same `checkin_allocations` source the Signal:Noise donut and 6-week bars
 * already share (lib/business/sn-ratio.ts). Converted off the old
 * tag_type/point-sample model on 2026-08-19: that model was reading 23 rows
 * that are all unanswered and will never grow again, since the allocation
 * check-in system doesn't write to it. A segment's `minutes` is a real
 * duration, not a sample tally — Insights' page formats it as "3h 15m"
 * rather than treating it as a bare count.
 *
 * `wasted` is included as its own segment, not dropped or folded in
 * elsewhere: it's genuinely where the time went, and omitting it would
 * make the segments sum to less than the window while implying they're a
 * complete picture. Same neutral treatment as the donut — never colored
 * to read as an accusation.
 */
export async function getFocusMap(
  userId: string,
  range: "day" | "week",
  anchor: Date,
  dataSource: FocusMapDataSource = defaultDataSource()
): Promise<FocusMapResult> {
  const rangeMs = (range === "week" ? 7 : 1) * 24 * 60 * 60 * 1000;
  const end = new Date(anchor.getTime() + rangeMs);
  const rows = await dataSource.getAllocations(userId, anchor.toISOString(), end.toISOString());

  const minutesByDomain = new Map<string, number>();
  for (const row of rows) {
    minutesByDomain.set(row.domain, (minutesByDomain.get(row.domain) ?? 0) + row.minutes);
  }

  const total = [...minutesByDomain.values()].reduce((a, b) => a + b, 0);
  const segments = [...minutesByDomain.entries()]
    .filter(([, minutes]) => minutes > 0)
    .map(([domain, minutes]) => ({
      domain,
      minutes,
      pct: total === 0 ? 0 : (minutes / total) * 100,
    }));

  return { segments };
}
