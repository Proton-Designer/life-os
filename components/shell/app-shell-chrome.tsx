import { AppSidebar } from "./app-sidebar";
import { Topbar } from "./topbar";
import { MobileIsland } from "./mobile-island";
import { AllocationCheckinGate } from "@/components/checkin/allocation-checkin-gate";

// The sync, fully client-testable half of the shell — AppShell (the server
// component) fetches account/session data and hands it here. Split out
// because an async Server Component can't be rendered directly through RTL
// in this project's jsdom-based test setup (same reason page.tsx files
// aren't unit-tested — see e2e/ for their coverage instead).
export function AppShellChrome({
  account,
  dateLabel,
  hasActiveLockIn,
  children,
}: {
  account: { displayName: string; email: string };
  dateLabel: string;
  hasActiveLockIn: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="lg:flex lg:min-h-screen">
      <AppSidebar account={account} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Topbar account={account} dateLabel={dateLabel} hasActiveLockIn={hasActiveLockIn} />
        <main className="flex-1 pb-24 lg:pb-6">{children}</main>
      </div>
      <MobileIsland />
      <AllocationCheckinGate />
    </div>
  );
}
