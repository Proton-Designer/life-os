"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { TrendingUp, Settings, type LucideIcon, CalendarDays, AlertCircle, Flag, Repeat, CalendarCheck, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { buildPrimaryNavItems } from "@/lib/shell/build-primary-nav-items";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";
import { firstBusinessTab } from "@/lib/shell/work-tabs";
import type { SidebarVariant } from "./sidebar-nav";
import { NavLinkPendingHint } from "./nav-link-pending-hint";

type NavItem = { href: string; label: string; icon: LucideIcon; accent: AccentToken; activeBase?: string };

/**
 * The Review grouping (R61) — kept in step with tab-mobile-island.tsx.
 *
 * THERE ARE FOUR NAV RENDERERS in this shell: this one and
 * tab-mobile-island.tsx for domains mode, sidebar-nav.tsx and
 * mobile-island.tsx for legacy. Updating one is the partial-bridge mistake —
 * it looks handled and is not. If you add an item here, add it there.
 */
const MORE_ITEMS: NavItem[] = [
  { href: "/insights", label: "Insights", icon: TrendingUp, accent: "info" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, accent: "info" },
  // Phase 1 (2026-09-14): /worries and /goals existed but had no entry in
  // EITHER domains-mode renderer at all (this file and its mobile twin
  // below) — a real gap distinct from mobile-island.tsx's legacy-mobile
  // allowlist bug fixed in the same pass. Added here, kept in step with
  // tab-mobile-island.tsx per this const's own doc comment above.
  { href: "/worries", label: "Worries", icon: AlertCircle, accent: "warning" },
  { href: "/goals", label: "Goals", icon: Flag, accent: "info" },
  // Phase 1 #39/#40, 2026-09-14: kept in step with tab-mobile-island.tsx's
  // own MORE_ITEMS — see that file's comment on this addition.
  { href: "/habits", label: "Habits", icon: Repeat, accent: "info" },
  // Phase 1 #46/#47/#48, 2026-09-14: /weekly-review — NOT /review (that
  // route redirects into /close's own review stage). Kept in step with
  // tab-mobile-island.tsx.
  { href: "/weekly-review", label: "Weekly Review", icon: CalendarCheck, accent: "info" },
  // UX-02, 2026-09-15: /business existed but had no entry in EITHER
  // domains-mode renderer — the exact gap Worries/Goals/Habits had above,
  // just missed in that pass. Kept in step with tab-mobile-island.tsx.
  { href: "/business", label: "Business", icon: Target, accent: "business" },
  // IA-P2: Today (/open) and Review (/close) left the nav -- the day lives on Home (Morning card, Today strip,
  // Close the day), and /open redirects there. The topbar moon link is the evening door to /close.
  { href: "/settings", label: "Settings", icon: Settings, accent: "info" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, variant }: { item: NavItem; active: boolean; variant: SidebarVariant }) {
  const colorVar = ACCENT_VAR[item.accent];
  const iconOnly = variant === "icon-rail";

  const link = (
    <Link
      href={item.href}
      prefetch
      data-testid={`tab-nav-${item.label.toLowerCase()}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground",
        iconOnly ? "size-10 justify-center" : "px-3 py-2"
      )}
      style={active ? { backgroundColor: `color-mix(in oklch, var(${colorVar}) 14%, transparent)`, color: `var(${colorVar})` } : undefined}
    >
      <item.icon className="size-4 shrink-0" style={active ? { color: `var(${colorVar})` } : undefined} />
      <span className={iconOnly ? "sr-only" : undefined}>{item.label}</span>
      <NavLinkPendingHint />
    </Link>
  );

  if (!iconOnly) return link;

  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{link}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side="right" sideOffset={8} className="z-50 rounded-md border border-border/50 bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
          {item.label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// The four-tab (M4) desktop nav — same visual language and structure as the
// legacy SidebarNav (which stays untouched, for mode:"legacy" accounts, see
// tab-shell-chrome.tsx), but its MAIN section is built from the user's real
// domain selection instead of a fixed six-item list.
export function TabSidebarNav({ variant, navDomainState }: { variant: SidebarVariant; navDomainState: NavDomainState }) {
  const pathname = usePathname();
  const iconOnly = variant === "icon-rail";
  const primaryItems = buildPrimaryNavItems(navDomainState);

  const sections: { label: string; items: NavItem[] }[] = [
    { label: "MAIN", items: primaryItems },
    // WORK-W1: with a Business tab on the Work screen the separate Business entry goes away.
    { label: "SYSTEM", items: firstBusinessTab(navDomainState.workSubdomains) ? MORE_ITEMS.filter((i) => i.href !== "/business") : MORE_ITEMS },
  ];

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <nav aria-label="Primary" data-testid="tab-sidebar-nav" className="flex flex-col gap-5">
        {sections.map((section, i) => (
          <div key={section.label} className="flex flex-col gap-1">
            {iconOnly ? (
              i > 0 && <div className="mx-2 my-1 h-px bg-border/50" />
            ) : (
              <span className="px-3 text-xs uppercase tracking-wider text-muted-foreground">{section.label}</span>
            )}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.activeBase ?? item.href)} variant={variant} />
            ))}
          </div>
        ))}
      </nav>
    </TooltipPrimitive.Provider>
  );
}
