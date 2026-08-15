import { TopNav } from "./top-nav";
import { MobileIsland } from "./mobile-island";

// The app-wide 2-hour check-in scheduler (CheckinSchedulerLoader) is gone
// entirely as of the Business Lock-In overhaul — check-in prompts are now
// scoped to an active Lock-In work session (components/business/lock-in-session.tsx)
// instead of firing globally. checkin-scheduler.tsx/checkin-scheduler-loader.tsx
// are left in place, just unreferenced here, matching the "remove for now"
// pattern used elsewhere in this overhaul (adhkar/traveling).
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <main className="pt-0 pb-24 md:pt-14 md:pb-0">{children}</main>
      <MobileIsland />
    </>
  );
}
