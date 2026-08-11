import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { getWeeklySignalNoiseRatio } from "@/lib/business/sn-ratio";
import { KillList, type KillListSlotData } from "@/components/business/kill-list";
import { WeeklyGoalCard } from "@/components/business/weekly-goal-card";
import { SnRatioCard } from "@/components/business/sn-ratio-card";

export default async function BusinessPage() {
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
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);

  const [{ data: killListRows }, { data: weeklyGoal }, snRatio] = await Promise.all([
    supabase
      .from("kill_list_items")
      .select("id, position, text, completed")
      .eq("user_id", userId)
      .eq("date", dateStr)
      .order("position", { ascending: true }),
    supabase
      .from("weekly_goals")
      .select("headline, milestones")
      .eq("user_id", userId)
      .eq("domain", "business")
      .eq("week_start_date", weekStart)
      .maybeSingle(),
    getWeeklySignalNoiseRatio(userId, new Date(`${weekStart}T00:00:00Z`)),
  ]);

  const slots: [KillListSlotData, KillListSlotData, KillListSlotData] = [0, 1, 2].map((position) => {
    const row = killListRows?.find((r) => r.position === position);
    return { id: row?.id ?? null, text: row?.text ?? "", completed: row?.completed ?? false };
  }) as [KillListSlotData, KillListSlotData, KillListSlotData];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <section>
        <h1 className="mb-4 text-lg font-semibold">Today&apos;s kill list</h1>
        <KillList date={dateStr} slots={slots} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">This week&apos;s goal</h2>
        <WeeklyGoalCard
          weekStartDate={weekStart}
          headline={weeklyGoal?.headline ?? ""}
          milestones={(weeklyGoal?.milestones as string[] | null) ?? []}
        />
      </section>

      <SnRatioCard display={snRatio.display} />
    </div>
  );
}
