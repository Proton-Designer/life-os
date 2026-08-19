import Link from "next/link";
import { SidebarNav } from "./sidebar-nav";
import { AccountBlock } from "./account-block";

// Very subtle oxblood vertical wash on the sidebar surface — echoes the
// body's --glow-oxblood radial glow so the shell reads as this app's own,
// not a stock admin template. Top ~35% opacity fading to transparent by 40%
// height, per the structural refactor spec.
const OXBLOOD_WASH: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to bottom, color-mix(in oklch, var(--glow-oxblood) 35%, transparent) 0%, transparent 40%)",
};

function Logo({ iconOnly }: { iconOnly: boolean }) {
  return (
    <Link
      href="/"
      prefetch
      className="flex h-16 shrink-0 items-center border-b border-border px-3 text-sm font-semibold tracking-tight"
    >
      <span aria-hidden className="text-lg">
        &#9670;
      </span>
      {!iconOnly && <span className="ml-2">Life OS</span>}
      <span className="sr-only">Life OS</span>
    </Link>
  );
}

export function AppSidebar({
  account,
}: {
  account: { displayName: string; email: string };
}) {
  return (
    <>
      {/* Icon rail — lg (1024-1279px): icons only, tooltip on hover. */}
      <aside
        className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col border-r border-border bg-sidebar lg:flex xl:hidden"
        style={OXBLOOD_WASH}
      >
        <Logo iconOnly />
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <SidebarNav variant="icon-rail" />
        </div>
        <div className="border-t border-border p-2">
          <AccountBlock displayName={account.displayName} email={account.email} variant="icon-rail" />
        </div>
      </aside>

      {/* Expanded — xl (>=1280px): full labels. */}
      <aside
        className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-border bg-sidebar xl:flex"
        style={OXBLOOD_WASH}
      >
        <Logo iconOnly={false} />
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav variant="expanded" />
        </div>
        <div className="border-t border-border p-2">
          <AccountBlock displayName={account.displayName} email={account.email} variant="expanded" />
        </div>
      </aside>
    </>
  );
}
