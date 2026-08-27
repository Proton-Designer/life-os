"use client";

// Replaces both the old Zap/"Lock-In active" shortcut AND CheckinQueueBadge
// (2026-08-20, Ayman's direct request + Opus Lead follow-up). The badge
// used to be the ONLY entry point to the allocation check-in sheet, and it
// rendered null at count 0 — since 27df12b tightened the answer window to
// 30 minutes and windows fire every 2 hours, that badge was on screen 25%
// of the day. This bell renders (with an empty state) even at count 0, so
// it's a genuinely persistent surface — the check-in queue is folded in
// below rather than living beside it as a second "something's pending"
// indicator.
//
// Imports the server actions directly rather than receiving them as props
// from a Server Component — same reason as allocation-checkin-gate.tsx
// (AGENTS.md: never pass a function as a prop across the RSC boundary).
// Domain items poll on the same 60s cadence as the allocation queue
// (allocation-queue-context.tsx). Which items EXIST is still fully
// derived at read time on every poll, no dismiss state — but which ones
// are READ is now a real per-day overlay (migration 035,
// lib/notifications/get-notifications.ts's header has the full reasoning,
// including why it's scoped per day rather than permanent). Clicking a
// domain item marks it read both locally (immediate) and server-side
// (persisted); see handleItemClick below. The check-in item itself is NOT
// independently polled and carries no read state of its own — it reads
// straight off useAllocationQueue(), the same context the toast and the
// dialog read, so a fired window is exactly one event surfaced on three
// UIs (toast, bell entry, dialog), never a second independently-detected
// one.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getNotificationsForNow, markNotificationReadForNow } from "@/app/(app)/actions";
import { useAllocationQueue } from "@/lib/checkins/allocation-queue-context";
import type { NotificationItem } from "@/lib/notifications/get-notifications";
import { cn } from "@/lib/utils";

const POLL_MS = 60 * 1000;

const DOMAIN_LABEL: Record<NotificationItem["domain"], string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school: "School",
  co_op: "Work",
};

export function NotificationsBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const { queue, setOpen: setCheckinOpen } = useAllocationQueue();

  const refresh = useCallback(async () => {
    const result = await getNotificationsForNow(new Date().toISOString());
    setItems(result);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Marks read locally (so the count and styling update immediately,
  // before the next 60s poll) AND persists it server-side — the two must
  // both happen: local-only would forget on reload, server-only would lag
  // a full poll cycle behind the click. Best-effort on the network call:
  // if it fails, the next poll re-reads the true server state anyway, so
  // there's nothing meaningful to retry or surface here.
  const handleItemClick = useCallback((item: NotificationItem) => {
    setOpen(false);
    if (item.read) return;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: true } : i)));
    markNotificationReadForNow(item.id, new Date().toISOString()).catch(() => {});
  }, []);

  // Read items stay in the list — they're still unresolved, just already
  // seen — they're only excluded from the count (get-notifications.ts's
  // header explains why `read` never removes an item). The check-in entry
  // has no read state of its own (same header) and always counts while
  // pending.
  const checkinCount = queue.length;
  const unreadCount = items.filter((item) => !item.read).length;
  const count = (checkinCount > 0 ? 1 : 0) + unreadCount;
  // Distinct from `count`: an all-read-but-unresolved list must still
  // render the (darkened) items, never fall back to the empty state —
  // `count` only tracks what's unread, not what exists.
  const hasAnyItems = checkinCount > 0 || items.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count === 0 ? "No notifications" : `${count} notification${count === 1 ? "" : "s"}`}
          // size-9 only below 360px, matching CheckInIconButton — Ayman's
          // own phone is 390px and keeps the full 44px target (Opus Lead
          // correction, batch 3 verification: `sm` at 640px shrank it there
          // too for no reason).
          className="relative flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground max-[359px]:size-9"
        >
          <Bell className="size-4" />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent-info px-1 text-[10px] font-semibold leading-none text-background"
            >
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        {!hasAnyItems ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nothing waiting on you.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {checkinCount > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setCheckinOpen(true);
                  }}
                  className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">Check-in</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Business</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {checkinCount === 1 ? "What did you just do? — expires soon" : `${checkinCount} pending — expires soon`}
                  </span>
                </button>
              </li>
            )}
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={() => handleItemClick(item)}
                  data-testid={`notification-${item.id}`}
                  data-read={item.read ? "true" : "false"}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm hover:bg-accent",
                    item.read && "opacity-60"
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("font-medium", item.read && "font-normal text-muted-foreground")}>
                      {item.title}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {DOMAIN_LABEL[item.domain]}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{item.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
