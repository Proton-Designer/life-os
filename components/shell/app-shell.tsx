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
  // getProfile() alone: app/(app)/layout.tsx, AppShell's own caller, already
  // awaits it before AppShell ever runs, so this is a resolved cache() memo
  // by the time it's called here — free, unlike the kill-list query below.
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const now = new Date();
  const dateStr = localDateString(now, timezone);

  // getActiveWorkSession is ALSO a warm memo (the layout's own Promise.all
  // already resolved it) — awaiting it alone here is free. getKillListSlots
  // is not: it's a live query, gated behind it deliberately (Opus Lead
  // correction, 2026-08-28) so it only runs on the one navigation shape
  // that actually needs it — the Deep Work overlay showing a running
  // session. Everything else (every other route, an idle Business page, a
  // Deep Study session) pays zero extra round trips; /business itself is
  // unaffected since it reads getKillListSlots directly, independent of
  // this gate.
  const activeWorkSession = user ? await getActiveWorkSession(user.id) : null;
  const killListSlots =
    user && activeWorkSession?.kind === "deep_work"
      ? await getKillListSlots(user.id, dateStr)
      : EMPTY_KILL_LIST_SLOTS;

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
