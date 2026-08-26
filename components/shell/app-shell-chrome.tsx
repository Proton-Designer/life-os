import { AppSidebar } from "./app-sidebar";
import { Topbar } from "./topbar";
import { MobileIsland } from "./mobile-island";
import { AllocationCheckinGate } from "@/components/checkin/allocation-checkin-gate";
import { CheckinToast } from "@/components/checkin/checkin-toast";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";
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
  // Unused until RealtimeSyncProvider is re-mounted — see the comment below.
  void userId;
  return (
    <AllocationQueueProvider>
      {/* RealtimeSyncProvider is deliberately NOT mounted yet (batch 2, item 2, 2026-08-26
          — see e2e/realtime-sync.spec.ts for the writeup). The mechanism reaches
          SUBSCRIBED with a correct filter and auth token, and an isolated Node
          client reliably receives postgres_changes events for the same table +
          filter, but the browser client intermittently receives nothing for a
          live write with no confirmed root cause. Mounting it would mean an
          unreliable sync layer on Ayman's phone, which is worse than the bug it
          fixes. `userId` is still threaded through so re-enabling this later is
          a one-line change. */}
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
