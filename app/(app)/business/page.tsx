import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { getWeeklySignalNoiseRatio } from "@/lib/business/sn-ratio";
import { KillList, type KillListSlotData } from "@/components/business/kill-list";
import { WeeklyGoalCard } from "@/components/business/weekly-goal-card";
import { SnRatioCard } from "@/components/business/sn-ratio-card";
import { LockInPanel, type ActiveSessionData } from "@/components/business/lock-in-panel";
import { IconChip } from "@/components/ui/icon-chip";
import { DOMAIN_ICON } from "@/lib/domain-icons";

export default async function BusinessPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);

  const [{ data: killListRows }, { data: weeklyGoal }, snRatio, { data: activeSessionRow }] =
    await Promise.all([
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
      supabase
        .from("work_sessions")
        .select("id, started_at")
        .eq("user_id", userId)
        .is("ended_at", null)
        .maybeSingle(),
    ]);

  const slots: [KillListSlotData, KillListSlotData, KillListSlotData] = [0, 1, 2].map((position) => {
    const row = killListRows?.find((r) => r.position === position);
    return { id: row?.id ?? null, text: row?.text ?? "", completed: row?.completed ?? false };
  }) as [KillListSlotData, KillListSlotData, KillListSlotData];

  let activeSession: ActiveSessionData | null = null;
  if (activeSessionRow) {
    const { data: sessionCheckins } = await supabase
      .from("checkins")
      .select("checkin_time, tag_type, tag_label, answered")
      .eq("user_id", userId)
      .eq("work_session_id", activeSessionRow.id)
      .order("checkin_time", { ascending: true });
    activeSession = {
      id: activeSessionRow.id,
      startedAtIso: activeSessionRow.started_at,
      checkins: (sessionCheckins ?? []).map((c) => ({
        checkinTime: c.checkin_time,
        tagType: c.tag_type,
        tagLabel: c.tag_label,
        answered: c.answered,
      })),
    };
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <section>
        <h1 className="mb-4 flex items-center gap-2.5 text-lg font-semibold">
          <IconChip icon={DOMAIN_ICON.business} accent="business" size="sm" />
          Lock In
        </h1>
        <LockInPanel initialSession={activeSession} />
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2.5 text-lg font-semibold">
          <IconChip icon={DOMAIN_ICON.business} accent="business" size="sm" />
          Today&apos;s kill list
        </h2>
        <KillList date={dateStr} slots={slots} />
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-muted-foreground">
          <IconChip icon={DOMAIN_ICON.business} accent="business" size="sm" />
          This week&apos;s goal
        </h2>
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
