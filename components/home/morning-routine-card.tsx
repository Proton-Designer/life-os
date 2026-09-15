"use client";

import { useState, useTransition } from "react";
import { Check, Circle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createMorningRoutineItem,
  archiveMorningRoutineItem,
  checkMorningRoutineItem,
  uncheckMorningRoutineItem,
} from "@/app/(app)/morning-routine/actions";
import { MAX_ROUTINE_ITEMS } from "@/lib/morning-routine/constants";
import type { MorningRoutineChecklistItem } from "@/lib/morning-routine/actions-core";

/**
 * P3-01 -- Morning Routine checklist. Server actions are IMPORTED here, not
 * passed as props (same discipline as components/habits/habit-list.tsx and
 * CLAUDE.md's own hard rule against a Server->Client function prop).
 * `MAX_ROUTINE_ITEMS` comes from the client-safe lib/morning-routine/
 * constants.ts, never from actions-core.ts (server-only) -- same fix
 * lib/habits/constants.ts's own header records for MAX_ACTIVE_HABITS after
 * that exact import broke a production build once (b63600b).
 *
 * SET, NOT TOGGLE, on the wire (actions-core.ts's own doctrine): a check tap
 * calls `checkMorningRoutineItem` or `uncheckMorningRoutineItem` depending
 * on the NEW state, never a single "flip whatever it is" action. Optimistic
 * locally, rolled back on a rejected write (e.g. a tab open since
 * yesterday hitting the today-only rule) -- same shape as HabitList's own
 * vote toggle.
 */
export function MorningRoutineCard({ initialItems }: { initialItems: MorningRoutineChecklistItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [newLabel, setNewLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function toggleCheck(item: MorningRoutineChecklistItem) {
    const next = !item.checkedToday;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checkedToday: next } : i)));
    setRowErrors((prev) => ({ ...prev, [item.id]: "" }));
    startTransition(async () => {
      const result = next ? await checkMorningRoutineItem(item.id) : await uncheckMorningRoutineItem(item.id);
      if (!result.ok) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checkedToday: !next } : i)));
        setRowErrors((prev) => ({ ...prev, [item.id]: result.message }));
      }
    });
  }

  function handleArchive(item: MorningRoutineChecklistItem) {
    const previous = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    startTransition(async () => {
      const result = await archiveMorningRoutineItem(item.id);
      if (!result.ok) {
        setItems(previous);
        setRowErrors((prev) => ({ ...prev, [item.id]: result.message }));
      }
    });
  }

  function handleAdd() {
    const trimmed = newLabel.trim();
    if (!trimmed) {
      setAddError("Enter a checklist item first.");
      return;
    }
    if (items.length >= MAX_ROUTINE_ITEMS) {
      setAddError(`You already have ${MAX_ROUTINE_ITEMS} morning routine items — archive one before adding another.`);
      return;
    }
    setAddError(null);
    startTransition(async () => {
      const result = await createMorningRoutineItem(trimmed);
      if (result.ok) {
        setNewLabel("");
        // The server assigns the real id -- re-fetching would be the honest
        // move, but this card's own page already revalidates the route
        // (createMorningRoutineItem's own revalidatePath), so the NEXT
        // server render will carry the real row. Avoid a stale optimistic
        // row with a fabricated id in the meantime by simply not rendering
        // one -- this input clears and the item appears on next paint.
      } else {
        setAddError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/40 p-4">
      <span className="text-sm font-medium">Morning routine</span>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No routine items yet — add one below.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => toggleCheck(item)}
                  className="flex flex-1 items-center gap-2 text-left text-sm"
                >
                  {item.checkedToday ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className={item.checkedToday ? "text-muted-foreground line-through" : undefined}>{item.label}</span>
                </button>
                <Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleArchive(item)} aria-label={`Remove ${item.label}`}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
              {rowErrors[item.id] ? <p className="pl-6 text-xs text-destructive">{rowErrors[item.id]}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={newLabel}
          disabled={isPending}
          placeholder="Add a routine item…"
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          className="h-8 text-sm"
        />
        <Button size="sm" variant="outline" disabled={isPending} onClick={handleAdd} aria-label="Add routine item">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      {addError ? <p className="text-xs text-destructive">{addError}</p> : null}
    </div>
  );
}
