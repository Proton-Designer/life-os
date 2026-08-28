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
  // getProfile and getActiveWorkSession each cost one real Supabase round
  // trip and neither depends on the other (both need only the userId, and
  // getAuthedUser is a local JWT verify with no network hop) — this pair
  // was serialized for no reason, and unlike a page-level waterfall this
  // one is paid on EVERY navigation, since AppShell renders on every route
  // (Opus Lead, batch 5). Both are cache()'d (lib/supabase/auth.ts,
  // lib/business/active-session.ts) so other call sites later in the same
  // render (Home's Focus module, Business's page) still hit the memo —
  // this doesn't add a query, it overlaps two that already run.
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
