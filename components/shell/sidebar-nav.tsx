"use client";

import { IntentLink } from "@/components/shell/intent-link";
import { usePathname } from "next/navigation";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { Home, TrendingUp, Settings, BookOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { NavLinkPendingHint } from "./nav-link-pending-hint";
import type { FeatureId } from "@/lib/features";

export type SidebarVariant = "expanded" | "icon-rail";

export type NavItem = { href: string; label: string; icon: LucideIcon; accent: AccentToken };

type NavSection = { label: string; items: NavItem[] };

export const SECTIONS: NavSection[] = [
  {
    label: "MAIN",
    items: [
      { href: "/", label: "Home", icon: Home, accent: "info" },
      { href: "/deen", label: "Faith", icon: DOMAIN_ICON.deen, accent: "deen" },
      { href: "/business", label: "Business", icon: DOMAIN_ICON.business, accent: "business" },
      { href: "/fitness", label: "Fitness", icon: DOMAIN_ICON.fitness, accent: "fitness" },
      { href: "/school", label: "School", icon: DOMAIN_ICON.school, accent: "school" },
      { href: "/work", label: "Work", icon: DOMAIN_ICON.co_op, accent: "coop" },
      // S6, 2026-09-14: legacy accounts (this nav's only audience) had NO
      // route to Self-Mastery at all before this entry — not hidden, absent.
      // app/(app)/self-mastery/page.tsx is the legacy-reachable route (see
      // its own header for why it's separate from /personal/self_mastery,
      // which redirects a legacy account away before it ever renders).
      // Same icon/accent as SUBDOMAIN_META's self_mastery entry
      // (app/(app)/personal/[subdomain]/layout.tsx) and domain-meta.ts's
      // onboarding copy, so the same feature reads identically wherever a
      // user encounters it.
      { href: "/self-mastery", label: "Self-Mastery", icon: BookOpen, accent: "info" },
    ],
  },
  {
    label: "REVIEW",
    items: [
      { href: "/insights", label: "Insights", icon: TrendingUp, accent: "info" },
      // IA-P2: Today (/open) and Review (/close) left the nav; the day lives on Home and the topbar moon link opens /close.
    ],
  },
  {
    label: "SYSTEM",
    items: [{ href: "/settings", label: "Settings", icon: Settings, accent: "info" }],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  active,
  variant,
}: {
  item: NavItem;
  active: boolean;
  variant: SidebarVariant;
}) {
  const colorVar = ACCENT_VAR[item.accent];
  const iconOnly = variant === "icon-rail";

  const link = (
    <IntentLink
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground",
        iconOnly ? "size-10 justify-center" : "px-3 py-2"
      )}
      style={
        active
          ? {
              backgroundColor: `color-mix(in oklch, var(${colorVar}) 14%, transparent)`,
              color: `var(${colorVar})`,
            }
          : undefined
      }
    >
      <item.icon className="size-4 shrink-0" style={active ? { color: `var(${colorVar})` } : undefined} />
      <span className={iconOnly ? "sr-only" : undefined}>{item.label}</span>
      <NavLinkPendingHint />
    </IntentLink>
  );

  if (!iconOnly) return link;

  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{link}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          sideOffset={8}
          className="z-50 rounded-md border border-border/50 bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
        >
          {item.label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/**
 * LEGACY NAV — does not carry the domains-mode pair's exact Review grouping
 * (R68; that pair also lists Calendar, which this nav still doesn't).
 *
 * STALE AS OF 2026-09-18, CORRECTED HERE: this comment used to justify the
 * gap below as deliberate because "Ayman's own account is legacy mode." That
 * premise is false and has been for a while — `getUserDomainsForUser`
 * (lib/domains/user-domains-core.ts) puts an account in "legacy" mode only
 * when onboarding is complete AND it has zero active `user_domains` rows;
 * his accounts have domain rows, so they are in domains mode, not legacy.
 * M6 protected a decision that was never really his to begin with once that
 * changed underneath it. He has since asked for these gaps closed.
 *
 * /close and /open are now BOTH reachable from this nav (Review and Today
 * below) — the 6-of-38 accounts still genuinely in legacy mode were the only
 * ones actually blocked by the old gap, and are the reason it got closed.
 */
export function SidebarNav({
  variant,
  hiddenFeatures = [],
}: {
  variant: SidebarVariant;
  /** L10 (lib/features.ts): destinations to omit. Filters by the item's
   * path segment (`/insights` -> "insights"), the same derivation
   * mobile-island.tsx's PRIMARY_ITEMS filter uses, so both nav surfaces
   * read one shared id space without a second mapping to keep in sync.
   * Defaults to none — every existing caller keeps rendering the full nav. */
  hiddenFeatures?: FeatureId[];
}) {
  const pathname = usePathname();
  const iconOnly = variant === "icon-rail";

  // Sections that end up with zero items after filtering are dropped
  // entirely, not rendered as a bare header/divider over nothing — REVIEW
  // today has exactly one item (Insights), so hiding it must remove the
  // whole section, not leave an empty "REVIEW" label standing alone.
  //
  // Home (`href === "/"`) is excluded from filtering by an explicit runtime
  // check, not just because FEATURE_IDS never names it — same reasoning as
  // mobile-island.tsx's own primaryItems filter: a type-only guarantee
  // doesn't survive a caller that bypasses the type, and Home is the one
  // item that must never disappear regardless of what's in the array.
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.href === "/" || !hiddenFeatures.includes(item.href.slice(1) as FeatureId)),
  })).filter((section) => section.items.length > 0);

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <nav aria-label="Primary" className="flex flex-col gap-5">
        {visibleSections.map((section, i) => (
          <div key={section.label} className="flex flex-col gap-1">
            {iconOnly ? (
              i > 0 && <div data-testid="sidebar-section-divider" className="mx-2 my-1 h-px bg-border/50" />
            ) : (
              <span className="px-3 text-xs uppercase tracking-wider text-muted-foreground">
                {section.label}
              </span>
            )}
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                variant={variant}
              />
            ))}
          </div>
        ))}
      </nav>
    </TooltipPrimitive.Provider>
  );
}
