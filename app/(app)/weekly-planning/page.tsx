import { redirect } from "next/navigation";
import { Flame, Sparkles, BookOpen, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { bucketSignalNoiseByWeek, type WeekBoundary } from "@/lib/business/sn-trend";
import { buildWeeklyRecap, type WeekWindow } from "@/lib/weekly-planning/weekly-recap";
import { GoalCard } from "@/components/shared/goal-card";
import { saveWeeklyGoal } from "./actions";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";
import { BarChart } from "@/components/charts/bar-chart";

const RECAP_WEEK_COUNT = 6;

export default async function WeeklyPlanningPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const currentWeekStart = getWeekStartDate(localDateString(now, timezone));
  const previousWeekStart = addDaysToDateString(currentWeekStart, -7);

  const recapWeekStarts = Array.from({ length: RECAP_WEEK_COUNT }, (_, i) =>
    addDaysToDateString(previousWeekStart, -7 * (RECAP_WEEK_COUNT - 1 - i))
  );
  const recapWeeks: WeekWindow[] = recapWeekStarts.map((ws) => ({
    weekStart: ws,
    label: new Date(`${ws}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  }));
  const snWeeks: WeekBoundary[] = recapWeekStarts.map((ws, i) => ({
    weekStartIso: `${ws}T00:00:00.000Z`,
    weekEndIso: `${addDaysToDateString(ws, 7)}T00:00:00.000Z`,
    label: recapWeeks[i].label,
  }));
  const earliestWeekStart = recapWeekStarts[0];

  const [
    { data: currentGoals },
    { data: previousGoals },
    { data: prayerRows },
    { data: adhkarRows },
    { data: quranRows },
    { data: checkinRows },
  ] = await Promise.all([
    supabase.from("weekly_goals").select("*").eq("user_id", userId).eq("week_start_date", currentWeekStart),
    supabase.from("weekly_goals").select("*").eq("user_id", userId).eq("week_start_date", previousWeekStart),
    // One bulk range per table across the whole recap window — sliced into
    // per-week buckets in memory, never a per-week query loop.
    supabase.from("prayers").select("date, status").eq("user_id", userId).gte("date", earliestWeekStart).lt("date", currentWeekStart),
    supabase.from("adhkar_logs").select("date, completed").eq("user_id", userId).gte("date", earliestWeekStart).lt("date", currentWeekStart),
    supabase.from("quran_sessions").select("date, pages_read").eq("user_id", userId).gte("date", earliestWeekStart).lt("date", currentWeekStart),
    supabase.from("checkins").select("checkin_time, tag_type, answered").eq("user_id", userId).gte("checkin_time", snWeeks[0].weekStartIso),
  ]);

  const currentDeen = currentGoals?.find((g) => g.domain === "deen") ?? null;
  const currentBusiness = currentGoals?.find((g) => g.domain === "business") ?? null;
  const previousDeen = previousGoals?.find((g) => g.domain === "deen") ?? null;
  const previousBusiness = previousGoals?.find((g) => g.domain === "business") ?? null;

  const recap = buildWeeklyRecap(prayerRows ?? [], adhkarRows ?? [], quranRows ?? [], recapWeeks);
  const snByWeek = bucketSignalNoiseByWeek(checkinRows ?? [], snWeeks);
  const snBars = snByWeek.map((w) => ({
    label: w.label,
    value: w.noise === 0 ? w.signal : Math.round((w.signal / w.noise) * 10) / 10,
  }));

  const lastWeekRecap = recap[recap.length - 1];
  const priorWeekRecap = recap[recap.length - 2];
  const lastWeekSn = snByWeek[snByWeek.length - 1];

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
    <PageContainer>
      <PageHeader title="Weekly Planning" />

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-4">
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Flame}
            accent="deen"
            label="Prayers on time"
            value={`${lastWeekRecap.prayersOnTime}/35`}
            caption="last week"
            sparkline={recap.map((r) => r.prayersOnTime)}
            delta={
              priorWeekRecap
                ? {
                    direction: lastWeekRecap.prayersOnTime >= priorWeekRecap.prayersOnTime ? "up" : "down",
                    text: `${lastWeekRecap.prayersOnTime - priorWeekRecap.prayersOnTime >= 0 ? "+" : ""}${lastWeekRecap.prayersOnTime - priorWeekRecap.prayersOnTime}`,
                  }
                : undefined
            }
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Sparkles}
            accent="deen"
            label="Adhkar"
            value={`${lastWeekRecap.adhkarDone}/14`}
            caption="last week"
            sparkline={recap.map((r) => r.adhkarDone)}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={BookOpen}
            accent="deen"
            label="Qur'an pages"
            value={`${lastWeekRecap.quranPages}`}
            caption={previousDeen?.quran_page_target ? `target: ${previousDeen.quran_page_target}` : "last week"}
            sparkline={recap.map((r) => r.quranPages)}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Target}
            accent="business"
            label="Signal:Noise"
            // computeRatioDisplay returns the literal string "No data" when
            // there were zero answered check-ins — a KpiCard hero value must
            // never render that banned string (Phase B's card taxonomy),
            // same fix as the Business S:N panel in the Phase E follow-up.
            value={lastWeekSn.signal + lastWeekSn.noise === 0 ? "—" : lastWeekSn.display}
            caption={lastWeekSn.signal + lastWeekSn.noise === 0 ? "No check-ins last week" : "last week"}
            sparkline={snBars.map((b) => b.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <GoalCard
            title="Deen"
            domain="deen"
            headline={deenDraft.headline}
            milestones={deenDraft.milestones}
            quranPageTarget={deenDraft.quran_page_target}
            showQuranTarget
            locked={deenDraft.locked}
            onSave={saveDeenGoal}
          />
        </div>
        <div className="lg:col-span-6">
          <GoalCard
            title="Business"
            domain="business"
            headline={businessDraft.headline}
            milestones={businessDraft.milestones}
            locked={businessDraft.locked}
            onSave={saveBusinessGoal}
          />
        </div>
      </div>

      <Panel title="Week over week">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">Prayers on time</p>
            <BarChart bars={recap.map((r) => ({ label: r.label, value: r.prayersOnTime }))} colorVar="--series-deen" highlightIndex={recap.length - 1} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">Adhkar</p>
            <BarChart bars={recap.map((r) => ({ label: r.label, value: r.adhkarDone }))} colorVar="--series-deen" highlightIndex={recap.length - 1} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">Qur&apos;an pages</p>
            <BarChart bars={recap.map((r) => ({ label: r.label, value: r.quranPages }))} colorVar="--series-deen" highlightIndex={recap.length - 1} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">Signal:Noise</p>
            <BarChart bars={snBars} colorVar="--series-business" highlightIndex={snBars.length - 1} />
          </div>
        </div>
      </Panel>
    </PageContainer>
  );
}
