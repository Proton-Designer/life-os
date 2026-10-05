"use client";

import { useState, useTransition } from "react";
import { setKillListItem, setKillListItemCompleted, refreshBusinessViews } from "@/app/(app)/business/actions";
import { useOptimisticItem } from "@/lib/client/use-optimistic-item";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { KILL_LIST_REQUIRED_SLOTS } from "@/lib/business/kill-list-target";

export type KillListSlotData = { id: string | null; text: string; completed: boolean };

export function KillList({
  date,
  slots,
}: {
  date: string;
  slots: [KillListSlotData, KillListSlotData, KillListSlotData];
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {slots.map((slot, i) => (
          <KillListSlot key={i} date={date} position={i as 0 | 1 | 2} slot={slot} optional={i >= KILL_LIST_REQUIRED_SLOTS} />
        ))}
      </ul>
    </div>
  );
}

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshBusiness = () => refreshBusinessViews();

function KillListSlot({
  date,
  position,
  slot,
  optional,
}: {
  date: string;
  position: 0 | 1 | 2;
  slot: KillListSlotData;
  /** The third slot: dimmed and labelled "Optional" while empty, and left collapsed until the person opens it. */
  optional: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  // Required slots open straight into the editor when empty; the optional one stays a quiet placeholder until asked for.
  const [editing, setEditing] = useState(!slot.text && !optional);
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState(slot.text);
  // PERF-2: per-slot optimistic state with ordered absolute writes; nothing is
  // disabled while one saves and one deferred refresh re-syncs Business + Home.
  const completion = useOptimisticItem<boolean>({
    serverValue: slot.completed,
    queueKey: `killlist:${slot.id ?? `${date}:${position}`}`,
    write: (next) => setKillListItemCompleted(slot.id!, next),
    refresh: refreshBusiness,
  });
  const optimisticCompleted = completion.value;

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await setKillListItem(date, position, trimmed);
      setEditing(false);
    });
  }

  if (optional && !slot.text && !editing && !opened) {
    return (
      <li className="opacity-50 transition-opacity hover:opacity-100 focus-within:opacity-100" data-testid="kill-list-optional">
        <button
          type="button"
          onClick={() => {
            setOpened(true);
            setEditing(true);
          }}
          className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-dashed border-border/60 px-3 py-2 text-left text-sm text-muted-foreground"
        >
          <span aria-hidden className="size-5 shrink-0 rounded-full border border-dashed border-border" />
          <span className="min-w-0 flex-1 truncate">Optional: a third, only if the day has room</span>
        </button>
      </li>
    );
  }

  if (editing) {
    return (
      <li className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={optional ? "Priority 3 (optional)" : `Priority ${position + 1}`}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          type="button"
          disabled={isPending}
          onClick={submit}
          className="rounded-md bg-accent-business px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
        >
          Save
        </button>
      </li>
    );
  }

  return (
    <li className="flex min-w-0 items-center gap-1 rounded-lg border border-border/40 pr-2">
      {/* The whole slot is the tap target, not just the circle (Ayman:
          "tapped or clicked anywhere on its box") — Edit stays its own
          separate control since it's a different action. Toggling was
          already instant via useOptimistic (applied synchronously before
          the awaited action resolves); this only widens the target. */}
      <button
        type="button"
        disabled={!slot.id}
        onClick={() => slot.id && void completion.set(!optimisticCompleted)}
        aria-label={optimisticCompleted ? "Mark incomplete" : "Mark complete"}
        // min-w-0 is load-bearing: a flex item's automatic minimum size
        // (min-width:auto) refuses to shrink below its min-content, and this
        // button's min-content includes the whole item text. Without it,
        // flex-1 can't actually shrink and the row runs past its container
        // instead of truncating — measured 2026-08-28 at 390px, a 689px row
        // inside a 386px card (matching the shape task-row-list.tsx hit the
        // same night in 6ff8e68).
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/50 disabled:cursor-default disabled:opacity-50"
      >
        <span
          aria-hidden
          className={cn(
            "size-5 shrink-0 rounded-full border transition-colors",
            optimisticCompleted ? "border-accent-business bg-accent-business" : "border-border"
          )}
        />
        <span className={cn("min-w-0 flex-1 truncate text-sm", optimisticCompleted && "text-muted-foreground line-through")}>
          {slot.text}
        </span>
        {optional && !optimisticCompleted && <span className="shrink-0 text-xs text-muted-foreground">Optional</span>}
        {optimisticCompleted && <Badge variant="positive">Done</Badge>}
        {completion.error && (
          <span role="alert" className="shrink-0 text-xs text-destructive">
            Not saved
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        Edit
      </button>
    </li>
  );
}
