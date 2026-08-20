"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { CoopTargetRow } from "@/lib/coop/targets";

/**
 * One row in the queue — a target slot (1-3) or a stretch goal, same
 * component either way since the only structural difference is whether
 * "Mark complete" is offered (spec only ever describes marking a TARGET
 * finished, never a stretch goal directly).
 */
export function TargetRow({
  target,
  isTargetSlot,
  canMoveUp,
  canMoveDown,
  onMove,
  onComplete,
  onEdit,
  onRemove,
  onSetDeadline,
  isPending,
}: {
  target: CoopTargetRow;
  isTargetSlot: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: "up" | "down") => void;
  onComplete?: () => void;
  onEdit: (title: string) => void;
  onRemove: () => void;
  onSetDeadline: () => void;
  isPending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(target.title);

  function handleSave() {
    const trimmed = title.trim();
    if (trimmed && trimmed !== target.title) onEdit(trimmed);
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
      <div className="flex flex-col">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canMoveUp || isPending}
          onClick={() => onMove("up")}
          aria-label="Move up"
        >
          <ChevronUp />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canMoveDown || isPending}
          onClick={() => onMove("down")}
          aria-label="Move down"
        >
          <ChevronDown />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-1">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
            <Button type="button" variant="ghost" size="icon-sm" onClick={handleSave} aria-label="Save title">
              <Check />
            </Button>
          </div>
        ) : (
          <span className="text-sm font-medium">{target.title}</span>
        )}
        {target.deadline ? (
          <Badge variant="neutral">Due {target.deadline}</Badge>
        ) : (
          <button
            type="button"
            onClick={onSetDeadline}
            className="w-fit text-left text-xs text-accent-warning underline-offset-2 hover:underline"
          >
            Set a deadline
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        {!editing && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Edit title">
            <Pencil />
          </Button>
        )}
        {isTargetSlot && onComplete && (
          <Button type="button" variant="ghost" size="icon-sm" disabled={isPending} onClick={onComplete} aria-label="Mark complete">
            <Check className="text-accent-business" />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" disabled={isPending} onClick={onRemove} aria-label="Remove">
          <Trash2 className="text-destructive" />
        </Button>
      </div>
    </div>
  );
}

/** The empty, inviting placeholder for a target slot with nothing in it (spec ruling 6 — never reads as an error or a gap). */
export function EmptyTargetSlot({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex items-center justify-center rounded-lg border border-dashed border-border/60 px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      + Add a target
    </button>
  );
}
