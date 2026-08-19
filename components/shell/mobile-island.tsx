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
import { NavLinkPendingHint } from "./nav-link-pending-hint";

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
];

const MORE_ITEMS = [
  { href: "/fitness", label: "Fitness", icon: DOMAIN_ICON.fitness },
  { href: "/co-op", label: "Co-op", icon: DOMAIN_ICON.co_op },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileIsland() {
  const pathname = usePathname();
  const moreActive = MORE_ITEMS.some((item) => isActive(pathname, item.href));

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center lg:hidden"
    >
      <div
        className="flex items-center gap-1 rounded-full border border-border/50 py-2 px-2 shadow-lg"
        style={{
          backdropFilter: "blur(18px) saturate(180%)",
          WebkitBackdropFilter: "blur(18px) saturate(180%)",
          backgroundColor: "rgba(40,42,54,0.55)",
        }}
      >
        {PRIMARY_ITEMS.map((item) => {
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
