import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { formatTopbarDate, localDateString } from "@/lib/date-utils";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { getKillListSlots } from "@/lib/business/kill-list-slots";
import { AppShellChrome } from "./app-shell-chrome";
import type { WeekCalendarData } from "@/components/calendar/week-calendar-view";
import type { KillListSlotData } from "@/components/business/kill-list";

const EMPTY_KILL_LIST_SLOTS: [KillListSlotData, KillListSlotData, KillListSlotData] = [
  { id: null, text: "", completed: false },
  { id: null, text: "", completed: false },
  { id: null, text: "", completed: false },
];

type SaveGoalAction = (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;

export async function AppShell({
  children,
  getWeekCalendar,
  onSaveDeen,
  onSaveBusiness,
}: {
  children: React.ReactNode;
  getWeekCalendar: () => Promise<WeekCalendarData>;
  onSaveDeen: SaveGoalAction;
  onSaveBusiness: SaveGoalAction;
}) {
  const user = await getAuthedUser();
  // getProfile() alone, not folded into the Promise.all below: it needs to
  // resolve first so timezone is known before computing today's local date
  // for the kill-list query. Per the Opus Lead's batch 5 correction, this
  // costs nothing over the old overlapped version anyway — app/(app)/layout.tsx,
  // AppShell's own caller, already awaits getProfile() before AppShell ever
  // runs, so this is a resolved cache() memo by the time it's called here.
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const now = new Date();
  const dateStr = localDateString(now, timezone);

  const [activeWorkSession, killListSlots] = await Promise.all([
    user ? getActiveWorkSession(user.id) : Promise.resolve(null),
    user ? getKillListSlots(user.id, dateStr) : Promise.resolve(EMPTY_KILL_LIST_SLOTS),
  ]);

  const account = {
    displayName: profile?.display_name || user?.email?.split("@")[0] || "Account",
    email: user?.email ?? "",
  };

  return (
    <AppShellChrome
      account={account}
      userId={user?.id ?? null}
      dateLabel={formatTopbarDate(now, timezone)}
      nowIso={now.toISOString()}
      timezone={timezone}
      activeWorkSession={
        activeWorkSession
          ? { id: activeWorkSession.id, startedAtIso: activeWorkSession.startedAt, kind: activeWorkSession.kind }
          : null
      }
      killListSlots={killListSlots}
      getWeekCalendar={getWeekCalendar}
      onSaveDeen={onSaveDeen}
      onSaveBusiness={onSaveBusiness}
    >
      {children}
    </AppShellChrome>
  );
}
