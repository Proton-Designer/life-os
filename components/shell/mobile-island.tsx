"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MoreHorizontal, type LucideIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { SECTIONS } from "./sidebar-nav";
import { NavLinkPendingHint } from "./nav-link-pending-hint";
import { usePinToVisualViewport } from "./use-pin-to-visual-viewport";
import { AskAiLinks } from "./ask-ai-launcher";
import type { FeatureId } from "@/lib/features";

const PRIMARY_ITEMS: {
  href: string;
  label: string;
  key: string;
  icon: LucideIcon;
  accent: AccentToken;
}[] = [
  { href: "/", label: "Home", key: "home", icon: Home, accent: "info" },
  { href: "/deen", label: "Deen", key: "deen", icon: DOMAIN_ICON.deen, accent: "deen" },
  { href: "/business", label: "Business", key: "business", icon: DOMAIN_ICON.business, accent: "business" },
  { href: "/school", label: "School", key: "school", icon: DOMAIN_ICON.school, accent: "school" },
  { href: "/fitness", label: "Fitness", key: "fitness", icon: DOMAIN_ICON.fitness, accent: "fitness" },
  { href: "/work", label: "Work", key: "work", icon: DOMAIN_ICON.co_op, accent: "coop" },
];

// Insights, Worries, Goals, Settings, in that order — reused from
// SidebarNav's own SECTIONS (REVIEW then SYSTEM) rather than re-declared
// here a third time. An EXPLICIT allowlist deliberately, not "every SECTIONS
// item" — the six MAIN-section items already have their own dedicated slots
// in PRIMARY_ITEMS above, so admitting everything here would duplicate them
// into this popover too.
//
// Phase 1 (2026-09-14): this allowlist previously named only /insights and
// /settings, which made /worries reachable in EVERY other nav surface
// (legacy desktop, both domains-mode renderers) but not this one — a real
// legacy-mobile gap, found while wiring /goals into all four renderers.
// Fixed here rather than repeated: /goals joins /worries in the same fix.
//
// Phase 1 #39/#40, 2026-09-14: /habits joins the allowlist for the same
// reason — SECTIONS gained the entry in sidebar-nav.tsx, and this filter is
// explicit rather than "every SECTIONS item," so it needed its own line.
//
// Phase 1 #46/#47/#48, 2026-09-14: /weekly-review, same reason again.
//
// Phase 1 #29/#33/#34/#35/#36, 2026-09-18: /open (Day Structure), same
// reason again -- SECTIONS gained the entry in sidebar-nav.tsx's REVIEW
// group, and this filter is explicit rather than "every SECTIONS item," so
// it needed its own line here too.
//
// 2026-09-18: /close ("Review"), same reason again -- see this file's own
// header comment below for why the legacy nav no longer omits it.
const MORE_ITEMS = SECTIONS.flatMap((section) => section.items).filter(
  (item) =>
    item.href === "/insights" ||
    item.href === "/settings" ||
    item.href === "/worries" ||
    item.href === "/goals" ||
    item.href === "/habits" ||
    item.href === "/weekly-review"
);

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * LEGACY NAV — does not carry the domains-mode pair's exact Review grouping
 * (R68; that pair also lists Calendar, which this nav still doesn't).
 *
 * STALE AS OF 2026-09-18, CORRECTED HERE (same correction as
 * sidebar-nav.tsx's own copy of this comment — read that one for the full
 * reasoning): this used to justify the gap below as deliberate because
 * "Ayman's own account is legacy mode." That premise is false —
 * `getUserDomainsForUser` (lib/domains/user-domains-core.ts) puts an account
 * in legacy mode only when it has zero active `user_domains` rows, and his
 * accounts have them, so they are in domains mode. He has since asked for
 * these gaps closed.
 *
 * /close and /open are now BOTH reachable from this nav's own More popover
 * (MORE_ITEMS above, sourced from sidebar-nav.tsx's SECTIONS) — the 6-of-38
 * accounts still genuinely in legacy mode were the only ones actually
 * blocked by the old gap.
 */
export function MobileIsland({ hiddenFeatures = [] }: { hiddenFeatures?: FeatureId[] }) {
  const pathname = usePathname();
  // L10 (lib/features.ts): Home is excluded from filtering by an explicit
  // runtime check (`item.key === "home" ||`), not just by FeatureId's type
  // never naming it — a type-only guarantee doesn't survive a caller that
  // bypasses the type (a stale/corrupted DB value, a future bug upstream in
  // sanitizeHiddenFeatures), and this is the one nav item that must never
  // disappear regardless of what's in the array.
  const primaryItems = PRIMARY_ITEMS.filter((item) => item.key === "home" || !hiddenFeatures.includes(item.key as FeatureId));
  const moreItems = MORE_ITEMS.filter((item) => !hiddenFeatures.includes(item.href.slice(1) as FeatureId));
  const moreActive = moreItems.some((item) => isActive(pathname, item.href));
  // Pinned to the visual viewport, not just floored to a minimum scale
  // (app/layout.tsx) — without this a pinch-zoom-in scales this `fixed`
  // element up and drifts it with the rest of the page (Ayman: "the bottom
  // menu should ALWAYS remain in the same place with the same size").
  const pinRef = usePinToVisualViewport<HTMLElement>();

  return (
    <nav
      ref={pinRef}
      aria-label="Primary"
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center lg:hidden"
    >
      <div
        // gap-0.5/px-1.5 instead of gap-1/px-2: with 6 primary items + the
        // ⋯ button (7 × size-10 = 280px, the touch-target floor — never
        // shrink below it), the wider padding pushed this past 320px-wide
        // phones. Trimmed the padding and gaps instead, per Opus Lead's
        // review, keeping every touch target at its full 40px.
        className="flex items-center gap-0.5 rounded-full border border-border/50 py-2 px-1.5 shadow-lg"
        style={{
          backdropFilter: "blur(18px) saturate(180%)",
          WebkitBackdropFilter: "blur(18px) saturate(180%)",
          backgroundColor: "rgba(40,42,54,0.55)",
        }}
      >
        {primaryItems.map((item) => {
          const active = isActive(pathname, item.href);
          const colorVar = ACCENT_VAR[item.accent];
          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch
              data-testid={`mobile-island-item-${item.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex size-10 items-center justify-center rounded-full transition-colors",
                !active && "text-muted-foreground"
              )}
              style={
                active
                  ? {
                      backgroundColor: `color-mix(in oklch, var(${colorVar}) 16%, transparent)`,
                      color: `var(${colorVar})`,
                    }
                  : undefined
              }
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
              data-testid="mobile-island-item-more"
              aria-current={moreActive ? "page" : undefined}
              className={cn(
                "flex size-10 items-center justify-center rounded-full transition-colors",
                moreActive ? "bg-white/10 text-foreground" : "text-muted-foreground"
              )}
            >
              <MoreHorizontal className="size-5" />
              <span className="sr-only">More</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" side="top" align="center">
            {moreItems.map((item) => (
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
            {/* System B: quick AI access. Added to this already-extensible
                popover rather than the fixed icon row above — that row's
                width is at capacity (7 × size-10 touch targets calculated to
                the 320px floor, see the comment on this component's
                container) and has broken twice before when it grew. This
                list has no such budget. */}
            <div data-testid="mobile-island-more-divider" className="my-1 h-px bg-border/50" />
            <AskAiLinks />
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}
