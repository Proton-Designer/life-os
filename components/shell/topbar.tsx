"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { NotificationsBell } from "./notifications-bell";
import { CheckInIconButton } from "./checkin-icon-button";
import { DistractionCaptureDialog } from "@/components/distractions/distraction-capture-dialog";
import { ReviewDialogTrigger } from "@/components/distractions/review-dialog-trigger";
import { CalendarDialogTrigger } from "@/components/calendar/calendar-dialog-trigger";
import { isReviewOpen } from "@/lib/distractions/plan-rules";
import { getTodayDistractionCountForNow } from "@/app/(app)/distractions/actions";
import type { WeekCalendarData } from "@/components/calendar/week-calendar-view";

type SaveGoalAction = (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;

const TICK_MS = 60 * 1000;
// Same cadence as NotificationsBell's own poll — the bell is the established
// precedent for a "live" topbar count sourced by polling a server action
// directly from this client component, never by a count passed down as a
// prop from a Server Component (that would only refresh on whatever page's
// own revalidatePath("/") happened to fire, and this button renders on
// every route via the shared (app) layout, not just Home).
const DISTRACTION_POLL_MS = 60 * 1000;

/**
 * #50: the top bar's Distractions control used to render with no indication
 * anything had been logged today — you had to open Home's Focus panel to see
 * the same number getTodayDistractionCount() already computes. This overlays
 * that count as a small pill, the same visual idiom NotificationsBell already
 * uses for its own unread badge (absolute-positioned, bg-accent-info,
 * text-background — no raw hex, both semantic tokens from globals.css).
 * Wraps the dialog rather than editing distraction-capture-dialog.tsx itself
 * — that file belongs to a different track's file ownership for this pass.
 */
function DistractionCountBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await getTodayDistractionCountForNow();
        if (!cancelled) setCount(next);
      } catch {
        // Best-effort, same posture as NotificationsBell's own poll — a
        // failed refresh leaves the last-known count showing rather than
        // clearing it, and the next 60s tick retries on its own.
      }
    };
    refresh();
    const interval = setInterval(refresh, DISTRACTION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!count) return null;

  return (
    <span
      aria-hidden
      className="absolute -right-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent-info px-1 text-[10px] font-semibold leading-none text-background"
    >
      {count}
    </span>
  );
}

export function Topbar({
  account,
  dateLabel,
  nowIso,
  timezone,
  getWeekCalendar,
  onSaveDeen,
  onSaveBusiness,
  deenMode = false,
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
  /** profiles.deen_mode as a plain boolean; gates the Deen option in the distraction capture dialog. */
  deenMode?: boolean;
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
    <header
      className={cn(
        "sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-border/50 bg-background/80 backdrop-blur-md md:px-6",
        // Tighter padding below md ONLY while the Review button is rendered
        // (9pm-4am) — it adds a second button to the centre group that the
        // no-Review layout was never measured against. Conditioned on
        // reviewOpen, not a width breakpoint, so the already-verified
        // no-Review 390px layout (Opus Lead) is untouched outside this
        // window (found live at 390px during the window itself).
        reviewOpen ? "px-2 max-[359px]:px-1" : "px-4"
      )}
    >
      <div className="flex flex-1 items-center gap-3 sm:flex-none">
        {/* AppSidebar's own logo covers lg+ — below that the sidebar is
            hidden entirely, so this is the only place the brand mark
            shows. The page title itself lives solely in PageHeader
            (removed from here per lead review — was rendering twice). */}
        {/* whitespace-nowrap: without it, "Life OS" wraps onto two lines
            once the centre group grows a second button (Review, 9pm-4am) —
            found live at 390px during that exact window (Opus Lead,
            batch 3 verification). */}
        <Link href="/" prefetch className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold tracking-tight lg:hidden">
          {/* Hidden only below 360px — every pixel matters at 320, but
              Ayman's own 390px phone keeps the glyph (Opus Lead correction,
              batch 3 verification: `sm` at 640px hid it there too for no
              reason). The wordmark alone still identifies the app. */}
          <span aria-hidden className="text-base max-[359px]:hidden">
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
      <div
        className={cn(
          "flex flex-1 items-center justify-center sm:absolute sm:left-1/2 sm:flex-none sm:-translate-x-1/2",
          reviewOpen ? "gap-1 max-[359px]:gap-0" : "gap-2"
        )}
      >
        <div className="relative">
          <DistractionCaptureDialog deenMode={deenMode} />
          <DistractionCountBadge />
        </div>
        {/* Popup, not a navigation (Ayman: "change the 'Review' tab/
            screen at the top into a popup module ... like the
            distractions popup") — the /review route itself still exists
            for e2e/direct links. Gating stays on the TRIGGER's
            visibility, not inside the dialog: the button only renders
            during the 9pm-4am window, same as before. */}
        {reviewOpen && <ReviewDialogTrigger />}
      </div>

      {/* Right-side icon order (batch 3, B3-1, Ayman explicit): Check-in,
          Calendar, Notifications — notifications rightmost. gap-1 only
          below 360px (Opus Lead correction, batch 3 verification: gap-3 is
          the real spacing everywhere Ayman's phone renders — 390px+ — and
          only 320px has no room for three full-size icons plus it). */}
      <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none max-[359px]:gap-1">
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
