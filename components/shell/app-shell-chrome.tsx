import { AppSidebar } from "./app-sidebar";
import { TabAppSidebar } from "./tab-app-sidebar";
import { Topbar } from "./topbar";
import { MobileIsland } from "./mobile-island";
import { TabMobileIsland } from "./tab-mobile-island";
import { AllocationCheckinGate } from "@/components/checkin/allocation-checkin-gate";
import { CheckinToast } from "@/components/checkin/checkin-toast";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";
import { RealtimeSyncProvider } from "@/components/realtime/realtime-sync-provider";
import { LockInOverlayProvider, type ActiveWorkSession } from "@/components/business/lock-in-overlay-context";
import { LockInOverlay } from "@/components/business/lock-in-overlay";
import type { WeekCalendarData } from "@/components/calendar/week-calendar-view";
import type { KillListSlotData } from "@/components/business/kill-list";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";

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
  activeWorkSession,
  killListSlots,
  getWeekCalendar,
  onSaveDeen,
  onSaveBusiness,
  navMode,
  navDomainState,
  children,
}: {
  account: { displayName: string; email: string };
  /** Server-derived (app-shell.tsx's own getAuthedUser()) — never re-fetched client-side. Null only when unauthenticated, which shouldn't reach this shell at all (the layout redirects first), but keeps the prop honest rather than asserting non-null. */
  userId: string | null;
  dateLabel: string;
  nowIso: string;
  timezone: string;
  /** M6 failsafe branch: "legacy" renders the exact existing AppSidebar/
   * MobileIsland (unchanged code path — an account that predates domain
   * selection never reaches the new nav). "domains" renders the four-tab
   * nav built from navDomainState, which is non-null iff navMode is
   * "domains". */
  navMode: "legacy" | "domains";
  navDomainState: NavDomainState | null;
  /** Seeds the app-wide LockInOverlayProvider below — a Lock-In session
   * started before this request must still show its overlay/minimized
   * state on first paint, not just after a client-side start. */
  activeWorkSession: ActiveWorkSession | null;
  /** Today's kill list, re-fetched every render (including the
   * RealtimeSyncProvider's router.refresh() on any kill_list_items change)
   * so the Deep Work overlay's row/column of checkable items never goes
   * stale relative to /business or Home. */
  killListSlots: [KillListSlotData, KillListSlotData, KillListSlotData];
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
      {/* Wraps the whole shell, not just Business/Home — a session started
          on /business must still show its minimized row (and be endable)
          from the Home Focus module, and vice versa. Mounted once here so
          it survives navigation instead of unmounting with whichever page
          rendered it (batch 3, full-screen Lock-In overlay). */}
      <LockInOverlayProvider initialSession={activeWorkSession}>
        <div className="lg:flex lg:min-h-screen">
          {navMode === "domains" && navDomainState ? (
            <TabAppSidebar account={account} navDomainState={navDomainState} />
          ) : (
            <AppSidebar account={account} />
          )}
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
          {navMode === "domains" && navDomainState ? (
            <TabMobileIsland navDomainState={navDomainState} />
          ) : (
            <MobileIsland />
          )}
          <AllocationCheckinGate />
          <CheckinToast />
        </div>
        <LockInOverlay timezone={timezone} killListSlots={killListSlots} />
      </LockInOverlayProvider>
    </AllocationQueueProvider>
  );
}
