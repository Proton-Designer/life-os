import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { localDateString, getWeekStartDate, weekDatesFrom } from "@/lib/date-utils";
import { addTask, toggleTask, removeTask, addScheduleEvent, cancelScheduleOccurrence } from "./actions";
import { TaskList, type TaskData } from "@/components/shared/task-list";
import { DomainScheduleView, type ScheduleEventData } from "@/components/shared/domain-schedule-view";

export default async function CoOpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  const weekDates = weekDatesFrom(weekStart);

  const [{ data: taskRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date, due_time, completed")
      .eq("user_id", userId)
      .eq("domain", "co_op")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("schedule_events")
      .select("id, title, is_recurring, day_of_week, event_time, event_date, cancelled_on")
      .eq("user_id", userId)
      .eq("domain", "co_op"),
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

  // Co-op stays permanently in the nav; when off-rotation it shows this
  // empty state rather than being hidden or relabeled, per spec.
  const hasNothing = tasks.length === 0 && events.length === 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      {hasNothing && (
        <p className="text-sm text-muted-foreground">No active co-op — nothing scheduled</p>
      )}

      <section>
        <h1 className="mb-4 text-lg font-semibold">Tasks</h1>
        <TaskList tasks={tasks} addTask={addTask} toggleTask={toggleTask} removeTask={removeTask} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Work schedule</h2>
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
