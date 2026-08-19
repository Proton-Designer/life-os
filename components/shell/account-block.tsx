"use client";

import Link from "next/link";
import { Download, LogOut, Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut } from "@/app/(app)/actions";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Avatar({ displayName }: { displayName: string }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
      {initials(displayName) || "?"}
    </div>
  );
}

export function AccountBlock({
  displayName,
  email,
  variant,
}: {
  displayName: string;
  email: string;
  variant: "expanded" | "icon-rail" | "drawer";
}) {
  const iconOnly = variant === "icon-rail";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/50",
            iconOnly ? "justify-center" : "w-full"
          )}
        >
          <Avatar displayName={displayName} />
          {!iconOnly && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{displayName}</span>
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-56 p-1">
        <Link
          href="/settings"
          prefetch
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
        >
          <Settings className="size-4" />
          Settings
        </Link>
        {/* No prefetch: this is a route handler (app/(app)/settings/export/route.ts)
            that generates and returns a file, not a screen — prefetching it would
            fire a real export GET on mere viewport visibility. */}
        <Link
          href="/settings/export"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
        >
          <Download className="size-4" />
          Export data
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
