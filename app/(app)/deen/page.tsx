import { redirect } from "next/navigation";
import { Flame, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";
import { computePrayerWindows, type PrayerName } from "@/lib/prayer-times/windows";
import {
  resolvePrayerStatuses,
  computeTrackingFloorDateStr,
  type EffectivePrayerStatus,
} from "@/lib/deen/prayer-status";
import type { SunnahSlot } from "@/lib/deen/sunnah";
import {
  localDateString,
  localWeekday,
  getWeekStartDate,
  addDaysToDateString,
  formatWindowRelativeTime,
} from "@/lib/date-utils";
import { PrayerRow } from "@/components/deen/prayer-row";
import { SalahViewMoreButton } from "@/components/deen/salah-view-more-button";
import { QuranPlanConnected } from "@/components/deen/quran-plan-connected";
import { toQuranPlanView } from "@/components/deen/quran-plan-view";
import { getQuranLedgerCore, getQuranOverviewCore } from "@/lib/quran/plan-core";
import { weeklyQuranTarget } from "@/lib/quran/surfaces";
import { ReflectionTracker } from "@/components/deen/reflection-tracker";
import type { ReflectionEntry } from "@/lib/deen/reflection-strip";
import { HabitBuilder, type DeenHabitData } from "@/components/deen/habit-builder";
import { buildFaithPractices, getOlderFlexibleLogs, FAITH_HABIT_COLUMNS } from "@/lib/deen/practices";
import { frequencyFromColumns } from "@/lib/habits/frequency";
import { buildHabitConsistencyRows } from "@/lib/deen/habit-consistency";
import { accentForPrayerStreak, computeLongestPrayerStreak } from "@/lib/deen/prayer-streak";
import { getOnTimePrayerDays } from "@/lib/deen/prayer-streak-reader";
import { computeHabitStreak } from "@/lib/deen/habit-streak";
import { countRecentQadaCatchUps, countRecentMisses, accentForQadaBacklog } from "@/lib/deen/qada-progress";
import { buildQadaBacklog, bucketQadaBacklog, itemsInQadaWindow, qadaWindowStart, totalQadaOwed } from "@/lib/deen/qada-backlog";
import { QadaBacklogCard } from "@/components/deen/qada-backlog-card";
import { bucketPagesByDay } from "@/lib/deen/quran-trend";
import { buildPrayerConsistencyRows, computeOnTimeRate } from "@/lib/deen/prayer-consistency";
import { NextUpHero } from "@/components/home/next-up-hero";
import type { PriorityItem } from "@/lib/home/types";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ConsistencyGrid } from "@/components/charts/consistency-grid";
import { getPageLayout } from "@/app/(app)/page-layout-actions";
import { LayoutSlot, buildLayoutMap, allWidgetsHidden } from "@/components/page-layout/layout-slot";
import { WidgetManagerButton } from "@/components/page-layout/widget-manager-button";

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
  // D3: Deen Mode OFF -- a direct URL (/deen, /personal/faith) never renders
  // Faith. Data untouched; OFF -> ON restores the page exactly.
  if (!isDeenModeOn(profile)) redirect("/");
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const isFriday = localWeekday(now, timezone) === "Friday";
  const weekStart = getWeekStartDate(dateStr);
  const previousWeekStart = addDaysToDateString(weekStart, -7);
  const sixtyDaysAgoStr = addDaysToDateString(dateStr, -59);
  // QADA-3M: the Qada backlog preview covers the last 3 calendar months. One
  // prayer-history read starts at whichever is earlier so the 60-day grids/streak
  // and the 3-month backlog share it.
  const qadaWindowStartStr = qadaWindowStart(dateStr);
  const prayerHistoryStartStr = qadaWindowStartStr < sixtyDaysAgoStr ? qadaWindowStartStr : sixtyDaysAgoStr;
  const thirtyDaysAgoStr = addDaysToDateString(dateStr, -29);
  const sevenDaysAgoStr = addDaysToDateString(dateStr, -6);
  // The monthly reflection calendar (spec 2026-08-23 §7) needs every entry
  // back to the 1st of the CURRENT month, not just a rolling 30 days — in a
  // 31-day month on the 31st, "30 days back" lands on the 2nd and silently
  // drops the 1st. Whichever bound is earlier wins; the query only grows.
  const monthStartStr = `${dateStr.slice(0, 8)}01`;
  const reflectionSinceStr = monthStartStr < thirtyDaysAgoStr ? monthStartStr : thirtyDaysAgoStr;

  const [
    { data: prayerHistoryRows },
    { data: quranSessionRows },
    { data: reflectionRows },
    { data: habitRows },
    { data: habitLogRows },
    { data: currentFocusRow },
    { data: sunnahLogRows },
    quranOverview,
    quranLedger,
    layout,
    onTimePrayerDays,
  ] = await Promise.all([
    // One 60-day range query serves today's status, the 30-day consistency
    // grid, the streak, and the 7-day qada catch-up count — sliced in
    // memory rather than four separate queries.
    supabase.from("prayers").select("date, prayer_name, status").eq("user_id", userId).gte("date", prayerHistoryStartStr),
    supabase
      .from("quran_sessions")
      .select("date, pages_read, surah, juz")
      .eq("user_id", userId)
      .gte("date", previousWeekStart)
      .order("date", { ascending: false }),
    supabase
      .from("reflection_entries")
      .select("date, tier, created_at")
      .eq("user_id", userId)
      .gte("date", reflectionSinceStr),
    supabase
      .from("deen_habits")
      .select(FAITH_HABIT_COLUMNS)
      .eq("user_id", userId)
      .eq("archived", false),
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
    supabase.from("sunnah_logs").select("prayer_name, slot, completed").eq("user_id", userId).eq("date", dateStr).eq("completed", true),
    // QURAN-02: the khatm plan's one read (plan, today's portion, status, week). Deen is ON here (the page redirects otherwise).
    getQuranOverviewCore(supabase, userId, dateStr),
    // QURAN-03: the plan's reading log (History, the day chart and the fit-preview run on it); null without a plan.
    getQuranLedgerCore(supabase, userId),
    getPageLayout("deen"),
    getOnTimePrayerDays(supabase, userId),
  ]);
  const layoutMap = buildLayoutMap(layout);

  const allPrayerRows = prayerHistoryRows ?? [];

  // --- Prayer windows + derived statuses (never written, only ever read) ---
  // Windowed, not instants: a prayer's status is derived at read time from
  // its window against `now`, floored so nothing before tracking began can
  // be derived as missed — see computeTrackingFloorDateStr's own doc
  // comment for the full "why" (R7's account wipe, migration 051).
  const accountCreatedDateStr = computeTrackingFloorDateStr(profile, timezone, now);
  const historyDayCount = Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${prayerHistoryStartStr}T00:00:00Z`)) / 86_400_000) + 1;
  const historyDates = Array.from({ length: historyDayCount }, (_, i) => addDaysToDateString(prayerHistoryStartStr, i));
  const resolvedStatuses = resolvePrayerStatuses({
    rows: allPrayerRows,
    dates: historyDates,
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
  // Pending only — never missed, and never merely upcoming. This used to
  // also match "upcoming" so a closed-and-unlogged Fajr didn't get stuck
  // showing as "next" all day, but that had the side effect of showing the
  // NEXT prayer (with its live Mark-done button) the instant the current one
  // was logged, hours before that next prayer's own window opens (Ayman,
  // 2026-08-28). Excluding "missed" already solved the original problem on
  // its own — a missed prayer simply doesn't match "pending" either. No
  // pending prayer right now (whether because everything's logged, or
  // because we're between two prayers' windows): no hero, the EmptyState
  // below covers both.
  const nextPrayer = todayWindows
    ? PRAYERS.find((p) => todayStatusFor(p.name) === "pending") ?? null
    : null;
  const nextPrayerItem: PriorityItem | null = nextPrayer
    ? {
        id: `prayer-${nextPrayer.name}`,
        domain: "deen",
        title: nextPrayer.name === "dhuhr" && isFriday ? "Jummah" : nextPrayer.label,
        dueAt: todayWindows?.[nextPrayer.name]?.start ?? null,
        windowEndAt: todayWindows?.[nextPrayer.name]?.end ?? null,
        date: dateStr,
        urgencyBucket: "later_today",
        completed: false,
        actionType: "toggle_prayer",
        actionRefId: nextPrayer.name,
        cost: null,
      }
    : null;

  // Informational only — read by the EmptyState fallback below, never
  // rendered as its own actionable card. The gap between one prayer's
  // window closing and the next one's opening is real (windows aren't
  // contiguous), and losing "next prayer is Dhuhr, in 3h" entirely during
  // that gap would trade Ayman's actual complaint (a live Mark-done button
  // hours early) for a different regression (no idea what's next for
  // hours). A genuinely missed-and-unlogged prayer still wins the message
  // slot below — that needs action now, which outranks telling the user
  // what's merely upcoming.
  const upcomingPrayer = todayWindows
    ? PRAYERS.find((p) => todayStatusFor(p.name) === "upcoming") ?? null
    : null;
  const hasMissedUnlogged = PRAYERS.some((p) => todayStatusFor(p.name) === "missed");

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
  // computeOnTimeRate's denominator is a fixed dayCount*5 (the window size),
  // never zero, so it always returns a real-looking percentage even when
  // every day in the window is before the tracking floor (Opus Lead review,
  // post-wipe rehearsal: a bare "0%" heroValue read as a real score, even
  // though the grid right below it was correctly blank). Checked against
  // any CLOSED trackable day (strictly before today, on/after the floor),
  // not just "is today in range" — today alone is always >= the floor the
  // moment tracking starts, but a same-day, still-in-progress "0%" over a
  // 150-slot denominator would be exactly as misleading as the all-history
  // case this is fixing. Reuses computeTrackingFloorDateStr's already-
  // computed floor rather than inventing a second no-data rule.
  const hasTrackableConsistencyDay = thirtyDays.some((d) => d < dateStr && d >= accountCreatedDateStr);

  // --- Prayer streak ---
  // On-time only: a prayer made up through Qada breaks the day. Computed from the user's WHOLE history of on-time days
  // (not the 60-day window the rest of this page uses), so a long streak isn't capped and the best-ever one is known.
  const prayerStreak = computeHabitStreak(onTimePrayerDays, dateStr);
  const longestPrayerStreak = Math.max(computeLongestPrayerStreak(onTimePrayerDays), prayerStreak);

  // --- Qada backlog: recent catch-up vs. newly-missed counts (real derived signal — qada_owed itself has no history) ---
  const sevenDayRows = allPrayerRows.filter((p) => p.date >= sevenDaysAgoStr);
  const recentQadaCatchUps = countRecentQadaCatchUps(sevenDayRows);
  const recentMisses = countRecentMisses(sevenDayRows);

  // --- Qada backlog: itemized. profiles.qada_owed is legacy pre-app debt,
  // left completely alone; the displayed total adds the real derived count
  // on top of it — never recomputes or migrates the legacy number itself.
  const qadaBacklog = buildQadaBacklog(resolvedStatuses);
  const qadaWindowItems = itemsInQadaWindow(qadaBacklog.items, dateStr);
  const totalQadaBacklog = totalQadaOwed(profile?.qada_owed ?? 0, qadaWindowItems.length);
  const qadaBuckets = bucketQadaBacklog(qadaWindowItems, sevenDaysAgoStr, thirtyDaysAgoStr);

  // --- Qur'an: this week's total + delta vs last week + daily trend ---
  const sessions = quranSessionRows ?? [];
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateString(weekStart, i));
  const dailyPages = bucketPagesByDay(sessions, weekDates);
  const weekPagesRead = dailyPages.reduce((a, b) => a + b, 0);
  const previousWeekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateString(previousWeekStart, i));
  const previousWeekPages = bucketPagesByDay(sessions, previousWeekDates).reduce((a, b) => a + b, 0);
  const pagesDelta = weekPagesRead - previousWeekPages;
  // The weekly target: the plan's (daily pace x 7) while a plan is active, else none.
  const quranTarget = weeklyQuranTarget(quranOverview);

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
  // HABITS-01: one derivation shared with Home and the weekly reset (lib/deen/practices.ts).
  // Flexible cadences (N per week/month, every N days) need a longer log history for their streak than the 60-day read above.
  const olderFlexibleLogs = await getOlderFlexibleLogs(supabase, userId, habitRows ?? [], dateStr).catch(() => []);
  const allHabitLogRows = [...(habitLogRows ?? []), ...olderFlexibleLogs];
  const deenHabits: DeenHabitData[] = buildFaithPractices(habitRows ?? [], allHabitLogRows, dateStr).map((p) => ({
    id: p.id,
    name: p.name,
    committedDate: p.committedDate,
    anchorCue: p.anchorCue,
    streak: p.streak,
    streakInfo: p.streakInfo,
    rollingRate: p.rollingRate,
    completedToday: p.completedToday,
    stageOverride: p.stageOverride,
    frequency: p.frequency,
    due: p.due,
  }));
  const habitConsistencyRows = buildHabitConsistencyRows(
    (habitRows ?? []).map((h) => ({ id: h.id, name: h.name, committedDate: h.committed_date, frequency: frequencyFromColumns(h) })),
    habitLogsForConsistency,
    thirtyDays,
    dateStr
  );

  return (
    <PageContainer>
      <PageHeader title="Faith" actions={<WidgetManagerButton domainKey="deen" />} />

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
            <div className="flex h-full min-h-[168px] flex-col justify-center rounded-2xl border border-border/40">
              <EmptyState
                icon={History}
                message={
                  !todayWindows
                    ? "Set your location in Settings for prayer times"
                    : hasMissedUnlogged
                      ? "Some prayers from today still need logging"
                      : upcomingPrayer
                        ? `Next: ${upcomingPrayer.name === "dhuhr" && isFriday ? "Jummah" : upcomingPrayer.label} ${formatWindowRelativeTime(
                            todayWindows[upcomingPrayer.name]?.start ?? null,
                            todayWindows[upcomingPrayer.name]?.end ?? null,
                            now
                          )}`
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
            value={
              <>
                {prayerStreak}
                {/* Best ever, beside the current number in smaller type (not a second card: it is the same fact's context). */}
                <span className="ml-2 align-baseline text-sm font-medium text-muted-foreground" data-testid="prayer-streak-longest">
                  Longest {longestPrayerStreak}
                </span>
              </>
            }
            caption={prayerStreak === 0 ? "Pray all 5 on time today to start one" : "All 5 on time · Qada breaks it"}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <QadaBacklogCard
            accent={accentForQadaBacklog(totalQadaBacklog, recentQadaCatchUps, recentMisses)}
            caption={
              recentQadaCatchUps === 0 && recentMisses === 0
                ? "None caught up in the last 7 days"
                : recentQadaCatchUps >= recentMisses
                  ? `${recentQadaCatchUps} caught up in the last 7 days`
                  : `${recentMisses} added in the last 7 days`
            }
            buckets={qadaBuckets}
            legacyOwed={profile?.qada_owed ?? 0}
          />
        </div>
      </div>

      {allWidgetsHidden(layout) ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Every widget on this page is hidden. <WidgetManagerButton domainKey="deen" variant="text" />
        </div>
      ) : null}

      {/* WIDGET-02: salah/quran/reflection/habit_builder are independently
          reorderable/hideable widgets now (registry), so each is its own
          full-width LayoutSlot rather than a fixed side-by-side pair. */}
      <LayoutSlot layout={layoutMap} widgetKey="salah">
        <div id="prayers" className="scroll-mt-20">
          <Panel
            title="Salah"
            heroValue={`${salahDoneCount}/5`}
            caption={salahCaption}
            controls={
              <SalahViewMoreButton
                initialYear={Number(dateStr.slice(0, 4))}
                initialMonth={Number(dateStr.slice(5, 7))}
                todayStr={dateStr}
              />
            }
          >
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
      </LayoutSlot>
      <LayoutSlot layout={layoutMap} widgetKey="quran">
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
          <QuranPlanConnected view={toQuranPlanView(quranOverview, quranLedger?.entries ?? [])} todayStr={dateStr} />
        </Panel>
      </LayoutSlot>

      <LayoutSlot layout={layoutMap} widgetKey="reflection">
        <Panel title="Reflection">
          <ReflectionTracker entries={reflectionEntries} todayStr={dateStr} timezone={timezone} />
        </Panel>
      </LayoutSlot>
      <LayoutSlot layout={layoutMap} widgetKey="habit_builder">
        <div id="habit-builder">
          <Panel title="Habit Builder">
            <HabitBuilder
              todayStr={dateStr}
              habits={deenHabits}
              currentFocusHabitId={currentFocusRow?.habit_id ?? null}
              habitConsistencyRows={habitConsistencyRows}
            />
          </Panel>
        </div>
      </LayoutSlot>

      <LayoutSlot layout={layoutMap} widgetKey="prayer_consistency">
        <Panel
          title="Prayer consistency, last 30 days"
          heroValue={hasTrackableConsistencyDay ? `${onTimeRate}%` : "No data yet"}
          caption={hasTrackableConsistencyDay ? "On-time rate over the window" : "Tracking started today"}
        >
          <ConsistencyGrid rows={consistencyRows} statusStyle={PRAYER_STATUS_STYLE} showDateLabels />
        </Panel>
      </LayoutSlot>
    </PageContainer>
  );
}
