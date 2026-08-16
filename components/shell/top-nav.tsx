"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { NavLinkPendingHint } from "./nav-link-pending-hint";

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; accent: AccentToken }[] = [
  { href: "/", label: "Home", icon: Home, accent: "info" },
  { href: "/deen", label: "Deen", icon: DOMAIN_ICON.deen, accent: "deen" },
  { href: "/business", label: "Business", icon: DOMAIN_ICON.business, accent: "business" },
  { href: "/fitness", label: "Fitness", icon: DOMAIN_ICON.fitness, accent: "fitness" },
  { href: "/school", label: "School", icon: DOMAIN_ICON.school, accent: "school" },
  // Co-op shares School's accent color (per spec's pulse-strip fold-in decision).
  { href: "/co-op", label: "Co-op", icon: DOMAIN_ICON.co_op, accent: "school" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname();
  const settingsActive = isActive(pathname, "/settings");

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 top-0 z-50 hidden h-14 items-center justify-between border-b border-border/50 bg-background/80 px-6 backdrop-blur-md md:flex"
    >
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Life OS
      </Link>
      <div className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const colorVar = ACCENT_VAR[item.accent];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                active && "font-medium"
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
              <item.icon className="size-4" />
              {item.label}
              <NavLinkPendingHint />
            </Link>
          );
        })}
      </div>
      <Link
        href="/settings"
        aria-current={settingsActive ? "page" : undefined}
        aria-label="Settings"
        className="relative flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        style={
          settingsActive
            ? {
                backgroundColor: `color-mix(in oklch, var(${ACCENT_VAR.info}) 14%, transparent)`,
                color: `var(${ACCENT_VAR.info})`,
              }
            : undefined
        }
      >
        <Settings className="size-5" />
        <NavLinkPendingHint />
      </Link>
    </nav>
  );
}
