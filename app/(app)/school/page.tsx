import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom } from "@/lib/date-utils";
import { addTask, toggleTask, removeTask, addScheduleEvent, cancelScheduleOccurrence } from "./actions";
import { TaskList, type TaskData } from "@/components/shared/task-list";
import { DomainScheduleView, type ScheduleEventData } from "@/components/shared/domain-schedule-view";
import { IconChip } from "@/components/ui/icon-chip";
import { StatCard } from "@/components/ui/stat-card";
import { DOMAIN_ICON } from "@/lib/domain-icons";

export default async function SchoolPage() {
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

  const [{ data: taskRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date, due_time, completed")
      .eq("user_id", userId)
      .eq("domain", "school")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("schedule_events")
      .select("id, title, is_recurring, day_of_week, event_time, event_date, cancelled_on")
      .eq("user_id", userId)
      .eq("domain", "school"),
  ]);

  const tasks: TaskData[] = (taskRows ?? [])
    .filter((t) => !t.completed)
    .map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, dueTime: t.due_time, completed: t.completed }));

  const events: ScheduleEventData[] = (eventRows ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    isRecurring: e.is_recurring,
    dayOfWeek: e.day_of_week,
    eventTime: e.event_time,
    eventDate: e.event_date,
    cancelledOn: e.cancelled_on,
  }));

  const dueTodayCount = tasks.filter((t) => t.dueDate === dateStr).length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <section className="flex flex-col gap-4">
        <h1 className="flex items-center gap-2.5 text-lg font-semibold">
          <IconChip icon={DOMAIN_ICON.school} accent="school" size="sm" />
          Tasks
        </h1>
        <StatCard icon={DOMAIN_ICON.school} accent="school" label="Due today" value={String(dueTodayCount)} />
        <TaskList tasks={tasks} addTask={addTask} toggleTask={toggleTask} removeTask={removeTask} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-muted-foreground">
          <IconChip icon={DOMAIN_ICON.school} accent="school" size="sm" />
          Class schedule
        </h2>
        <DomainScheduleView
          events={events}
          weekDates={weekDates}
          addScheduleEvent={addScheduleEvent}
          cancelScheduleOccurrence={cancelScheduleOccurrence}
        />
      </section>
    </div>
  );
}
