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
import { ActiveSessionPill } from "@/components/shell/active-session-pill";
import { SessionSetupDialogHost } from "@/components/business/session-setup-dialog-host";
import type { KillListSlotData } from "@/components/business/kill-list";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";
import { GlobalCaptureSheet } from "@/components/capture/global-capture-sheet";
import { buildCaptureAreaConfig } from "@/lib/capture/areas";
import type { ThemePresetId } from "@/lib/theme-presets";
import { ThemeRootSync } from "@/components/shell/theme-root-sync";
import { FocusRefresh } from "@/components/shell/focus-refresh";
import type { FeatureId } from "@/lib/features";

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
  onSaveDeen,
  onSaveBusiness,
  navMode,
  navDomainState,
  themePreset,
  hiddenFeatures,
  deenMode,
  windDownStart,
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
  /** IA-P4b: the user's wind-down start ("HH:MM") when Sleep plan is on and a plan is set; omitted = 21:00. A plain string. */
  windDownStart?: string;
  /** L10: which of app/globals.css's `[data-theme-preset]` accent blocks to
   * apply — see lib/theme-presets.ts. A plain string id, not a function, so
   * there's nothing here that trips AGENTS.md's Server->Client prop rule. */
  themePreset: ThemePresetId;
  /** L10: nav destinations this account has turned off (lib/features.ts) —
   * threaded into AppSidebar/MobileIsland only (legacy nav). The domains
   * -mode nav (TabAppSidebar/TabMobileIsland) is NOT wired to this yet — a
   * deliberate scope boundary, not an oversight: M6 already treats legacy
   * and domains nav as separately-maintained code paths, and Ayman's own
   * account (the one this feature is for) is legacy mode. */
  hiddenFeatures: FeatureId[];
  /** profiles.deen_mode (isDeenModeOn) -- boolean only; gates the capture sheet's Deen domain option. */
  deenMode: boolean;
  /** Seeds the app-wide LockInOverlayProvider below — a Lock-In session
   * started before this request must still show its overlay/minimized
   * state on first paint, not just after a client-side start. */
  activeWorkSession: ActiveWorkSession | null;
  /** Today's kill list, re-fetched every render (including the
   * RealtimeSyncProvider's router.refresh() on any kill_list_items change)
   * so the Deep Work overlay's row/column of checkable items never goes
   * stale relative to /business or Home. */
  killListSlots: [KillListSlotData, KillListSlotData, KillListSlotData];
  onSaveDeen: SaveGoalAction;
  onSaveBusiness: SaveGoalAction;
  children: React.ReactNode;
}) {
  return (
    // display:contents wrapper (no layout effect). THEME-01: the preset now lives on
    // <html> (ThemeRootScript sets it before paint, ThemeRootSync/applyThemePreset
    // keep it current) -- NOT on this div, because a closer ancestor attribute would
    // override the root one and stop instant switching from reaching the app.
    <div className="contents">
      <ThemeRootSync preset={themePreset} />
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
      <RealtimeSyncProvider userId={userId} deenMode={deenMode} />
      <FocusRefresh />
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
            <AppSidebar account={account} hiddenFeatures={hiddenFeatures} />
          )}
          <div className="flex min-h-screen min-w-0 flex-1 flex-col">
            <Topbar
              account={account}
              dateLabel={dateLabel}
              nowIso={nowIso}
              timezone={timezone}
              onSaveDeen={onSaveDeen}
              onSaveBusiness={onSaveBusiness}
              deenMode={deenMode}
              windDownStart={windDownStart}
            />
            <ActiveSessionPill />
            <main className="flex-1 pb-24 lg:pb-6">{children}</main>
          </div>
          {/* BOSS-VISION §5's Global capture — every screen. Mounted here (Boss brief,
              2026-09-02): after <main>, before the mobile island, inside both providers
              below, so it survives navigation the same way the island does. The trigger
              is positioned clear of the island's centered bottom bar; the actual sheet
              renders through Dialog's own portal + z-50 overlay (components/ui/dialog.tsx),
              so it is never under the island regardless of DOM position. */}
          <GlobalCaptureSheet timezone={timezone} deenMode={deenMode} areas={buildCaptureAreaConfig(navMode, navDomainState)} />
          {navMode === "domains" && navDomainState ? (
            <TabMobileIsland navDomainState={navDomainState} />
          ) : (
            <MobileIsland hiddenFeatures={hiddenFeatures} />
          )}
          <AllocationCheckinGate />
          <CheckinToast />
        </div>
        <LockInOverlay timezone={timezone} killListSlots={killListSlots} deenMode={deenMode} />
        {/* The pre-session goal/objectives prompt (146) — mounted once here,
            same reasoning as LockInOverlay above it: FocusModule's and
            LockInPanel's "Lock In" buttons call the context's
            startSession(kind), which now opens this rather than starting a
            session immediately, and both surfaces needed zero code changes
            for it. */}
        <SessionSetupDialogHost />
      </LockInOverlayProvider>
    </AllocationQueueProvider>
    </div>
  );
}
