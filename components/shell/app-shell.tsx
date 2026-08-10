import { TopNav } from "./top-nav";
import { MobileIsland } from "./mobile-island";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <main className="pt-0 pb-24 md:pt-14 md:pb-0">{children}</main>
      <MobileIsland />
    </>
  );
}
