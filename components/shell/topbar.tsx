"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NotificationsBell } from "./notifications-bell";
import { CheckInIconButton } from "./checkin-icon-button";
import { DistractionCaptureDialog } from "@/components/distractions/distraction-capture-dialog";
import { ReviewDialogTrigger } from "@/components/distractions/review-dialog-trigger";
import { CalendarDialogTrigger } from "@/components/calendar/calendar-dialog-trigger";
import { isReviewOpen } from "@/lib/distractions/plan-rules";
import type { WeekCalendarData } from "@/components/calendar/week-calendar-view";

type SaveGoalAction = (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;

const TICK_MS = 60 * 1000;

export function Topbar({
  account,
  dateLabel,
  nowIso,
  timezone,
  getWeekCalendar,
  onSaveDeen,
  onSaveBusiness,
}: {
  account: { displayName: string; email: string };
  dateLabel: string;
  // Seeded from the server so first paint matches the server render (same
  // pattern as next-actions.tsx's nowIso) — the Review button's visibility
  // must not hydration-mismatch. Ticks afterward so it appears without a
  // full navigation once 9pm/4am actually passes while the tab is open.
  nowIso: string;
  timezone: string;
  getWeekCalendar: () => Promise<WeekCalendarData>;
  onSaveDeen: SaveGoalAction;
  onSaveBusiness: SaveGoalAction;
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
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-4 backdrop-blur-md md:px-6">
      <div className="flex flex-1 items-center gap-3 sm:flex-none">
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
        {/* Moved here from the right side (batch 3, B3-1) — the right
            side is now icons only: Check-in, Calendar, Notifications. */}
        <span className="hidden text-sm text-muted-foreground sm:inline">{dateLabel}</span>
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
        {/* Popup, not a navigation (Ayman: "change the 'Review' tab/
            screen at the top into a popup module ... like the
            distractions popup") — the /review route itself still exists
            for e2e/direct links. Gating stays on the TRIGGER's
            visibility, not inside the dialog: the button only renders
            during the 9pm-4am window, same as before. */}
        {reviewOpen && <ReviewDialogTrigger />}
      </div>

      {/* Right-side icon order (batch 3, B3-1, Ayman explicit): Check-in,
          Calendar, Notifications — notifications rightmost. */}
      <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none">
        {/* Permanently visible, no time gating — pressing it always opens
            the check-in popup (falls back to the most recent unanswered
            window once the polled queue is empty, so it's never a dead
            form). Glows only while a window is genuinely pending. */}
        <CheckInIconButton />
        {/* Replaces the account icon here (spec: "remove the user profile
            icon at the top right ... replace that button with a calendar
            button"). A popup, not a navigation (Ayman, 2026-08-24:
            "should be a popup, easy to look at and easy to cancel out
            of") — the /calendar route itself still exists for e2e and
            direct links. Sign-out lives in AppSidebar's AccountBlock
            (lg/xl) and in Settings' Security panel on mobile, where the
            hamburger drawer used to be (batch 3, item 2). */}
        <CalendarDialogTrigger
          accountKey={account.email}
          timezone={timezone}
          getWeekCalendar={getWeekCalendar}
          onSaveDeen={onSaveDeen}
          onSaveBusiness={onSaveBusiness}
        />
        <NotificationsBell />
      </div>
    </header>
  );
}
