"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { WeekCalendarView, type WeekCalendarData } from "@/components/calendar/week-calendar-view";

type SaveGoalAction = (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;

/**
 * The topbar's calendar button, converted from a `<Link href="/calendar">`
 * (a full server navigation — Ayman: "it takes like 2 seconds to load up a
 * new screen") into an instant popup. `getWeekCalendar` is fetched on FIRST
 * OPEN only and cached in state for the life of this mount — never
 * prefetched from the layout, which would tax every page render for a
 * dialog most renders never open (spec item C).
 *
 * `getWeekCalendar`/`onSaveDeen`/`onSaveBusiness` are Server Action
 * references (the first unbound, the latter two `.bind(null, domain)`)
 * threaded down from app/(app)/layout.tsx through AppShell/AppShellChrome/
 * Topbar — passed through unchanged at every layer, never rewrapped in a
 * plain arrow function crossing a Server→Client boundary (AGENTS.md).
 */
export function CalendarDialogTrigger({
  getWeekCalendar,
  onSaveDeen,
  onSaveBusiness,
}: {
  getWeekCalendar: () => Promise<WeekCalendarData>;
  onSaveDeen: SaveGoalAction;
  onSaveBusiness: SaveGoalAction;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WeekCalendarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      setData(await getWeekCalendar());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !data && !loading) void load();
  }

  // `data` is a plain useState snapshot fetched once on open — a server
  // revalidatePath() from saveWeeklyGoal doesn't reach into it. These
  // wrappers MUST `await load()` before returning: GoalSlot's own onSave
  // handler only calls `setOpen(false)` (closing the nested goal-edit
  // dialog) after this promise resolves, so the refetch completes and
  // `data` is fresh before the user ever sees the inner dialog close.
  // Making this fire-and-forget (dropping the `await` or returning early)
  // reintroduces a real bug: the calendar popup behind the closed dialog
  // would keep showing the pre-edit headline until closed and reopened.
  async function handleSaveDeen(headline: string, milestones: string[], quranPageTarget?: number) {
    await onSaveDeen(headline, milestones, quranPageTarget);
    await load();
  }

  async function handleSaveBusiness(headline: string, milestones: string[], quranPageTarget?: number) {
    await onSaveBusiness(headline, milestones, quranPageTarget);
    await load();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Open calendar"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <CalendarDays className="size-5" />
        </button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-y-auto sm:max-w-4xl"
        aria-describedby={undefined}
      >
        <DialogTitle>This week</DialogTitle>
        {loading && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
        {!loading && loadError && (
          <p className="py-12 text-center text-sm text-muted-foreground">Couldn&apos;t load your calendar. Try again.</p>
        )}
        {!loading && !loadError && data && (
          <WeekCalendarView
            data={data}
            todayDayOfWeek={new Date().getDay()}
            onSaveDeen={handleSaveDeen}
            onSaveBusiness={handleSaveBusiness}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
