import { redirect } from "next/navigation";
import { Flame, History, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";
import { computePrayerWindows, type PrayerName } from "@/lib/prayer-times/windows";
import {
  resolvePrayerStatuses,
  type EffectivePrayerStatus,
} from "@/lib/deen/prayer-status";
import type { SunnahSlot } from "@/lib/deen/sunnah";
import {
  localDateString,
  localWeekday,
  getWeekStartDate,
  addDaysToDateString,
} from "@/lib/date-utils";
import { PrayerRow } from "@/components/deen/prayer-row";
import { QuranCard } from "@/components/deen/quran-card";
import { ReflectionTracker } from "@/components/deen/reflection-tracker";
import type { ReflectionEntry } from "@/lib/deen/reflection-strip";
import { HabitBuilder, type DeenHabitData } from "@/components/deen/habit-builder";
import { computeHabitStreak } from "@/lib/deen/habit-streak";
import { computeHabitRollingRate, buildHabitConsistencyRows } from "@/lib/deen/habit-consistency";
import { computePrayerStreak, accentForPrayerStreak } from "@/lib/deen/prayer-streak";
import { countRecentQadaCatchUps, countRecentMisses, accentForQadaBacklog } from "@/lib/deen/qada-progress";
import { buildQadaBacklog, bucketQadaBacklog, totalQadaOwed } from "@/lib/deen/qada-backlog";
import { QadaBacklogPanel } from "@/components/deen/qada-backlog-panel";
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
    { data: sunnahLogRows },
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
    supabase
      .from("reflection_entries")
      .select("date, tier, created_at")
      .eq("user_id", userId)
      .gte("date", thirtyDaysAgoStr),
    supabase.from("deen_habits").select("id, name, committed_date, anchor_cue").eq("user_id", userId).eq("archived", false),
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
    supabase.from("sunnah_logs").select("prayer_name, slot, completed").eq("user_id", userId).eq("date", dateStr).eq("completed", true),
  ]);

  const allPrayerRows = prayerHistoryRows ?? [];

  // --- Prayer windows + derived statuses (never written, only ever read) ---
  // Windowed, not instants: a prayer's status is derived at read time from
  // its window against `now`, floored at the account's own creation date so
  // nothing before the account existed can be derived as missed.
  const accountCreatedDateStr = localDateString(
    profile?.created_at ? new Date(profile.created_at) : now,
    timezone
  );
  const sixtyDayDates = Array.from({ length: 60 }, (_, i) => addDaysToDateString(sixtyDaysAgoStr, i));
  const resolvedStatuses = resolvePrayerStatuses({
    rows: allPrayerRows,
    dates: sixtyDayDates,
    lat: profile?.location_lat ?? null,
    lng: profile?.location_lng ?? null,
    timezone,
    calcMethod: (profile?.prayer_calc_method as CalcMethod) || "MWL",
    asrMadhab: (profile?.asr_madhab as AsrMadhab) || "standard",
    now,
    accountCreatedDateStr,
  });
  const todayStatusFor = (name: PrayerName): EffectivePrayerStatus => resolvedStatuses[dateStr][name];
  const sunnahCompletionsFor = (name: PrayerName): SunnahSlot[] =>
    (sunnahLogRows ?? [])
      .filter((s) => s.prayer_name === name)
      .map((s) => s.slot as SunnahSlot);

  // --- Prayer time computation, for the Next Prayer KPI ---
  let todayWindows: Record<PrayerName, { start: Date; end: Date } | null> | null = null;
  if (profile?.location_lat != null && profile?.location_lng != null) {
    todayWindows = computePrayerWindows({
      date: now,
      lat: profile.location_lat,
      lng: profile.location_lng,
      timezone,
      calcMethod: (profile.prayer_calc_method as CalcMethod) || "MWL",
      asrMadhab: (profile.asr_madhab as AsrMadhab) || "standard",
    });
  }
  // Pending or upcoming — never missed — so a closed-and-unlogged Fajr
  // doesn't get stuck showing as "next" all day. No location, no hero: the
  // EmptyState below asks for one instead.
  const nextPrayer = todayWindows
    ? PRAYERS.find((p) => {
        const s = todayStatusFor(p.name);
        return s === "pending" || s === "upcoming";
      }) ?? null
    : null;
  const nextPrayerItem: PriorityItem | null = nextPrayer
    ? {
        id: `prayer-${nextPrayer.name}`,
        domain: "deen",
        title: nextPrayer.name === "dhuhr" && isFriday ? "Jummah" : nextPrayer.label,
        dueAt: todayWindows?.[nextPrayer.name]?.start ?? null,
        date: dateStr,
        urgencyBucket: "later_today",
        completed: false,
        actionType: "toggle_prayer",
        actionRefId: nextPrayer.name,
      }
    : null;

  // --- Salah panel hero + caption ---
  // "Remaining" is everything not yet on_time/qada — pending, upcoming, AND
  // missed. A missed prayer still needs the user's attention (mark it qada
  // or on-time), so it stays in this count rather than silently dropping out.
  const unloggedToday = PRAYERS.filter((p) => {
    const s = todayStatusFor(p.name);
    return s !== "on_time" && s !== "qada";
  });
  const salahDoneCount = PRAYERS.length - unloggedToday.length;
  const remainingLabels = unloggedToday.map((p) => (p.name === "dhuhr" && isFriday ? "Jummah" : p.label));
  const salahCaption =
    remainingLabels.length === 0
      ? "All 5 prayers logged for today"
      : remainingLabels.length === 1
        ? `${remainingLabels[0]} still due`
        : `${remainingLabels.length} remaining: ${remainingLabels.join(", ")}`;

  // --- Prayer consistency grid (30 days) ---
  const thirtyDayRows = allPrayerRows.filter((p) => p.date >= thirtyDaysAgoStr);
  const thirtyDays = Array.from({ length: 30 }, (_, i) => addDaysToDateString(thirtyDaysAgoStr, i));
  const consistencyRows = buildPrayerConsistencyRows(resolvedStatuses, thirtyDays);
  const onTimeRate = computeOnTimeRate(thirtyDayRows, 30);

  // --- Prayer streak ---
  const prayersByDate: Record<string, string[]> = {};
  for (const date of sixtyDayDates) {
    prayersByDate[date] = PRAYERS.map((p) => resolvedStatuses[date][p.name]);
  }
  const prayerStreak = computePrayerStreak(prayersByDate, dateStr);

  // --- Qada backlog: recent catch-up vs. newly-missed counts (real derived signal — qada_owed itself has no history) ---
  const sevenDayRows = allPrayerRows.filter((p) => p.date >= sevenDaysAgoStr);
  const recentQadaCatchUps = countRecentQadaCatchUps(sevenDayRows);
  const recentMisses = countRecentMisses(sevenDayRows);

  // --- Qada backlog: itemized. profiles.qada_owed is legacy pre-app debt,
  // left completely alone; the displayed total adds the real derived count
  // on top of it — never recomputes or migrates the legacy number itself.
  const qadaBacklog = buildQadaBacklog(resolvedStatuses);
  const totalQadaBacklog = totalQadaOwed(profile?.qada_owed ?? 0, qadaBacklog.derivedCount);
  const qadaBuckets = bucketQadaBacklog(qadaBacklog.items, sevenDaysAgoStr, thirtyDaysAgoStr);
  const qadaMissedThisMonth = qadaBuckets.last7.length + qadaBuckets.month.length;

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
    createdAt: r.created_at,
  }));

  // --- Habit Builder ---
  // Rolling 30-day rate is now the headline progress signal, not the
  // hard-reset streak — see docs/superpowers/specs/2026-08-18-habit-builder-redesign-proposal.md
  // §2. Streak stays, but only as a secondary line (habit-builder.tsx).
  const habitLogsForConsistency = (habitLogRows ?? []).map((l) => ({
    habitId: l.habit_id,
    date: l.date,
    completed: l.completed,
  }));
  const deenHabits: DeenHabitData[] = (habitRows ?? []).map((h) => {
    const habitLogs = (habitLogRows ?? []).filter((l) => l.habit_id === h.id);
    const completedDates = habitLogs.filter((l) => l.completed).map((l) => l.date);
    const completedToday = habitLogs.some((l) => l.date === dateStr && l.completed);
    return {
      id: h.id,
      name: h.name,
      committedDate: h.committed_date,
      anchorCue: h.anchor_cue,
      streak: computeHabitStreak(completedDates, dateStr),
      rollingRate: computeHabitRollingRate(
        { id: h.id, name: h.name, committedDate: h.committed_date },
        habitLogsForConsistency,
        thirtyDaysAgoStr,
        dateStr
      ),
      completedToday,
    };
  });
  const habitConsistencyRows = buildHabitConsistencyRows(
    (habitRows ?? []).map((h) => ({ id: h.id, name: h.name, committedDate: h.committed_date })),
    habitLogsForConsistency,
    thirtyDays,
    dateStr
  );

  return (
    <PageContainer>
      <PageHeader title="Deen" />

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">
        {nextPrayerItem ? (
          <div className="w-[78vw] shrink-0 snap-start md:w-auto">
            <NextUpHero
              item={nextPrayerItem}
              now={now}
              caption={unloggedToday.length > 1 ? `${unloggedToday.length - 1} more today` : "Last one for today"}
            />
          </div>
        ) : (
          <div className="w-[78vw] shrink-0 snap-start md:w-auto">
            <div className="flex min-h-[168px] flex-col justify-center rounded-2xl border border-border/40">
              <EmptyState
                icon={History}
                message={
                  !todayWindows
                    ? "Set your location in Settings for prayer times"
                    : unloggedToday.length > 0
                      ? "Some prayers from today still need logging"
                      : "All 5 prayers logged for today"
                }
                action={{ label: "Go to Settings", href: "/settings" }}
              />
            </div>
          </div>
        )}
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Flame}
            accent={accentForPrayerStreak(prayerStreak)}
            label="Prayer streak"
            value={`${prayerStreak}`}
            caption={prayerStreak === 0 ? "Pray all 5 today to start one" : "Keep it going"}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={History}
            accent={accentForQadaBacklog(totalQadaBacklog, recentQadaCatchUps, recentMisses)}
            label="Qada backlog"
            value={`${totalQadaBacklog}`}
            caption={
              recentQadaCatchUps === 0 && recentMisses === 0
                ? "None caught up in the last 7 days"
                : recentQadaCatchUps >= recentMisses
                  ? `${recentQadaCatchUps} caught up in the last 7 days`
                  : `${recentMisses} added in the last 7 days`
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        <div id="prayers" className="lg:col-span-5 scroll-mt-20">
          <Panel className="h-full" title="Salah today" heroValue={`${salahDoneCount}/5`} caption={salahCaption}>
            <ul className="flex flex-col gap-2">
              {PRAYERS.map((p) => {
                const status = todayStatusFor(p.name);
                const label = p.name === "dhuhr" && isFriday ? "Jummah" : p.label;
                return (
                  <PrayerRow
                    key={p.name}
                    date={dateStr}
                    prayerName={p.name}
                    label={label}
                    status={status}
                    sunnahCompletions={sunnahCompletionsFor(p.name)}
                  />
                );
              })}
            </ul>
          </Panel>
        </div>
        <div className="lg:col-span-7">
          <Panel
            className="h-full"
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
              {latestSession ? (
                <AreaChart categories={weekLabels} series={[{ label: "Pages", colorVar: "--series-deen", values: dailyPages }]} height={140} />
              ) : (
                <EmptyState
                  icon={BookOpen}
                  message="No Qur'an sessions logged yet"
                  action={{ label: "Log your first session", href: "#quran-pages" }}
                />
              )}
              <QuranCard
                currentSurah={latestSession?.surah ?? null}
                currentJuz={latestSession?.juz ?? null}
                sessionDates={recentSessionDates}
                todayStr={dateStr}
              />
            </div>
          </Panel>
        </div>
      </div>

      <QadaBacklogPanel
        buckets={qadaBuckets}
        last7Count={qadaBuckets.last7.length}
        monthCount={qadaMissedThisMonth}
        allTimeCount={totalQadaBacklog}
        legacyOwed={profile?.qada_owed ?? 0}
      />

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Panel className="h-full" title="Reflection">
            <ReflectionTracker entries={reflectionEntries} todayStr={dateStr} timezone={timezone} />
          </Panel>
        </div>
        <div id="habit-builder" className="lg:col-span-8">
          <Panel className="h-full" title="Habit Builder">
            <HabitBuilder
              todayStr={dateStr}
              habits={deenHabits}
              currentFocusHabitId={currentFocusRow?.habit_id ?? null}
              previousFocusHabitId={previousFocusRow?.habit_id ?? null}
              habitConsistencyRows={habitConsistencyRows}
            />
          </Panel>
        </div>
      </div>

      <Panel title="Prayer consistency, last 30 days" heroValue={`${onTimeRate}%`} caption="On-time rate over the window">
        <ConsistencyGrid rows={consistencyRows} statusStyle={PRAYER_STATUS_STYLE} />
      </Panel>
    </PageContainer>
  );
}
