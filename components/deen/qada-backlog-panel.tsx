"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ChevronDown, History } from "lucide-react";
import { markPrayer } from "@/app/(app)/deen/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { QadaBacklogBuckets, QadaBacklogItem } from "@/lib/deen/qada-backlog";
import { cn } from "@/lib/utils";

const PRAYER_LABEL: Record<string, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

function formatBacklogDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function BacklogRow({ item, onMarked }: { item: QadaBacklogItem; onMarked: (item: QadaBacklogItem) => void }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      onMarked(item);
      await markPrayer(item.date, item.prayer, "qada");
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-4 py-3">
      <span className="text-sm">
        <span className="font-medium">{PRAYER_LABEL[item.prayer]}</span>
        <span className="text-muted-foreground"> · {formatBacklogDate(item.date)}</span>
      </span>
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="rounded-full transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        <Badge variant="warning">Mark as qada</Badge>
      </button>
    </li>
  );
}

// One (date, prayer) pair can only ever appear in a single section (see
// bucketQadaBacklog) — marking a row done just drops it from that section's
// own list, never needs to reconcile against the other two.
function BacklogSection({
  title,
  footnote,
  items,
  defaultExpanded,
  onItemMarked,
}: {
  title: string;
  footnote?: string;
  items: QadaBacklogItem[];
  defaultExpanded: boolean;
  onItemMarked: (item: QadaBacklogItem) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left transition-colors hover:bg-accent/40"
      >
        <span className="text-sm font-medium">
          {title} <span className="font-mono text-xs font-normal text-muted-foreground">· {items.length} missed</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="flex flex-col gap-2">
          {items.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted-foreground">Nothing here</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <BacklogRow key={`${item.date}-${item.prayer}`} item={item} onMarked={onItemMarked} />
              ))}
            </ul>
          )}
          {footnote && <p className="px-1 text-xs text-muted-foreground">{footnote}</p>}
        </div>
      )}
    </div>
  );
}

function BacklogDialogBody({ buckets, legacyOwed }: { buckets: QadaBacklogBuckets; legacyOwed: number }) {
  const [last7, removeFromLast7] = useOptimistic(buckets.last7, (state, removed: QadaBacklogItem) =>
    state.filter((i) => !(i.date === removed.date && i.prayer === removed.prayer))
  );
  const [month, removeFromMonth] = useOptimistic(buckets.month, (state, removed: QadaBacklogItem) =>
    state.filter((i) => !(i.date === removed.date && i.prayer === removed.prayer))
  );
  const [older, removeFromOlder] = useOptimistic(buckets.older, (state, removed: QadaBacklogItem) =>
    state.filter((i) => !(i.date === removed.date && i.prayer === removed.prayer))
  );

  const totalItems = last7.length + month.length + older.length;

  if (totalItems === 0 && legacyOwed === 0) {
    return (
      <EmptyState
        icon={History}
        message="No outstanding qada — you're caught up"
        action={{ label: "View Salah today", href: "/deen" }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <BacklogSection title="Last 7 days" items={last7} defaultExpanded onItemMarked={removeFromLast7} />
      {/* "Earlier this month," not "This month" — the preview card's "This
          month" number is cumulative (last7 + month), so reusing that exact
          label here, on a bucket that deliberately excludes the last7 items
          already shown above, would show two different numbers under the
          same name a few inches apart. */}
      <BacklogSection title="Earlier this month" items={month} defaultExpanded={false} onItemMarked={removeFromMonth} />
      <BacklogSection
        title="All time"
        items={older}
        defaultExpanded={false}
        onItemMarked={removeFromOlder}
        footnote={
          legacyOwed > 0
            ? `+${legacyOwed} additional owed from before this app tracked prayers`
            : undefined
        }
      />
    </div>
  );
}

/**
 * Preview + sub-window design (2026-08-19): the full itemized list used to
 * render inline on the page — a full Panel spent on a backlog that's often
 * long-tailed. Now the Panel only ever shows three at-a-glance counts;
 * everything itemized lives behind "View backlog" in a Dialog, sectioned by
 * age so the recent (actionable) misses aren't buried under old ones.
 */
export function QadaBacklogPanel({
  buckets,
  last7Count,
  monthCount,
  allTimeCount,
  legacyOwed,
}: {
  buckets: QadaBacklogBuckets;
  last7Count: number;
  monthCount: number;
  allTimeCount: number;
  legacyOwed: number;
}) {
  return (
    <Panel title="Qada backlog">
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xl font-semibold tabular-nums">{last7Count}</span>
          <span className="text-xs text-muted-foreground">Last 7 days</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xl font-semibold tabular-nums">{monthCount}</span>
          <span className="text-xs text-muted-foreground">This month</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xl font-semibold tabular-nums">{allTimeCount}</span>
          <span className="text-xs text-muted-foreground">All time</span>
        </div>
      </div>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="self-start">
            View backlog
          </Button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Qada backlog</DialogTitle>
          </DialogHeader>
          {/* A real (dozens-of-rows) backlog overflows the viewport with no
              way to reach the tail — only visible in an actual browser
              render, not jsdom. This is the scroll container that fixes it. */}
          <div className="-mx-1 min-h-0 overflow-y-auto px-1">
            <BacklogDialogBody buckets={buckets} legacyOwed={legacyOwed} />
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
