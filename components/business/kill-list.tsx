"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setKillListItem, toggleKillListItem } from "@/app/(app)/business/actions";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
          <KillListSlot key={i} date={date} position={i as 0 | 1 | 2} slot={slot} />
        ))}
      </ul>
    </div>
  );
}

function KillListSlot({
  date,
  position,
  slot,
}: {
  date: string;
  position: 0 | 1 | 2;
  slot: KillListSlotData;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(!slot.text);
  const [text, setText] = useState(slot.text);
  const [optimisticCompleted, setOptimisticCompleted] = useOptimistic(
    slot.completed,
    (_state, next: boolean) => next
  );

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await setKillListItem(date, position, trimmed);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <li className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Priority ${position + 1}`}
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
    <li className="flex items-center gap-1 rounded-lg border border-border/40 pr-2">
      {/* The whole slot is the tap target, not just the circle (Ayman:
          "tapped or clicked anywhere on its box") — Edit stays its own
          separate control since it's a different action. Toggling was
          already instant via useOptimistic (applied synchronously before
          the awaited action resolves); this only widens the target. */}
      <button
        type="button"
        disabled={isPending || !slot.id}
        onClick={() =>
          slot.id &&
          startTransition(async () => {
            setOptimisticCompleted(!optimisticCompleted);
            await toggleKillListItem(slot.id!);
          })
        }
        aria-label={optimisticCompleted ? "Mark incomplete" : "Mark complete"}
        className="flex min-h-11 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/50 disabled:cursor-default disabled:opacity-50"
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
        {optimisticCompleted && <Badge variant="positive">Done</Badge>}
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
