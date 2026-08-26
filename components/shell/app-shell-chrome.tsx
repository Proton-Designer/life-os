import { AppSidebar } from "./app-sidebar";
import { Topbar } from "./topbar";
import { MobileIsland } from "./mobile-island";
import { AllocationCheckinGate } from "@/components/checkin/allocation-checkin-gate";
import { CheckinToast } from "@/components/checkin/checkin-toast";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";
import { RealtimeSyncProvider } from "@/components/realtime/realtime-sync-provider";
import type { WeekCalendarData } from "@/components/calendar/week-calendar-view";

type SaveGoalAction = (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;

// The sync, fully client-testable half of the shell — AppShell (the server
// component) fetches account/session data and hands it here. Split out
// because an async Server Component can't be rendered directly through RTL
// in this project's jsdom-based test setup (same reason page.tsx files
// aren't unit-tested — see e2e/ for their coverage instead).
export function AppShellChrome({
  account,
  userId,
  dateLabel,
  nowIso,
  timezone,
  getWeekCalendar,
  onSaveDeen,
  onSaveBusiness,
  children,
}: {
  account: { displayName: string; email: string };
  /** Server-derived (app-shell.tsx's own getAuthedUser()) — never re-fetched client-side. Null only when unauthenticated, which shouldn't reach this shell at all (the layout redirects first), but keeps the prop honest rather than asserting non-null. */
  userId: string | null;
  dateLabel: string;
  nowIso: string;
  timezone: string;
  getWeekCalendar: () => Promise<WeekCalendarData>;
  onSaveDeen: SaveGoalAction;
  onSaveBusiness: SaveGoalAction;
  children: React.ReactNode;
}) {
  return (
    <AllocationQueueProvider>
      {/* Re-mounted 2026-08-26 (batch 2 afternoon): root cause found and
          fixed — see components/realtime/realtime-sync-provider.tsx's own
          comment and e2e/realtime-sync.spec.ts's history. The old
          intermittent-silence bug was a session-restore race: subscribing
          before createBrowserClient's async cookie session restore
          resolves joins the channel under the anon role forever (RLS then
          matches zero rows, but the channel still reports SUBSCRIBED).
          The provider now awaits the session and sets realtime auth
          itself before ever building the channel. */}
      <RealtimeSyncProvider userId={userId} />
      <div className="lg:flex lg:min-h-screen">
        <AppSidebar account={account} />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Topbar
            account={account}
            dateLabel={dateLabel}
            nowIso={nowIso}
            timezone={timezone}
            getWeekCalendar={getWeekCalendar}
            onSaveDeen={onSaveDeen}
            onSaveBusiness={onSaveBusiness}
          />
          <main className="flex-1 pb-24 lg:pb-6">{children}</main>
        </div>
        <MobileIsland />
        <AllocationCheckinGate />
        <CheckinToast />
      </div>
    </AllocationQueueProvider>
  );
}
