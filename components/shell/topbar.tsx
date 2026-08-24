"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "radix-ui";
import { CalendarDays, Menu } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";
import { AccountBlock } from "./account-block";
import { NotificationsBell } from "./notifications-bell";
import { DistractionCaptureDialog } from "@/components/distractions/distraction-capture-dialog";
import { Button } from "@/components/ui/button";
import { isReviewOpen } from "@/lib/distractions/plan-rules";

const TICK_MS = 60 * 1000;

export function Topbar({
  account,
  dateLabel,
  nowIso,
  timezone,
}: {
  account: { displayName: string; email: string };
  dateLabel: string;
  // Seeded from the server so first paint matches the server render (same
  // pattern as next-actions.tsx's nowIso) — the Review button's visibility
  // must not hydration-mismatch. Ticks afterward so it appears without a
  // full navigation once 9pm/4am actually passes while the tab is open.
  nowIso: string;
  timezone: string;
}) {
  const [now, setNow] = useState(() => new Date(nowIso));
  useEffect(() => {
    // The immediate tick matters as much as the nowIso seed above: with
    // next.config.ts's staleTimes.dynamic at 3600s, a cache-hit revisit can
    // serve an RSC payload with an hour-old nowIso baked in, and without
    // this call the Review button would stay wrong for up to another 60s
    // until the interval below first fires — missing for up to a minute
    // right at 9pm/4am, the one moment it matters. Runs after hydration, so
    // it doesn't reintroduce the mismatch the nowIso seed prevents.
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const reviewOpen = isReviewOpen(now, timezone);

  return (
    <DialogPrimitive.Root>
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-4 backdrop-blur-md md:px-6">
        <div className="flex flex-1 items-center gap-3 sm:flex-none">
          <DialogPrimitive.Trigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground lg:hidden"
            >
              <Menu className="size-5" />
            </button>
          </DialogPrimitive.Trigger>
          {/* AppSidebar's own logo covers lg+ — below that the sidebar is
              hidden entirely, so this is the only place the brand mark
              shows. The page title itself lives solely in PageHeader
              (removed from here per lead review — was rendering twice). */}
          <Link href="/" prefetch className="flex items-center gap-2 text-sm font-semibold tracking-tight lg:hidden">
            <span aria-hidden className="text-base">
              &#9670;
            </span>
            Life OS
          </Link>
        </div>

        {/* Centre — directly under the Life OS mark (spec: "middle of the
            top bar ... right under where it says Life OS"). Below sm, the
            three flex-1 siblings keep this centred well enough (the date
            label is hidden, so the right group is narrow). At sm+ the date
            label appears and the right group's content (date label + bell +
            calendar link) can't shrink below its own width, so as a flex-1
            sibling it steals width from this group and drags it left of
            true centre. Fixed by taking this group out of flex flow at sm+
            and centring it on the header box directly (position: sticky on
            the header already establishes the containing block — no extra
            `relative` needed, and adding one would clobber the sticky
            positioning since `position` is a single property), independent
            of the two side groups' widths. */}
        <div className="flex flex-1 items-center justify-center gap-2 sm:absolute sm:left-1/2 sm:flex-none sm:-translate-x-1/2">
          <DistractionCaptureDialog />
          {reviewOpen && (
            <Button asChild variant="outline" size="sm">
              <Link href="/review">Review</Link>
            </Button>
          )}
        </div>

        <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none">
          <span className="hidden text-sm text-muted-foreground sm:inline">{dateLabel}</span>
          <NotificationsBell />
          {/* Replaces the account icon here (spec: "remove the user profile
              icon at the top right ... replace that button with a calendar
              button"). Sign-out is unaffected — AccountBlock still renders
              in the lg/xl sidebar (app-sidebar.tsx) and in this same
              topbar's mobile drawer below, neither of which this touches. */}
          <Link
            href="/calendar"
            aria-label="Open calendar"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <CalendarDays className="size-5" />
          </Link>
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
