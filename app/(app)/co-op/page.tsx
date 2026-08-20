import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom } from "@/lib/date-utils";
import { countScheduledThisWeek } from "@/lib/tasks/schedule-metrics";
import { addScheduleEvent, cancelScheduleOccurrence } from "./actions";
import { DomainScheduleView, type ScheduleEventData } from "@/components/shared/domain-schedule-view";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { TargetsStrip } from "@/components/co-op/targets-strip";
import { WeeklyAgenda } from "@/components/co-op/weekly-agenda";
import { PipelineBoard } from "@/components/co-op/pipeline-board";
import type { CoopTargetRow } from "@/lib/coop/targets";
import type { CoopTaskRow } from "@/lib/coop/tasks";

export default async function CoOpPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const weekDates = weekDatesFrom(weekStart);

  const [{ data: eventRows }, { data: targetRows }] = await Promise.all([
    supabase
      .from("schedule_events")
      .select("id, title, is_recurring, day_of_week, event_time, event_date, cancelled_on")
      .eq("user_id", userId)
      .eq("domain", "co_op"),
    supabase
      .from("coop_targets")
      .select("id, title, deadline, position")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("position", "is", null),
  ]);

  const targets: CoopTargetRow[] = (targetRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    deadline: t.deadline,
    position: t.position as number,
  }));
  const currentTarget = targets.find((t) => t.position === 1) ?? null;

  const { data: coopTaskRows } = currentTarget
    ? await supabase
        .from("coop_tasks")
        .select("id, title, deadline, status, blocked_from, created_at")
        .eq("user_id", userId)
        .eq("target_id", currentTarget.id)
    : { data: [] };

  const coopTasks: CoopTaskRow[] = (coopTaskRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    deadline: t.deadline,
    status: t.status as CoopTaskRow["status"],
    blockedFrom: t.blocked_from as CoopTaskRow["blockedFrom"],
    createdAt: t.created_at,
  }));

  const events: ScheduleEventData[] = (eventRows ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    isRecurring: e.is_recurring,
    dayOfWeek: e.day_of_week,
    eventTime: e.event_time,
    eventDate: e.event_date,
    cancelledOn: e.cancelled_on,
  }));

  const scheduledThisWeekCount = countScheduledThisWeek(events, weekDates);

  return (
    <PageContainer>
      <PageHeader title="Co-op" />

      <TargetsStrip rows={targets} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {currentTarget && (
          <Panel id="weekly-agenda" className="scroll-mt-20" title="Weekly Agenda" heroValue={`${coopTasks.length}`} caption={`for ${currentTarget.title}`}>
            <WeeklyAgenda targetId={currentTarget.id} tasks={coopTasks} />
          </Panel>
        )}
        <div className={currentTarget ? "" : "lg:col-span-2"}>
          <Panel
            title="Work schedule"
            heroValue={`${scheduledThisWeekCount}`}
            caption={scheduledThisWeekCount === 0 ? "Nothing scheduled this week" : "shifts this week"}
          >
            <DomainScheduleView
              events={events}
              weekDates={weekDates}
              addScheduleEvent={addScheduleEvent}
              cancelScheduleOccurrence={cancelScheduleOccurrence}
            />
          </Panel>
        </div>
      </div>

      {currentTarget && (
        <Panel title="Pipeline" caption={`${currentTarget.title} — Backlog through Complete`}>
          <PipelineBoard tasks={coopTasks} />
        </Panel>
      )}
    </PageContainer>
  );
}
