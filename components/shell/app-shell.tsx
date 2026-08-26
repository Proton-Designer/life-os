import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { formatTopbarDate } from "@/lib/date-utils";
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

  return (
    <AppShellChrome
      account={account}
      userId={user?.id ?? null}
      dateLabel={formatTopbarDate(now, timezone)}
      nowIso={now.toISOString()}
      timezone={timezone}
      getWeekCalendar={getWeekCalendar}
      onSaveDeen={onSaveDeen}
      onSaveBusiness={onSaveBusiness}
    >
      {children}
    </AppShellChrome>
  );
}
