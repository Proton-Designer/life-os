"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight, ListChecks } from "lucide-react";
import { toggleItem } from "@/app/(app)/actions";
import { selectNextActionPerDomain } from "@/lib/home/next-actions";
import type { PriorityItem } from "@/lib/home/types";
import { formatWindowRelativeTime } from "@/lib/date-utils";
import { IconChip } from "@/components/ui/icon-chip";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";

const TICK_MS = 60 * 1000;

const DOMAIN_LABEL: Record<PriorityItem["domain"], string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school: "School",
  co_op: "Work",
};

// Thin wrapper around formatWindowRelativeTime (shared with
// next-up-hero.tsx, the Deen page's own "next prayer" hero) — "Today" for
// no dueAt, "Xh left" for an already-open window (e.g. a prayer whose time
// has started but hasn't closed), "in Xh"/"Xh overdue"/"Now" otherwise.
function relativeTime(item: PriorityItem, now: Date): string {
  return formatWindowRelativeTime(item.dueAt, item.windowEndAt, now);
}

// The single most urgent item across the module: right_now bucket, earliest
// dueAt. Ties/no dueAt fall back to array order (stable NEXT_ACTION_ORDER).
function mostUrgentId(items: PriorityItem[]): string | null {
  const candidates = items.filter((i) => i.urgencyBucket === "right_now");
  if (candidates.length === 0) return null;
  const earliest = candidates.reduce((best, i) => {
    const bestTime = best.dueAt?.getTime() ?? Infinity;
    const time = i.dueAt?.getTime() ?? Infinity;
    return time < bestTime ? i : best;
  });
  return earliest.id;
}

function Row({
  item,
  now,
  isMostUrgent,
  onComplete,
}: {
  item: PriorityItem;
  now: Date;
  isMostUrgent: boolean;
  onComplete: (item: PriorityItem) => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      onComplete(item);
      await toggleItem(item);
    });
  }

  const timeText = relativeTime(item, now);
  // The Now badge already says it — don't also render "Now" as the time
  // text right next to it.
  const showTimeText = !(isMostUrgent && timeText === "Now");

  // Fitness never completes with a bare tap here (fitness spec §2.1: a
  // blind tap produces rubber-stamped data, and rep goals aren't binary
  // anyway) — it navigates to /fitness instead, and renders a chevron
  // where every other row renders its checkbox so it doesn't read as
  // tappable-to-complete. See docs/superpowers/specs/
  // 2026-08-23-home-fitness-row.md and toggleItem, which throws rather
  // than silently no-opping if this ever reaches the toggle path.
  if (item.actionType === "open_fitness") {
    return (
      <li>
        <Link
          href="/fitness"
          className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent/50"
        >
          <IconChip icon={DOMAIN_ICON[item.domain]} accent={DOMAIN_ACCENT[item.domain]} size="sm" />
          <span className="shrink-0 text-xs font-medium text-muted-foreground">{DOMAIN_LABEL[item.domain]}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
          {isMostUrgent && <Badge variant="info">Now</Badge>}
          {showTimeText && <span className="shrink-0 text-xs text-muted-foreground">{timeText}</span>}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent/50">
      <IconChip icon={DOMAIN_ICON[item.domain]} accent={DOMAIN_ACCENT[item.domain]} size="sm" />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{DOMAIN_LABEL[item.domain]}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
      {isMostUrgent && <Badge variant="info">Now</Badge>}
      {showTimeText && <span className="shrink-0 text-xs text-muted-foreground">{timeText}</span>}
      <button
        type="button"
        aria-label={`Mark "${item.title}" done`}
        disabled={isPending}
        onClick={handleClick}
        className="size-5 shrink-0 rounded-full border border-border transition-opacity disabled:opacity-50"
      />
    </li>
  );
}

export function NextActions({
  items,
  isFreshInstall,
  nowIso,
}: {
  items: PriorityItem[];
  isFreshInstall: boolean;
  // Unlike priority-list.tsx's null-first pattern (which falls back to the
  // server-computed urgencyBucket while `now` is unset), this module has no
  // such fallback for its relative-time text — a null start would render
  // blank on first paint and pop in a frame after mount, on every Home
  // load. Seeding from the server's own `now` instead means the first
  // client render matches the server-rendered HTML exactly (same string in,
  // same Date out), so there's no blank frame and no hydration mismatch.
  nowIso: string;
}) {
  const nextActions = selectNextActionPerDomain(items);
  const [optimisticItems, removeOptimistically] = useOptimistic(
    nextActions,
    (state, removedId: string) => state.filter((i) => i.id !== removedId)
  );

  const [now, setNow] = useState(() => new Date(nowIso));
  useEffect(() => {
    // The immediate tick matters as much as the nowIso seed above, not just
    // as a nicety: next.config.ts's staleTimes.dynamic (3600s) means a Home
    // RSC payload — nowIso baked in — can be served from the client Router
    // Cache up to an hour stale on a cache-hit revisit. Without this call,
    // first paint would compute relative times against that hour-old clock
    // and stay wrong for up to another 60s until the interval below fires.
    // Effects run after hydration, so this doesn't reintroduce the blank-
    // first-paint bug the nowIso seed fixed — it corrects the *value* once
    // the DOM the server sent has already matched on the client.
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  if (optimisticItems.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        message={isFreshInstall ? "Welcome — head into a domain tab to get started" : "You're all clear"}
        action={{ label: "Plan the week", href: "#weekly-focus" }}
      />
    );
  }

  const mostUrgent = mostUrgentId(optimisticItems);

  return (
    <ul className="flex flex-col gap-1">
      {optimisticItems.map((item) => (
        <Row
          key={item.id}
          item={item}
          now={now}
          isMostUrgent={item.id === mostUrgent}
          onComplete={(i) => removeOptimistically(i.id)}
        />
      ))}
    </ul>
  );
}
