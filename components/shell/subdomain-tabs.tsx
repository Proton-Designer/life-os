import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";

export interface SubdomainTabItem {
  key: string;
  href: string;
  label: string;
  icon?: LucideIcon;
  accent: AccentToken;
  active: boolean;
}

// The in-tab subdomain switcher for Personal and Work (M4): subdomains never
// become separate nav items — they switch content within one tab. Plain
// server-renderable links, no client state; a single subdomain renders
// nothing, since there's nothing to switch between (a user who kept only
// Fitness gets straight to Fitness, not a one-item tab bar in front of it).
export function SubdomainTabs({ items, testIdPrefix }: { items: SubdomainTabItem[]; testIdPrefix: string }) {
  if (items.length <= 1) return null;

  return (
    <div role="tablist" aria-label="Subdomains" data-testid={testIdPrefix} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {items.map((item) => {
        const colorVar = ACCENT_VAR[item.accent];
        return (
          <Link
            key={item.key}
            href={item.href}
            prefetch
            role="tab"
            aria-selected={item.active}
            data-testid={`${testIdPrefix}-${item.key}`}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              item.active ? "border-transparent" : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
            )}
            style={
              item.active
                ? { backgroundColor: `color-mix(in oklch, var(${colorVar}) 14%, transparent)`, color: `var(${colorVar})` }
                : undefined
            }
          >
            {item.icon ? <item.icon className="size-3.5" /> : null}
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
