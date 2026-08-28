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
  // Overlapping these two here turned out to be inert (Opus Lead correction,
  // batch 5): app/(app)/layout.tsx — AppShell's own caller — already awaits
  // getProfile() before AppShell ever runs, so by the time this Promise.all
  // starts, getProfile() is a resolved cache() memo and this is just
  // `await getActiveWorkSession(...)` with extra steps. The real overlap
  // (both issued together, ~87ms saved) had to move up into layout.tsx,
  // where both round trips originate — see the comment there. Left as-is
  // rather than reverted: harmless, and correct if a future caller of
  // AppShell doesn't pre-fetch the profile the way this one does.
  const [profile, activeWorkSession] = await Promise.all([
    getProfile(),
    user ? getActiveWorkSession(user.id) : Promise.resolve(null),
  ]);
  const timezone = profile?.timezone ?? "UTC";

  const account = {
    displayName: profile?.display_name || user?.email?.split("@")[0] || "Account",
    email: user?.email ?? "",
  };

  const now = new Date();

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
