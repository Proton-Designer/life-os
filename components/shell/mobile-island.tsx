"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MoreHorizontal } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const PRIMARY_ITEMS: {
  href: string;
  label: string;
  key: string;
  icon?: React.ReactNode;
  emoji?: string;
}[] = [
  { href: "/", label: "Home", key: "home", icon: <Home className="size-5" /> },
  { href: "/deen", label: "Deen", key: "deen", emoji: "\u{1F54C}" },
  { href: "/business", label: "Business", key: "business", emoji: "\u{1F4BC}" },
  { href: "/school", label: "School", key: "school", emoji: "\u{1F393}" },
];

const MORE_ITEMS = [
  { href: "/fitness", label: "Fitness" },
  { href: "/co-op", label: "Co-op" },
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
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center md:hidden"
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
          return (
            <Link
              key={item.key}
              href={item.href}
              data-testid={`mobile-island-item-${item.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex size-10 items-center justify-center rounded-full text-lg transition-colors",
                active ? "bg-white/10 text-foreground" : "text-muted-foreground"
              )}
            >
              {item.icon ?? <span aria-hidden>{item.emoji}</span>}
              <span className="sr-only">{item.label}</span>
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
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
              >
                {item.label}
              </Link>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}
