"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, TrendingUp, Settings, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { buildPrimaryNavItems } from "@/lib/shell/build-primary-nav-items";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";
import { NavLinkPendingHint } from "./nav-link-pending-hint";
import { usePinToVisualViewport } from "./use-pin-to-visual-viewport";

type NavItem = { href: string; label: string; icon: LucideIcon; accent: AccentToken };

const MORE_ITEMS: NavItem[] = [
  { href: "/insights", label: "Insights", icon: TrendingUp, accent: "info" },
  { href: "/settings", label: "Settings", icon: Settings, accent: "info" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The four-tab (M4) mobile nav — same floating-pill chrome as the legacy
// MobileIsland (kept untouched for mode:"legacy" accounts), but at most 4
// primary items instead of a fixed 6, driven by the user's real domain
// selection. Insights/Settings stay reachable via the same "More" popover.
export function TabMobileIsland({ navDomainState }: { navDomainState: NavDomainState }) {
  const pathname = usePathname();
  const primaryItems = buildPrimaryNavItems(navDomainState);
  const moreActive = MORE_ITEMS.some((item) => isActive(pathname, item.href));
  const pinRef = usePinToVisualViewport<HTMLElement>();

  return (
    <nav ref={pinRef} aria-label="Primary" data-testid="tab-mobile-island" className="fixed inset-x-0 bottom-4 z-50 flex justify-center lg:hidden">
      <div
        className="flex items-center gap-1 rounded-full border border-border/50 py-2 px-2 shadow-lg"
        style={{
          backdropFilter: "blur(18px) saturate(180%)",
          WebkitBackdropFilter: "blur(18px) saturate(180%)",
          backgroundColor: "rgba(40,42,54,0.55)",
        }}
      >
        {primaryItems.map((item) => {
          const active = isActive(pathname, item.activeBase ?? item.href);
          const colorVar = ACCENT_VAR[item.accent];
          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch
              data-testid={`tab-mobile-island-item-${item.key}`}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex size-10 items-center justify-center rounded-full transition-colors", !active && "text-muted-foreground")}
              style={active ? { backgroundColor: `color-mix(in oklch, var(${colorVar}) 16%, transparent)`, color: `var(${colorVar})` } : undefined}
            >
              <item.icon className="size-5" />
              <span className="sr-only">{item.label}</span>
              <NavLinkPendingHint />
            </Link>
          );
        })}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="tab-mobile-island-item-more"
              aria-current={moreActive ? "page" : undefined}
              className={cn("flex size-10 items-center justify-center rounded-full transition-colors", moreActive ? "bg-white/10 text-foreground" : "text-muted-foreground")}
            >
              <MoreHorizontal className="size-5" />
              <span className="sr-only">More</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" side="top" align="center">
            {MORE_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className="relative flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
              >
                <item.icon className="size-4" />
                {item.label}
                <NavLinkPendingHint />
              </Link>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}
