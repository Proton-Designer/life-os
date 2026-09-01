import Link from "next/link";
import { TabSidebarNav } from "./tab-sidebar-nav";
import { AccountBlock } from "./account-block";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";

// Same chrome as the legacy AppSidebar (kept byte-for-byte untouched for
// mode:"legacy" accounts) — this variant swaps in TabSidebarNav so the M4
// four-tab structure gets the exact same desktop shell polish, not a
// second visual language.
const OXBLOOD_WASH: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to bottom, color-mix(in oklch, var(--glow-oxblood) 35%, transparent) 0%, transparent 40%)",
};

function Logo({ iconOnly }: { iconOnly: boolean }) {
  return (
    <Link href="/" prefetch className="flex h-16 shrink-0 items-center border-b border-border px-3 text-sm font-semibold tracking-tight">
      <span aria-hidden className="text-lg">
        &#9670;
      </span>
      {!iconOnly && <span className="ml-2">Life OS</span>}
      <span className="sr-only">Life OS</span>
    </Link>
  );
}

export function TabAppSidebar({
  account,
  navDomainState,
}: {
  account: { displayName: string; email: string };
  navDomainState: NavDomainState;
}) {
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col border-r border-border bg-sidebar lg:flex xl:hidden" style={OXBLOOD_WASH}>
        <Logo iconOnly />
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <TabSidebarNav variant="icon-rail" navDomainState={navDomainState} />
        </div>
        <div className="border-t border-border p-2">
          <AccountBlock displayName={account.displayName} email={account.email} variant="icon-rail" />
        </div>
      </aside>

      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-border bg-sidebar xl:flex" style={OXBLOOD_WASH}>
        <Logo iconOnly={false} />
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <TabSidebarNav variant="expanded" navDomainState={navDomainState} />
        </div>
        <div className="border-t border-border p-2">
          <AccountBlock displayName={account.displayName} email={account.email} variant="expanded" />
        </div>
      </aside>
    </>
  );
}
