"use server";

import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, datesInMonth } from "@/lib/date-utils";
import { resolvePrayerStatuses, type EffectivePrayerStatus } from "@/lib/deen/prayer-status";
import { PRAYER_NAMES, type PrayerName } from "@/lib/prayer-times/windows";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";

export type SalahDaySummary = {
  date: string;
  /** on_time + qada count, out of 5 (Opus Lead ruling — a prayer prayed
   * late is still a prayer prayed; pending/upcoming/missed don't count). */
  doneCount: number;
  /**
   * False for a day this account never actually tracked — before the
   * tracking floor, or in the future — which must render as an empty/
   * neutral cell, never as "0/5, all missed." A genuinely tracked past day
   * with zero prayers logged (`hasData: true, doneCount: 0`) is a real
   * fact and IS allowed to render as empty; the distinction that matters
   * is "never tracked" vs "tracked and empty," not the number itself.
   *
   * KNOWN GAP, flagged to the Lead (2026-08-26): the floor used here is
   * `profiles.created_at`, which R7's account wipe deliberately does not
   * reset — so immediately after the wipe, every day between the
   * account's original signup and yesterday will read `hasData: true`
   * (wrongly) with `doneCount: 0`, because resolvePrayerStatuses's own
   * floor still thinks tracking started months ago. If the Lead's ruling
   * adds a dedicated tracking-start column, swap `accountCreatedDateStr`
   * below for it — that's the only line this function needs changed.
   */
  hasData: boolean;
};

export async function getSalahMonthSummary(year: number, month: number): Promise<SalahDaySummary[]> {
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const lat = profile?.location_lat ?? null;
  const lng = profile?.location_lng ?? null;
  const calcMethod = (profile?.prayer_calc_method ?? "ISNA") as CalcMethod;
  const asrMadhab = (profile?.asr_madhab ?? "standard") as AsrMadhab;
  const now = new Date();
  const todayStr = localDateString(now, timezone);
  const accountCreatedDateStr = localDateString(profile?.created_at ? new Date(profile.created_at) : now, timezone);

  const dates = datesInMonth(year, month);
  const { data: rows, error } = await supabase
    .from("prayers")
    .select("date, prayer_name, status")
    .eq("user_id", userId)
    .gte("date", dates[0])
    .lte("date", dates[dates.length - 1]);
  if (error) throw error;

  const resolved = resolvePrayerStatuses({
    rows: rows ?? [],
    dates,
    lat,
    lng,
    timezone,
    calcMethod,
    asrMadhab,
    now,
    accountCreatedDateStr,
  });

  return dates.map((date) => {
    const dayStatuses = resolved[date];
    const doneCount = PRAYER_NAMES.filter(
      (name) => dayStatuses[name] === "on_time" || dayStatuses[name] === "qada"
    ).length;
    const hasData = date <= todayStr && date >= accountCreatedDateStr;
    return { date, doneCount, hasData };
  });
}

export type SalahDayDetail = { prayerName: PrayerName; label: string; status: EffectivePrayerStatus };

const PRAYER_LABEL: Record<PrayerName, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

export async function getSalahDayDetail(date: string): Promise<SalahDayDetail[]> {
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const lat = profile?.location_lat ?? null;
  const lng = profile?.location_lng ?? null;
  const calcMethod = (profile?.prayer_calc_method ?? "ISNA") as CalcMethod;
  const asrMadhab = (profile?.asr_madhab ?? "standard") as AsrMadhab;
  const now = new Date();
  const accountCreatedDateStr = localDateString(profile?.created_at ? new Date(profile.created_at) : now, timezone);

  const { data: rows, error } = await supabase
    .from("prayers")
    .select("date, prayer_name, status")
    .eq("user_id", userId)
    .eq("date", date);
  if (error) throw error;

  const resolved = resolvePrayerStatuses({
    rows: rows ?? [],
    dates: [date],
    lat,
    lng,
    timezone,
    calcMethod,
    asrMadhab,
    now,
    accountCreatedDateStr,
  });

  return PRAYER_NAMES.map((name) => ({ prayerName: name, label: PRAYER_LABEL[name], status: resolved[date][name] }));
}
