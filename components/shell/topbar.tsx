"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Menu, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPageTitle } from "./sidebar-nav";
import { SidebarNav } from "./sidebar-nav";
import { AccountBlock } from "./account-block";

export function Topbar({
  account,
  dateLabel,
  hasActiveLockIn,
}: {
  account: { displayName: string; email: string };
  dateLabel: string;
  hasActiveLockIn: boolean;
}) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <DialogPrimitive.Root>
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-4 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-3">
          <DialogPrimitive.Trigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground lg:hidden"
            >
              <Menu className="size-5" />
            </button>
          </DialogPrimitive.Trigger>
          {/* Chrome label, not page content — PageHeader inside each page's
              own content renders the real <h1>. Two h1s per page would be
              an a11y smell (duplicate top-level heading). */}
          <p className="text-lg font-semibold tracking-tight">{title}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{dateLabel}</span>
          <Link
            href="/business"
            aria-label={hasActiveLockIn ? "Lock-In session active" : "No active Lock-In session"}
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition-colors",
              hasActiveLockIn
                ? "bg-accent-business/15 text-accent-business"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="size-4" fill={hasActiveLockIn ? "currentColor" : "none"} />
          </Link>
          <AccountBlock displayName={account.displayName} email={account.email} variant="icon-rail" />
        </div>
      </header>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-4 border-r border-border bg-sidebar p-4 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left motion-reduce:animate-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="text-sm font-semibold tracking-tight">
            Life OS
          </DialogPrimitive.Title>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav variant="drawer" />
          </div>
          <div className="border-t border-border pt-3">
            <AccountBlock displayName={account.displayName} email={account.email} variant="drawer" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
