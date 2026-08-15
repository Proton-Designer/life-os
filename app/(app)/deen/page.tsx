import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, localWeekday, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { PrayerRow, type PrayerName, type PrayerStatus } from "@/components/deen/prayer-row";
import { QuranCard } from "@/components/deen/quran-card";
import { QadaCounter } from "@/components/deen/qada-counter";
import { ReflectionTracker } from "@/components/deen/reflection-tracker";
import type { ReflectionEntry } from "@/lib/deen/reflection-sparkline";
import { HabitBuilder, type DeenHabitData } from "@/components/deen/habit-builder";
import { computeHabitStreak } from "@/lib/deen/habit-streak";

const PRAYERS: { name: PrayerName; label: string }[] = [
  { name: "fajr", label: "Fajr" },
  { name: "dhuhr", label: "Dhuhr" },
  { name: "asr", label: "Asr" },
  { name: "maghrib", label: "Maghrib" },
  { name: "isha", label: "Isha" },
];

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

  const [{ data: prayerRows }, { data: quranSessions }, { data: weeklyGoal }] =
    await Promise.all([
      supabase.from("prayers").select("prayer_name, status").eq("user_id", userId).eq("date", dateStr),
      supabase
        .from("quran_sessions")
        .select("date, pages_read, surah, juz")
        .eq("user_id", userId)
        .gte("date", weekStart)
        .order("date", { ascending: false }),
      supabase
        .from("weekly_goals")
        .select("quran_page_target")
        .eq("user_id", userId)
        .eq("domain", "deen")
        .eq("week_start_date", weekStart)
        .maybeSingle(),
    ]);

  // Streak needs a longer lookback than "this week" — fetch separately, dates only.
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgoStr = localDateString(sixtyDaysAgo, timezone);
  const { data: recentSessionDates } = await supabase
    .from("quran_sessions")
    .select("date")
    .eq("user_id", userId)
    .gte("date", sixtyDaysAgoStr);

  const weekPagesRead = (quranSessions ?? []).reduce((sum, s) => sum + s.pages_read, 0);
  const latestSession = quranSessions?.[0] ?? null;

  const sevenDaysAgoStr = addDaysToDateString(dateStr, -6);
  const previousWeekStart = addDaysToDateString(weekStart, -7);

  const [
    { data: reflectionRows },
    { data: habitRows },
    { data: habitLogRows },
    { data: currentFocusRow },
    { data: previousFocusRow },
  ] = await Promise.all([
    supabase
      .from("reflection_entries")
      .select("date, tier")
      .eq("user_id", userId)
      .gte("date", sevenDaysAgoStr),
    supabase
      .from("deen_habits")
      .select("id, name, committed_date")
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
    supabase
      .from("deen_weekly_focus")
      .select("habit_id")
      .eq("user_id", userId)
      .eq("week_start_date", previousWeekStart)
      .maybeSingle(),
  ]);

  const reflectionEntries: ReflectionEntry[] = (reflectionRows ?? []).map((r) => ({
    date: r.date,
    tier: r.tier as 1 | 2 | 3,
  }));

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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 md:py-12">
      <section className="mx-auto w-full max-w-2xl">
        <h1 className="mb-4 text-lg font-semibold">Salah</h1>
        <ul className="flex flex-col gap-2">
          {PRAYERS.map((p) => {
            const row = prayerRows?.find((r) => r.prayer_name === p.name);
            const status = (row?.status ?? "pending") as PrayerStatus;
            const label = p.name === "dhuhr" && isFriday ? "Jummah" : p.label;
            return (
              <PrayerRow key={p.name} date={dateStr} prayerName={p.name} label={label} status={status} />
            );
          })}
        </ul>
      </section>

      <section className="mx-auto w-full max-w-2xl">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Qur&apos;an</h2>
        <QuranCard
          currentSurah={latestSession?.surah ?? null}
          currentJuz={latestSession?.juz ?? null}
          weekPagesRead={weekPagesRead}
          weeklyTarget={weeklyGoal?.quran_page_target ?? null}
          sessionDates={(recentSessionDates ?? []).map((s) => s.date)}
          todayStr={dateStr}
        />
      </section>

      <section className="mx-auto w-full max-w-2xl">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Qada backlog</h2>
        <QadaCounter owed={profile?.qada_owed ?? 0} />
      </section>

      <section className="mx-auto w-full max-w-2xl">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Reflection</h2>
        <ReflectionTracker entries={reflectionEntries} todayStr={dateStr} />
      </section>

      <section className="w-full">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Habit Builder</h2>
        <HabitBuilder
          todayStr={dateStr}
          habits={deenHabits}
          currentFocusHabitId={currentFocusRow?.habit_id ?? null}
          previousFocusHabitId={previousFocusRow?.habit_id ?? null}
        />
      </section>
    </div>
  );
}
