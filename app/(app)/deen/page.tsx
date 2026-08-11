import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, localWeekday, getWeekStartDate } from "@/lib/date-utils";
import { PrayerRow, type PrayerName, type PrayerStatus } from "@/components/deen/prayer-row";
import { AdhkarStrip } from "@/components/deen/adhkar-strip";
import { QuranCard } from "@/components/deen/quran-card";
import { QadaCounter } from "@/components/deen/qada-counter";
import { TravelingToggle } from "@/components/deen/traveling-toggle";

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

  const [{ data: prayerRows }, { data: adhkarRows }, { data: quranSessions }, { data: weeklyGoal }] =
    await Promise.all([
      supabase.from("prayers").select("prayer_name, status").eq("user_id", userId).eq("date", dateStr),
      supabase.from("adhkar_logs").select("period, completed").eq("user_id", userId).eq("date", dateStr),
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
  const { data: recentSessionDates } = await supabase
    .from("quran_sessions")
    .select("date")
    .eq("user_id", userId)
    .gte("date", localDateString(sixtyDaysAgo, timezone));

  const weekPagesRead = (quranSessions ?? []).reduce((sum, s) => sum + s.pages_read, 0);
  const latestSession = quranSessions?.[0] ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <section>
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

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Adhkar</h2>
        <AdhkarStrip
          date={dateStr}
          morningCompleted={adhkarRows?.find((a) => a.period === "morning")?.completed ?? false}
          eveningCompleted={adhkarRows?.find((a) => a.period === "evening")?.completed ?? false}
        />
      </section>

      <section>
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

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Qada backlog</h2>
        <QadaCounter owed={profile?.qada_owed ?? 0} />
      </section>

      <section>
        <TravelingToggle enabled={profile?.traveling_mode ?? false} />
      </section>
    </div>
  );
}
