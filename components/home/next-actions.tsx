"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ListChecks } from "lucide-react";
import { toggleItem } from "@/app/(app)/actions";
import { selectNextActionPerDomain } from "@/lib/home/next-actions";
import type { PriorityItem, CompletedItem } from "@/lib/home/types";
import { formatWindowRelativeTime } from "@/lib/date-utils";
import { IconChip } from "@/components/ui/icon-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { TaskRowList, type TaskRowItem } from "@/components/shared/task-row-list";

const TICK_MS = 60 * 1000;

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

// "Now · in 2h" would be redundant with itself when the window's own time
// text already reads "Now" — collapse to just "Now" in that case.
function metaFor(item: PriorityItem, now: Date, isMostUrgent: boolean): string {
  const timeText = relativeTime(item, now);
  if (isMostUrgent && timeText !== "Now") return `Now · ${timeText}`;
  return timeText;
}

function toTaskRowItem(item: PriorityItem, now: Date, isMostUrgent: boolean): TaskRowItem {
  return {
    id: item.id,
    title: item.title,
    domain: item.domain,
    meta: metaFor(item, now, isMostUrgent),
    mode: "toggle",
  };
}

function toCompletedTaskRowItem(item: CompletedItem): TaskRowItem {
  return {
    id: item.id,
    title: item.title,
    domain: item.domain,
    mode: "toggle",
    completedAtIso: item.completedAtIso,
  };
}

// Fitness never completes with a bare tap here (fitness spec §2.1: a blind
// tap produces rubber-stamped data, and rep goals aren't binary anyway) —
// it navigates to /fitness instead. Kept outside TaskRowList entirely
// (neither "toggle" nor "log" fits "navigate away"), rendered as its own
// row alongside the shared list. See docs/superpowers/specs/
// 2026-08-23-home-fitness-row.md and toggleItem, which throws rather than
// silently no-opping if this ever reaches the toggle path.
function FitnessRow({ item, now, isMostUrgent }: { item: PriorityItem; now: Date; isMostUrgent: boolean }) {
  const meta = metaFor(item, now, isMostUrgent);
  return (
    <li>
      <Link
        href="/fitness"
        className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50"
      >
        <IconChip icon={DOMAIN_ICON[item.domain]} accent={DOMAIN_ACCENT[item.domain]} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
        {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

export function NextActions({
  items,
  completedToday,
  isFreshInstall,
  nowIso,
}: {
  items: PriorityItem[];
  completedToday: CompletedItem[];
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
  const fitnessItem = nextActions.find((i) => i.actionType === "open_fitness") ?? null;
  const taskable = nextActions.filter((i) => i.actionType !== "open_fitness");
  const byId = new Map(taskable.map((i) => [i.id, i]));

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

  const mostUrgent = mostUrgentId(nextActions);
  const rowItems: TaskRowItem[] = [
    ...taskable.map((item) => toTaskRowItem(item, now, item.id === mostUrgent)),
    ...completedToday.map(toCompletedTaskRowItem),
  ];

  async function handleComplete(row: TaskRowItem) {
    const original = byId.get(row.id);
    if (!original) throw new Error(`Unknown Now-module item: ${row.id}`);
    await toggleItem(original);
  }

  // The "all clear" message means nothing is currently ACTIONABLE — which
  // includes the fitness row, even though it never flows through
  // TaskRowList's own items. Showing "You're all clear" above a still-
  // pending workout would be a lie (2026-08-25 Lead review), so this is
  // suppressed whenever fitnessItem exists, regardless of taskable/
  // completedToday. When suppressed, TaskRowList's active region renders
  // nothing (a clean gap) and the fitness row is the only thing that says
  // "something's still due" — its own Completed section (if any) still
  // renders independently below that gap, since finishing everything ELSE
  // today is still worth showing even with the workout outstanding.
  const emptyStateNode = fitnessItem ? null : (
    <EmptyState
      icon={ListChecks}
      message={isFreshInstall ? "Welcome — head into a domain tab to get started" : "You're all clear"}
      action={{ label: "Plan the week", href: "#weekly-focus" }}
    />
  );

  return (
    <div className="flex flex-col gap-1">
      {/* onLog omitted — every current Now-module item is one-tap
          (mode: "toggle"), so there's nothing to wire yet. TaskRowList
          degrades a log-mode row to inert (rather than throwing) if one
          ever shows up without this, so omitting it here is safe, not a
          landmine. */}
      <TaskRowList items={rowItems} onComplete={handleComplete} emptyState={emptyStateNode} />
      {fitnessItem && (
        <ul className="flex flex-col gap-1">
          <FitnessRow item={fitnessItem} now={now} isMostUrgent={fitnessItem.id === mostUrgent} />
        </ul>
      )}
    </div>
  );
}
