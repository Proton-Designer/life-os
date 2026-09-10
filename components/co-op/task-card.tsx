"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Pencil, Trash2, Lock, LockOpen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nextStage, previousStage, type CoopTaskRow } from "@/lib/coop/tasks";
import { localDateString, formatDurationMagnitude, formatShortDate } from "@/lib/date-utils";

/**
 * One task card — shared by the Agenda's add-task flow and the pipeline
 * board. Buttons, not drag (matching the Targets strip's move controls —
 * same touch-conflict reasoning: this app uses horizontal snap-scroll
 * containers elsewhere).
 *
 * Remove lives only in edit mode, behind a confirmation, mirroring the
 * fix the Opus Lead required on the Targets strip (delete next to a
 * routine action is a mis-tap generator) — applied here proactively
 * rather than waiting for the same catch twice, even though a task
 * delete has a smaller blast radius than a target delete (no cascade).
 *
 * No `isPending`-driven `disabled` on the stage buttons (item 1, batch
 * 5) — the caller's optimistic state already moves this card the instant
 * a button is tapped, so `task` itself reflects the new status before the
 * server round trip returns. Disabling on `isPending` was the whole bug:
 * every card froze for the full 1-2s mutation instead of moving on the
 * same frame as the tap.
 */
export function TaskCard({
  task,
  onAdvance,
  onRetreat,
  onBlock,
  onUnblock,
  onEdit,
  onRemove,
  timezone,
  now = new Date(),
}: {
  task: CoopTaskRow;
  onAdvance: () => void;
  onRetreat: () => void;
  onBlock: (reason?: string) => void;
  onUnblock: () => void;
  onEdit: (title: string) => void;
  onRemove: () => void;
  timezone: string;
  /** Injectable for deterministic tests; defaults to the real current instant. */
  now?: Date;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [showingBlockedDetail, setShowingBlockedDetail] = useState(false);
  const isBlocked = task.status === "blocked";
  const canAdvance = !isBlocked && nextStage(task.status as Exclude<typeof task.status, "blocked">) !== null;
  const canRetreat = !isBlocked && previousStage(task.status as Exclude<typeof task.status, "blocked">) !== null;

  function handleConfirmBlock() {
    onBlock(blockReason);
    setBlocking(false);
    setBlockReason("");
  }

  function handleSave() {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) onEdit(trimmed);
    setEditing(false);
  }

  function handleCancelEdit() {
    setTitle(task.title);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/40 p-2.5">
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
        <span className="text-sm font-medium">{task.title}</span>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {task.deadline && <Badge variant="neutral">Due {task.deadline}</Badge>}
        {isBlocked && (
          // A real <button>, not a static Badge — the board is keyboard-
          // reachable and this is the one thing on a blocked card that
          // says "there's more here." Pressing it discloses what it's
          // blocked on rather than expanding the card in place, which
          // would shift card height inside the horizontally-scrolling
          // pipeline columns.
          <button type="button" onClick={() => setShowingBlockedDetail(true)} aria-label="Blocked — view what it's blocked on and since when">
            <Badge variant="warning">Blocked</Badge>
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        {isBlocked ? (
          <Button type="button" variant="outline" size="sm" onClick={onUnblock}>
            <LockOpen /> Unblock
          </Button>
        ) : (
          // Icon-only + unlabelled read as ambiguous cold (Opus Lead,
          // 2026-08-20) — the lock in particular isn't an obvious "waiting
          // on someone else," and it sat one tap from the arrows that move
          // real work. Visible text on all three now, not just Advance.
          <>
            {canRetreat && (
              <Button type="button" variant="ghost" size="sm" onClick={onRetreat} aria-label="Move back a stage">
                <ArrowLeft /> Back
              </Button>
            )}
            {canAdvance && (
              <Button type="button" variant="ghost" size="sm" onClick={onAdvance} aria-label="Advance a stage">
                <ArrowRight /> Next
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setBlocking(true)}
              aria-label="Mark blocked — waiting on something outside your control"
            >
              <Lock /> Block
            </Button>
          </>
        )}
        {!editing && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Edit title">
            <Pencil />
          </Button>
        )}
      </div>

      {editing && (
        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5">
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
            <DialogTitle>Delete this task?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            &ldquo;{task.title}&rdquo; will be permanently removed. This can&apos;t be undone.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
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

      <Dialog
        open={blocking}
        onOpenChange={(open) => {
          setBlocking(open);
          if (!open) setBlockReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark this task blocked</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`block-reason-${task.id}`}>What&apos;s it blocked on? (optional)</Label>
            <Input
              id={`block-reason-${task.id}`}
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleConfirmBlock()}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setBlocking(false)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={handleConfirmBlock}>
              Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showingBlockedDetail} onOpenChange={setShowingBlockedDetail}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Blocked</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{task.blockedReason ?? "No reason given"}</p>
          <p className="text-xs text-muted-foreground">
            {task.blockedSince
              ? `${formatDurationMagnitude((now.getTime() - new Date(task.blockedSince).getTime()) / 60_000)} ago · ${formatShortDate(
                  localDateString(new Date(task.blockedSince), timezone),
                  localDateString(now, timezone)
                )}`
              : "blocked, start date not recorded"}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
