"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { Home, TrendingUp, CalendarRange, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { NavLinkPendingHint } from "./nav-link-pending-hint";

export type SidebarVariant = "expanded" | "icon-rail" | "drawer";

type NavItem = { href: string; label: string; icon: LucideIcon; accent: AccentToken };

type NavSection = { label: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    label: "MAIN",
    items: [
      { href: "/", label: "Home", icon: Home, accent: "info" },
      { href: "/deen", label: "Deen", icon: DOMAIN_ICON.deen, accent: "deen" },
      { href: "/business", label: "Business", icon: DOMAIN_ICON.business, accent: "business" },
      { href: "/fitness", label: "Fitness", icon: DOMAIN_ICON.fitness, accent: "fitness" },
      { href: "/school", label: "School", icon: DOMAIN_ICON.school, accent: "school" },
      { href: "/co-op", label: "Co-op", icon: DOMAIN_ICON.co_op, accent: "coop" },
    ],
  },
  {
    label: "REVIEW",
    items: [
      { href: "/insights", label: "Insights", icon: TrendingUp, accent: "info" },
      { href: "/weekly-planning", label: "Weekly Planning", icon: CalendarRange, accent: "info" },
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
    <Link
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
    </Link>
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

export function SidebarNav({ variant }: { variant: SidebarVariant }) {
  const pathname = usePathname();
  const iconOnly = variant === "icon-rail";

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <nav aria-label="Primary" className="flex flex-col gap-5">
        {SECTIONS.map((section, i) => (
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
