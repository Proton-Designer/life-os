"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Home", accentClass: "" },
  { href: "/deen", label: "Deen", accentClass: "text-accent-deen" },
  { href: "/business", label: "Business", accentClass: "text-accent-business" },
  { href: "/fitness", label: "Fitness", accentClass: "text-accent-fitness" },
  { href: "/school", label: "School", accentClass: "text-accent-school" },
  // Co-op shares School's accent color (per spec's pulse-strip fold-in decision).
  { href: "/co-op", label: "Co-op", accentClass: "text-accent-school" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 top-0 z-50 hidden h-14 items-center justify-between border-b border-border/50 bg-background/80 px-6 backdrop-blur-md md:flex"
    >
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Life OS
      </Link>
      <div className="flex items-center gap-6">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "border-b-2 border-transparent py-4 text-sm text-muted-foreground transition-colors hover:text-foreground",
                active && ["border-current", "text-foreground", item.accentClass]
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <Link
        href="/settings"
        aria-current={isActive(pathname, "/settings") ? "page" : undefined}
        aria-label="Settings"
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <Settings className="size-5" />
      </Link>
    </nav>
  );
}
