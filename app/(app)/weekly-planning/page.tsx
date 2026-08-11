import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { getWeeklySignalNoiseRatio } from "@/lib/business/sn-ratio";
import { GoalCard } from "@/components/shared/goal-card";
import { saveWeeklyGoal } from "./actions";

export default async function WeeklyPlanningPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const timezone = profile?.timezone ?? "UTC";
  const currentWeekStart = getWeekStartDate(localDateString(now, timezone));
  const previousWeekStart = addDaysToDateString(currentWeekStart, -7);

  const [
    { data: currentGoals },
    { data: previousGoals },
    { data: prayerRows },
    { data: adhkarRows },
    { data: quranRows },
    snRatio,
  ] = await Promise.all([
    supabase.from("weekly_goals").select("*").eq("user_id", userId).eq("week_start_date", currentWeekStart),
    supabase.from("weekly_goals").select("*").eq("user_id", userId).eq("week_start_date", previousWeekStart),
    supabase
      .from("prayers")
      .select("status")
      .eq("user_id", userId)
      .gte("date", previousWeekStart)
      .lt("date", currentWeekStart),
    supabase
      .from("adhkar_logs")
      .select("completed")
      .eq("user_id", userId)
      .gte("date", previousWeekStart)
      .lt("date", currentWeekStart),
    supabase
      .from("quran_sessions")
      .select("pages_read")
      .eq("user_id", userId)
      .gte("date", previousWeekStart)
      .lt("date", currentWeekStart),
    getWeeklySignalNoiseRatio(userId, new Date(`${previousWeekStart}T00:00:00Z`)),
  ]);

  const currentDeen = currentGoals?.find((g) => g.domain === "deen") ?? null;
  const currentBusiness = currentGoals?.find((g) => g.domain === "business") ?? null;
  const previousDeen = previousGoals?.find((g) => g.domain === "deen") ?? null;
  const previousBusiness = previousGoals?.find((g) => g.domain === "business") ?? null;

  const isFirstWeek = !previousDeen && !previousBusiness;

  const prayersOnTime = prayerRows?.filter((p) => p.status === "on_time" || p.status === "qada").length ?? 0;
  const prayersTotal = 35; // 5 prayers x 7 days
  const adhkarDone = adhkarRows?.filter((a) => a.completed).length ?? 0;
  const adhkarTotal = 14; // 2 x 7 days
  const quranPages = (quranRows ?? []).reduce((sum, r) => sum + r.pages_read, 0);

  // Carry-forward: if this week hasn't been set yet but last week's has a
  // goal, pre-fill this week's form with last week's headline as an
  // editable draft rather than leaving it blank, per spec.
  const deenSource = currentDeen ?? previousDeen;
  const deenDraft = {
    headline: deenSource?.headline ?? "",
    milestones: ((deenSource?.milestones as string[] | null) ?? []) as string[],
    quran_page_target: deenSource?.quran_page_target ?? null,
    locked: currentDeen?.locked ?? false,
  };
  const businessSource = currentBusiness ?? previousBusiness;
  const businessDraft = {
    headline: businessSource?.headline ?? "",
    milestones: ((businessSource?.milestones as string[] | null) ?? []) as string[],
    locked: currentBusiness?.locked ?? false,
  };

  async function saveDeenGoal(headline: string, milestones: string[], quranPageTarget?: number) {
    "use server";
    await saveWeeklyGoal("deen", headline, milestones, quranPageTarget);
  }
  async function saveBusinessGoal(headline: string, milestones: string[]) {
    "use server";
    await saveWeeklyGoal("business", headline, milestones);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <section>
        <h1 className="mb-4 text-lg font-semibold">Last week</h1>
        {isFirstWeek ? (
          <p className="text-sm text-muted-foreground">No history yet — this is your first week.</p>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-4 text-sm">
            <p>
              Deen: {prayersOnTime}/{prayersTotal} prayers on time · {adhkarDone}/{adhkarTotal} adhkar ·{" "}
              {quranPages} Qur&apos;an pages
              {previousDeen?.quran_page_target ? ` (target: ${previousDeen.quran_page_target})` : ""}
            </p>
            <p>Business: {snRatio.display} Signal:Noise</p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">This week&apos;s goals</h2>
        <GoalCard
          title="Deen"
          headline={deenDraft.headline}
          milestones={deenDraft.milestones}
          quranPageTarget={deenDraft.quran_page_target}
          showQuranTarget
          locked={deenDraft.locked}
          onSave={saveDeenGoal}
        />
        <GoalCard
          title="Business"
          headline={businessDraft.headline}
          milestones={businessDraft.milestones}
          locked={businessDraft.locked}
          onSave={saveBusinessGoal}
        />
      </section>
    </div>
  );
}
