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
  const isUntouched = slots.every((s) => !s.text);

  return (
    <div className="flex flex-col gap-3">
      {/* Empty-state only (R1, 2026-08-18 synthesis) — this exists to make
          the act obvious at 7am, not to explain the kill-list concept back
          to Ayman, who designed it. Recedes the moment a slot has anything
          in it, so it never sits around as clutter next to real items. */}
      {isUntouched && (
        <p className="text-xs text-muted-foreground">
          Not a to-do list — the three that must happen today, whatever else goes sideways. e.g.
          &ldquo;Ship the pricing page,&rdquo; not &ldquo;check email.&rdquo;
        </p>
      )}
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
    <li className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3">
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
        className={cn(
          "size-5 shrink-0 rounded-full border transition-colors disabled:opacity-50",
          optimisticCompleted ? "border-accent-business bg-accent-business" : "border-border"
        )}
      />
      <span className={cn("flex-1 text-sm", optimisticCompleted && "text-muted-foreground line-through")}>
        {slot.text}
      </span>
      {optimisticCompleted && <Badge variant="positive">Done</Badge>}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Edit
      </button>
    </li>
  );
}
