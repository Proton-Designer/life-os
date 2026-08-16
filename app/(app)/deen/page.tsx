import { redirect } from "next/navigation";
import { Flame, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { calculatePrayerTimes, type CalcMethod, type AsrMadhab } from "@/lib/prayer-times/calculate";
import {
  localDateString,
  localWeekday,
  getWeekStartDate,
  addDaysToDateString,
  getTimezoneOffsetMinutes,
} from "@/lib/date-utils";
import { PrayerRow, type PrayerName, type PrayerStatus } from "@/components/deen/prayer-row";
import { QuranCard } from "@/components/deen/quran-card";
import { ReflectionTracker } from "@/components/deen/reflection-tracker";
import type { ReflectionEntry } from "@/lib/deen/reflection-sparkline";
import { HabitBuilder, type DeenHabitData } from "@/components/deen/habit-builder";
import { computeHabitStreak } from "@/lib/deen/habit-streak";
import { computePrayerStreak } from "@/lib/deen/prayer-streak";
import { countRecentQadaCatchUps } from "@/lib/deen/qada-progress";
import { bucketPagesByDay } from "@/lib/deen/quran-trend";
import { buildPrayerConsistencyRows, computeOnTimeRate } from "@/lib/deen/prayer-consistency";
import { NextUpHero } from "@/components/home/next-up-hero";
import type { PriorityItem } from "@/lib/home/types";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { AreaChart } from "@/components/charts/area-chart";
import { ConsistencyGrid } from "@/components/charts/consistency-grid";

const PRAYERS: { name: PrayerName; label: string }[] = [
  { name: "fajr", label: "Fajr" },
  { name: "dhuhr", label: "Dhuhr" },
  { name: "asr", label: "Asr" },
  { name: "maghrib", label: "Maghrib" },
  { name: "isha", label: "Isha" },
];

const PRAYER_STATUS_STYLE = {
  on_time: { colorVar: "--accent-business", treatment: "solid" as const, label: "On-time" },
  qada: { colorVar: "--accent-deen", treatment: "hatch" as const, label: "Qada" },
  missed: { colorVar: "--destructive", treatment: "hollow" as const, label: "Missed" },
};

export default async function DeenPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const isFriday = localWeekday(now, timezone) === "Friday";
  const weekStart = getWeekStartDate(dateStr);
  const previousWeekStart = addDaysToDateString(weekStart, -7);
  const sixtyDaysAgoStr = addDaysToDateString(dateStr, -59);
  const thirtyDaysAgoStr = addDaysToDateString(dateStr, -29);
  const sevenDaysAgoStr = addDaysToDateString(dateStr, -6);

  const [
    { data: prayerHistoryRows },
    { data: quranSessionRows },
    { data: weeklyGoal },
    { data: reflectionRows },
    { data: habitRows },
    { data: habitLogRows },
    { data: currentFocusRow },
    { data: previousFocusRow },
  ] = await Promise.all([
    // One 60-day range query serves today's status, the 30-day consistency
    // grid, the streak, and the 7-day qada catch-up count — sliced in
    // memory rather than four separate queries.
    supabase.from("prayers").select("date, prayer_name, status").eq("user_id", userId).gte("date", sixtyDaysAgoStr),
    supabase
      .from("quran_sessions")
      .select("date, pages_read, surah, juz")
      .eq("user_id", userId)
      .gte("date", previousWeekStart)
      .order("date", { ascending: false }),
    supabase
      .from("weekly_goals")
      .select("quran_page_target")
      .eq("user_id", userId)
      .eq("domain", "deen")
      .eq("week_start_date", weekStart)
      .maybeSingle(),
    supabase.from("reflection_entries").select("date, tier").eq("user_id", userId).gte("date", sevenDaysAgoStr),
    supabase.from("deen_habits").select("id, name, committed_date").eq("user_id", userId).eq("archived", false),
    supabase
      .from("deen_habit_logs")
      .select("habit_id, date, completed")
      .eq("user_id", userId)
      .gte("date", sixtyDaysAgoStr),
    supabase
      .from("deen_weekly_focus")
      .select("habit_id")
      .eq("user_id", userId)
      .eq("week_start_date", weekStart)
      .maybeSingle(),
    supabase
      .from("deen_weekly_focus")
      .select("habit_id")
      .eq("user_id", userId)
      .eq("week_start_date", previousWeekStart)
      .maybeSingle(),
  ]);

  const allPrayerRows = prayerHistoryRows ?? [];
  const todayStatusFor = (name: string) =>
    (allPrayerRows.find((p) => p.date === dateStr && p.prayer_name === name)?.status as PrayerStatus) ?? "pending";

  // --- Prayer time computation, for the Next Prayer KPI ---
  let prayerTimes: Record<PrayerName, Date> | null = null;
  if (profile?.location_lat != null && profile?.location_lng != null) {
    prayerTimes = calculatePrayerTimes({
      date: now,
      lat: profile.location_lat,
      lng: profile.location_lng,
      timezoneOffsetMinutes: getTimezoneOffsetMinutes(now, timezone),
      calcMethod: (profile.prayer_calc_method as CalcMethod) || "MWL",
      asrMadhab: (profile.asr_madhab as AsrMadhab) || "standard",
    });
  }
  const pendingPrayers = PRAYERS.filter((p) => todayStatusFor(p.name) === "pending");
  const nextPrayer = pendingPrayers[0] ?? null;
  const nextPrayerItem: PriorityItem | null =
    nextPrayer && prayerTimes
      ? {
          id: `prayer-${nextPrayer.name}`,
          domain: "deen",
          title: nextPrayer.name === "dhuhr" && isFriday ? "Jummah" : nextPrayer.label,
          dueAt: prayerTimes[nextPrayer.name],
          date: dateStr,
          urgencyBucket: "later_today",
          completed: false,
          actionType: "toggle_prayer",
          actionRefId: nextPrayer.name,
        }
      : null;

  // --- Salah panel hero + caption ---
  const salahDoneCount = PRAYERS.filter((p) => {
    const s = todayStatusFor(p.name);
    return s === "on_time" || s === "qada";
  }).length;
  const remainingLabels = pendingPrayers.map((p) => (p.name === "dhuhr" && isFriday ? "Jummah" : p.label));
  const salahCaption =
    remainingLabels.length === 0
      ? "All 5 prayers logged for today"
      : remainingLabels.length === 1
        ? `${remainingLabels[0]} still due`
        : `${remainingLabels.length} remaining: ${remainingLabels.join(", ")}`;

  // --- Prayer consistency grid (30 days) ---
  const thirtyDayRows = allPrayerRows.filter((p) => p.date >= thirtyDaysAgoStr);
  const thirtyDays = Array.from({ length: 30 }, (_, i) => addDaysToDateString(thirtyDaysAgoStr, i));
  const consistencyRows = buildPrayerConsistencyRows(thirtyDayRows, thirtyDays);
  const onTimeRate = computeOnTimeRate(thirtyDayRows, 30);

  // --- Prayer streak ---
  const prayersByDate: Record<string, string[]> = {};
  for (const row of allPrayerRows) (prayersByDate[row.date] ??= []).push(row.status);
  const prayerStreak = computePrayerStreak(prayersByDate, dateStr);

  // --- Qada backlog: recent catch-up count (real derived signal — qada_owed itself has no history) ---
  const sevenDayRows = allPrayerRows.filter((p) => p.date >= sevenDaysAgoStr);
  const recentQadaCatchUps = countRecentQadaCatchUps(sevenDayRows);

  // --- Qur'an: this week's total + delta vs last week + daily trend ---
  const sessions = quranSessionRows ?? [];
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateString(weekStart, i));
  const dailyPages = bucketPagesByDay(sessions, weekDates);
  const weekPagesRead = dailyPages.reduce((a, b) => a + b, 0);
  const previousWeekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateString(previousWeekStart, i));
  const previousWeekPages = bucketPagesByDay(sessions, previousWeekDates).reduce((a, b) => a + b, 0);
  const pagesDelta = weekPagesRead - previousWeekPages;
  const quranTarget = weeklyGoal?.quran_page_target ?? null;
  const latestSession = sessions[0] ?? null;
  const recentSessionDates = sessions.filter((s) => s.date >= sixtyDaysAgoStr).map((s) => s.date);
  const weekLabels = weekDates.map((d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }));

  // --- Reflection ---
  const reflectionEntries: ReflectionEntry[] = (reflectionRows ?? []).map((r) => ({
    date: r.date,
    tier: r.tier as 1 | 2 | 3,
  }));

  // --- Habit Builder ---
  const deenHabits: DeenHabitData[] = (habitRows ?? []).map((h) => {
    const habitLogs = (habitLogRows ?? []).filter((l) => l.habit_id === h.id);
    const completedDates = habitLogs.filter((l) => l.completed).map((l) => l.date);
    const completedToday = habitLogs.some((l) => l.date === dateStr && l.completed);
    return {
      id: h.id,
      name: h.name,
      committedDate: h.committed_date,
      streak: computeHabitStreak(completedDates, dateStr),
      completedToday,
    };
  });

  return (
    <PageContainer>
      <PageHeader title="Deen" />

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">
        {nextPrayerItem ? (
          <div className="w-[78vw] shrink-0 snap-start md:w-auto">
            <NextUpHero
              item={nextPrayerItem}
              now={now}
              caption={pendingPrayers.length > 1 ? `${pendingPrayers.length - 1} more today` : "Last one for today"}
            />
          </div>
        ) : (
          <div className="w-[78vw] shrink-0 snap-start md:w-auto">
            <EmptyState
              icon={History}
              message={prayerTimes ? "All 5 prayers logged for today" : "Set your location in Settings for prayer times"}
              action={{ label: "Go to Settings", href: "/settings" }}
            />
          </div>
        )}
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Flame}
            accent="deen"
            label="Prayer streak"
            value={`${prayerStreak}`}
            caption={prayerStreak === 0 ? "Pray all 5 today to start one" : "Keep it going"}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={History}
            accent="deen"
            label="Qada backlog"
            value={`${profile?.qada_owed ?? 0}`}
            caption={
              recentQadaCatchUps === 0
                ? "None caught up in the last 7 days"
                : `${recentQadaCatchUps} caught up in the last 7 days`
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Panel title="Salah today" heroValue={`${salahDoneCount}/5`} caption={salahCaption}>
            <ul className="flex flex-col gap-2">
              {PRAYERS.map((p) => {
                const status = todayStatusFor(p.name);
                const label = p.name === "dhuhr" && isFriday ? "Jummah" : p.label;
                return <PrayerRow key={p.name} date={dateStr} prayerName={p.name} label={label} status={status} />;
              })}
            </ul>
          </Panel>
        </div>
        <div className="lg:col-span-7">
          <Panel title="Prayer consistency, last 30 days" heroValue={`${onTimeRate}%`} caption="On-time rate over the window">
            <ConsistencyGrid rows={consistencyRows} statusStyle={PRAYER_STATUS_STYLE} />
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Panel
            title="Qur'an"
            heroValue={quranTarget ? `${weekPagesRead}/${quranTarget}` : weekPagesRead}
            delta={
              pagesDelta === 0
                ? undefined
                : { direction: pagesDelta > 0 ? "up" : "down", text: `${pagesDelta > 0 ? "+" : ""}${pagesDelta} vs last week` }
            }
            caption="pages read this week"
          >
            <div className="flex flex-col gap-4">
              <AreaChart categories={weekLabels} series={[{ label: "Pages", colorVar: "--series-deen", values: dailyPages }]} height={140} />
              <QuranCard
                currentSurah={latestSession?.surah ?? null}
                currentJuz={latestSession?.juz ?? null}
                sessionDates={recentSessionDates}
                todayStr={dateStr}
              />
            </div>
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <Panel title="Habit Builder">
            <HabitBuilder
              todayStr={dateStr}
              habits={deenHabits}
              currentFocusHabitId={currentFocusRow?.habit_id ?? null}
              previousFocusHabitId={previousFocusRow?.habit_id ?? null}
            />
          </Panel>
        </div>
      </div>

      <Panel title="Reflection">
        <ReflectionTracker entries={reflectionEntries} todayStr={dateStr} />
      </Panel>
    </PageContainer>
  );
}
