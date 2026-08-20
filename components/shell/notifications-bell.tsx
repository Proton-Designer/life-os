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
// Imports the server action directly rather than receiving it as a prop
// from a Server Component — same reason as allocation-checkin-gate.tsx
// (AGENTS.md: never pass a function as a prop across the RSC boundary).
// Domain items poll on the same 60s cadence as the allocation queue
// (allocation-queue-context.tsx) since both are cheap, derived-at-read
// reads with no dismiss/read state to reconcile. The check-in item itself
// is NOT independently polled — it reads straight off
// useAllocationQueue(), the same context the toast and the dialog read,
// so a fired window is exactly one event surfaced on three UIs (toast,
// bell entry, dialog), never a second independently-detected one.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getNotificationsForNow } from "@/app/(app)/actions";
import { useAllocationQueue } from "@/lib/checkins/allocation-queue-context";
import type { NotificationItem } from "@/lib/notifications/get-notifications";

const POLL_MS = 60 * 1000;

const DOMAIN_LABEL: Record<NotificationItem["domain"], string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school: "School",
  co_op: "Co-op",
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

  // Sorted to the top unconditionally: these expire in 30 minutes (the
  // shortest fuse of anything in the list), so they outrank a prayer
  // window or a due-today task regardless of dueAt.
  const checkinCount = queue.length;
  const count = (checkinCount > 0 ? 1 : 0) + items.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count === 0 ? "No notifications" : `${count} notification${count === 1 ? "" : "s"}`}
          className="relative flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
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
        {count === 0 ? (
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
                  onClick={() => setOpen(false)}
                  className="flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.title}</span>
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
