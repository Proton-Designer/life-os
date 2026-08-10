"use client";

import { useState, useTransition } from "react";
import { setKillListItem, toggleKillListItem } from "@/app/(app)/business/actions";
import { Input } from "@/components/ui/input";
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
    <ul className="flex flex-col gap-2">
      {slots.map((slot, i) => (
        <KillListSlot key={i} date={date} position={i as 0 | 1 | 2} slot={slot} />
      ))}
    </ul>
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
        onClick={() => slot.id && startTransition(() => toggleKillListItem(slot.id!))}
        aria-label={slot.completed ? "Mark incomplete" : "Mark complete"}
        className={cn(
          "size-5 shrink-0 rounded-full border transition-colors disabled:opacity-50",
          slot.completed ? "border-accent-business bg-accent-business" : "border-border"
        )}
      />
      <span className={cn("flex-1 text-sm", slot.completed && "text-muted-foreground line-through")}>
        {slot.text}
      </span>
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
