import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { formatTopbarDate } from "@/lib/date-utils";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { AppShellChrome } from "./app-shell-chrome";
import type { WeekCalendarData } from "@/components/calendar/week-calendar-view";

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
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";

  const account = {
    displayName: profile?.display_name || user?.email?.split("@")[0] || "Account",
    email: user?.email ?? "",
  };

  const now = new Date();
  // getActiveWorkSession is request-scoped cache()'d — Home's Focus module
  // and the Business page each call it too, so this adds no extra round
  // trip. Feeds the app-wide LockInOverlayProvider (see app-shell-chrome.tsx)
  // so a Lock-In session survives navigation instead of unmounting the
  // moment its owning page's component tree does.
  const activeWorkSession = user ? await getActiveWorkSession(user.id) : null;

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
      getWeekCalendar={getWeekCalendar}
      onSaveDeen={onSaveDeen}
      onSaveBusiness={onSaveBusiness}
    >
      {children}
    </AppShellChrome>
  );
}
