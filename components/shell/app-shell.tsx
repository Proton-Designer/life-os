import { Suspense } from "react";
import { TopNav } from "./top-nav";
import { MobileIsland } from "./mobile-island";
import { FocusRefresh } from "./focus-refresh";
import { CheckinSchedulerLoader } from "@/components/checkin/checkin-scheduler-loader";

// Deliberately NOT async, and nothing here is awaited: TopNav/MobileIsland/
// children need none of the check-in data, so they must not be blocked by
// it. The check-in fetch lives in its own async component behind a
// Suspense boundary instead — see checkin-scheduler-loader.tsx.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <main className="pt-0 pb-24 md:pt-14 md:pb-0">{children}</main>
      <MobileIsland />
      <FocusRefresh />
      <Suspense fallback={null}>
        <CheckinSchedulerLoader />
      </Suspense>
    </>
  );
}
