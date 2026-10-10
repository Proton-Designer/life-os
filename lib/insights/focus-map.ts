import { createClient } from "@/lib/supabase/server";
import { deriveSessionMinutesByDomain, type SessionRange } from "@/lib/checkins/session-accounting";
import { getStoredAllocationSpans, getSessionRanges } from "@/lib/checkins/session-accounting-queries";

export type FocusMapDataSource = {
  getAllocations: (
    userId: string,
    startIso: string,
    endIso: string
  ) => Promise<{ domain: string | null; minutes: number; isWasted: boolean }[]>;
  /** Same session auto-accounting sn-ratio.ts uses -- see its doc comment for the range bound and the double-count guard. */
  getStoredAllocationSpans: (userId: string, startIso: string, endIso: string) => Promise<{ start: Date; end: Date }[]>;
  getSessionRanges: (userId: string, startIso: string, endIso: string) => Promise<SessionRange[]>;
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
        .select("checkin_allocations(domain, minutes, is_wasted)")
        .eq("user_id", userId)
        .eq("kind", "allocation")
        .gte("window_start", startIso)
        .lt("window_start", endIso);
      return (data ?? []).flatMap((c) =>
        (c.checkin_allocations ?? []).map((row) => ({ domain: row.domain, minutes: row.minutes, isWasted: row.is_wasted }))
      );
    },
    getStoredAllocationSpans,
    getSessionRanges,
  };
}

/** Session minutes (Deep Work -> Business, Deep Study -> School) no answered window already holds -- the same derivation as sn-ratio.ts's getSessionAccountedRows. */
async function getSessionAccountedRows(
  userId: string,
  startIso: string,
  endIso: string,
  now: Date,
  dataSource: FocusMapDataSource
): Promise<{ domain: string; minutes: number }[]> {
  const [storedSpans, sessions] = await Promise.all([
    dataSource.getStoredAllocationSpans(userId, startIso, endIso),
    dataSource.getSessionRanges(userId, startIso, endIso),
  ]);
  return deriveSessionMinutesByDomain(sessions, storedSpans, new Date(startIso), new Date(endIso), now);
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
  dataSource: FocusMapDataSource = defaultDataSource(),
  now: Date = new Date()
): Promise<FocusMapResult> {
  const rangeMs = (range === "week" ? 7 : 1) * 24 * 60 * 60 * 1000;
  const end = new Date(anchor.getTime() + rangeMs);
  const startIso = anchor.toISOString();
  const endIso = end.toISOString();
  const [rows, sessionRows] = await Promise.all([
    dataSource.getAllocations(userId, startIso, endIso),
    getSessionAccountedRows(userId, startIso, endIso, now, dataSource),
  ]);

  // Real domains and wasted time are aggregated in structurally separate
  // buckets, never sharing one string-keyed Map — ruling (a)'s whole point.
  // A user-created domain that happened to be named "wasted" (isWasted:
  // false) would otherwise merge into the same Map key as genuine
  // unaccounted time (isWasted: true) the moment the domain set widens
  // past the closed legacy 5; keeping them apart until the final display
  // list is built means that collision is structurally impossible, not
  // just unlikely.
  const minutesByDomain = new Map<string, number>();
  let wastedTotal = 0;
  for (const row of rows) {
    if (row.isWasted) {
      wastedTotal += row.minutes;
    } else if (row.domain !== null) {
      minutesByDomain.set(row.domain, (minutesByDomain.get(row.domain) ?? 0) + row.minutes);
    }
  }

  for (const row of sessionRows) minutesByDomain.set(row.domain, (minutesByDomain.get(row.domain) ?? 0) + row.minutes);

  const total = [...minutesByDomain.values()].reduce((a, b) => a + b, 0) + wastedTotal;
  const segments = [...minutesByDomain.entries()]
    .filter(([, minutes]) => minutes > 0)
    .map(([domain, minutes]) => ({
      domain,
      minutes,
      pct: total === 0 ? 0 : (minutes / total) * 100,
    }));
  if (wastedTotal > 0) {
    segments.push({ domain: "wasted", minutes: wastedTotal, pct: total === 0 ? 0 : (wastedTotal / total) * 100 });
  }

  return { segments };
}
