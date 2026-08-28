"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDaysLeft, type CoopTargetRow } from "@/lib/coop/targets";

/**
 * One row in the queue — a target slot (1-3) or a stretch goal, same
 * component either way since the only structural difference is whether
 * "Mark complete" is offered (spec only ever describes marking a TARGET
 * finished, never a stretch goal directly).
 *
 * Opus Lead catch (2026-08-20, from the coop-4 screenshot): order and
 * priority ARE the feature ("Target 1 is THE priority until it's
 * finished"), and three visually identical rows don't express that. Rank
 * is shown for target slots (never stretch goals — they aren't ranked),
 * and rank 1 gets a distinct filled/larger treatment so it reads as the
 * priority, not a peer of 2 and 3.
 *
 * Second Lead catch, same day: delete used to sit inline next to complete
 * (✓ / 🗑 adjacent, no separation) — the single most destructive action on
 * the screen one mis-tap away from the most routine one, since deleting an
 * active target cascade-deletes its tasks (028's on delete cascade,
 * correct for an active target, but not something a fat finger should be
 * able to trigger with no recovery). Delete now lives only inside edit
 * mode, behind a confirmation naming the target — "editing is where you
 * go when you mean to change something," per the Lead.
 */
export function TargetRow({
  target,
  isTargetSlot,
  rank,
  now,
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
  /** 1/2/3 for a target slot, undefined for a stretch goal — stretch goals aren't ranked. */
  rank?: number;
  now: Date;
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isPriority = rank === 1;
  const deadlineInfo = target.deadline ? formatDaysLeft(target.deadline, now) : null;

  function handleSave() {
    const trimmed = title.trim();
    if (trimmed && trimmed !== target.title) onEdit(trimmed);
    setEditing(false);
  }

  function handleCancelEdit() {
    setTitle(target.title);
    setEditing(false);
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3",
        isPriority ? "border-accent-coop/40 bg-accent-coop/5 py-4" : "border-border/40 py-2"
      )}
    >
      <div className="flex items-start gap-2">
        {/* Was a vertical stack — two 44px buttons stacked doubled this
            row's height while rows with only one direction stayed short,
            which read as a rendering fault. Horizontal keeps every row
            the same height regardless of how many directions exist. */}
        {(canMoveUp || canMoveDown) && (
          <div className="flex shrink-0 gap-1">
            {canMoveUp && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-10"
                disabled={isPending}
                onClick={() => onMove("up")}
                aria-label="Move up"
              >
                <ChevronUp className="size-3.5" />
              </Button>
            )}
            {canMoveDown && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-10"
                disabled={isPending}
                onClick={() => onMove("down")}
                aria-label="Move down"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            )}
          </div>
        )}

        {rank !== undefined && (
          <span
            className={cn(
              "mt-0.5 flex shrink-0 items-center justify-center rounded-full font-mono font-semibold",
              isPriority ? "size-8 bg-accent-coop text-base text-white" : "size-6 bg-muted text-xs text-muted-foreground"
            )}
            aria-hidden
          >
            {rank}
          </span>
        )}

        <div className="flex flex-1 flex-col gap-1 pt-0.5">
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
            <span className={cn(isPriority ? "text-base font-semibold" : "text-sm font-medium")}>{target.title}</span>
          )}
          {deadlineInfo ? (
            <Badge variant={isPriority ? deadlineInfo.urgency : "neutral"}>
              {isPriority ? deadlineInfo.label : `Due ${target.deadline}`}
            </Badge>
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
        </div>
      </div>

      {editing && (
        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleCancelEdit}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 />
            Delete
          </Button>
        </div>
      )}

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this target?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            &ldquo;{target.title}&rdquo; and any tasks under it will be permanently removed. This can&apos;t be undone.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                setConfirmingDelete(false);
                setEditing(false);
                onRemove();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The empty, inviting placeholder for a target slot with nothing in it (spec ruling 6 — never reads as an error or a gap). Numbered like a filled slot so 2 and 3 are distinguishable from each other, not just from a filled row. */
export function EmptyTargetSlot({ slotNumber, onAdd }: { slotNumber: number; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-current font-mono text-xs" aria-hidden>
        {slotNumber}
      </span>
      + Add a target
    </button>
  );
}
