"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TargetRow, EmptyTargetSlot } from "@/components/co-op/target-row";
import { SetDeadlineDialog } from "@/components/co-op/set-deadline-dialog";
import { splitTargetsAndStretch, moveTargetPosition, TARGET_SLOT_COUNT, type CoopTargetRow } from "@/lib/coop/targets";
import { addTarget, addStretchGoal, editTarget, removeTarget, completeTarget, moveTarget } from "@/app/(app)/co-op/targets-actions";

// "use server" actions are imported and invoked directly from this client
// component rather than passed down as props from the server page — the
// pattern this codebase always uses to stay clear of the
// function-across-the-RSC-boundary restriction (AGENTS.md).
export function TargetsStrip({ rows }: { rows: CoopTargetRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [addingTarget, setAddingTarget] = useState(false);
  const [addingStretch, setAddingStretch] = useState(false);
  const [stretchExpanded, setStretchExpanded] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [deadlineDialog, setDeadlineDialog] = useState<{ targetId: string; targetTitle: string } | null>(null);

  const { targets, stretchGoals } = splitTargetsAndStretch(rows);
  const queueLength = rows.length;
  const now = new Date();

  function resetAddForms() {
    setAddingTarget(false);
    setAddingStretch(false);
    setNewTitle("");
    setNewDeadline("");
  }

  function handleAddTarget(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !newDeadline) return;
    startTransition(async () => {
      await addTarget(title, newDeadline);
      resetAddForms();
    });
  }

  function handleAddStretch(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    startTransition(async () => {
      await addStretchGoal(title);
      resetAddForms();
    });
  }

  function handleMove(id: string, currentPosition: number, direction: "up" | "down") {
    const next = moveTargetPosition(currentPosition, direction, queueLength);
    if (next === null) return;
    startTransition(() => moveTarget(id, next));
  }

  function handleComplete(id: string) {
    startTransition(async () => {
      const result = await completeTarget(id);
      if (result.promotedTargetId && result.promotedNeedsDeadline) {
        const promoted = rows.find((r) => r.id === result.promotedTargetId);
        setDeadlineDialog({ targetId: result.promotedTargetId, targetTitle: promoted?.title ?? "" });
      }
    });
  }

  // Spec: pre-target, the whole Targets/Agenda/Pipeline stack is exactly
  // one actionable element — no gated placeholders for Stretch Goals,
  // Agenda, or Pipeline. Once Target 1 exists the page grows the rest in
  // one action, not a reflow.
  if (queueLength === 0) {
    if (!addingTarget) {
      return (
        <button
          type="button"
          onClick={() => setAddingTarget(true)}
          className="flex w-full items-center justify-center rounded-2xl border border-dashed border-border/60 px-4 py-6 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          + Set your first target
        </button>
      );
    }
    return (
      <form onSubmit={handleAddTarget} className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
        <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Target title" autoFocus />
        <Input type="date" value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} />
        <div className="flex gap-2">
          <Button type="submit" disabled={isPending || !newTitle.trim() || !newDeadline}>
            Set target
          </Button>
          <Button type="button" variant="outline" onClick={resetAddForms}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {Array.from({ length: TARGET_SLOT_COUNT }, (_, i) => i + 1).map((slot) => {
          const target = targets.find((t) => t.position === slot);
          if (!target) {
            return <EmptyTargetSlot key={slot} slotNumber={slot} onAdd={() => setAddingTarget(true)} />;
          }
          return (
            <TargetRow
              key={target.id}
              target={target}
              isTargetSlot
              rank={slot}
              now={now}
              canMoveUp={moveTargetPosition(target.position, "up", queueLength) !== null}
              canMoveDown={moveTargetPosition(target.position, "down", queueLength) !== null}
              onMove={(direction) => handleMove(target.id, target.position, direction)}
              onComplete={() => handleComplete(target.id)}
              onEdit={(title) => startTransition(() => editTarget(target.id, { title }))}
              onRemove={() => startTransition(() => removeTarget(target.id))}
              onSetDeadline={() => setDeadlineDialog({ targetId: target.id, targetTitle: target.title })}
              isPending={isPending}
            />
          );
        })}
      </div>

      {addingTarget && targets.length < TARGET_SLOT_COUNT && (
        <form onSubmit={handleAddTarget} className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Target title" autoFocus />
          <Input type="date" value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending || !newTitle.trim() || !newDeadline}>
              Set target
            </Button>
            <Button type="button" variant="outline" onClick={resetAddForms}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setStretchExpanded((v) => !v)}
          className="flex items-center gap-1 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {stretchExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Stretch goals ({stretchGoals.length})
        </button>

        {stretchExpanded && (
          <div className="flex flex-col gap-2 pl-2">
            {stretchGoals.length === 0 && !addingStretch && (
              <p className="text-sm text-muted-foreground">No stretch goals yet</p>
            )}
            {stretchGoals.map((goal) => (
              <TargetRow
                key={goal.id}
                target={goal}
                isTargetSlot={false}
                now={now}
                canMoveUp={moveTargetPosition(goal.position, "up", queueLength) !== null}
                canMoveDown={moveTargetPosition(goal.position, "down", queueLength) !== null}
                onMove={(direction) => handleMove(goal.id, goal.position, direction)}
                onEdit={(title) => startTransition(() => editTarget(goal.id, { title }))}
                onRemove={() => startTransition(() => removeTarget(goal.id))}
                onSetDeadline={() => setDeadlineDialog({ targetId: goal.id, targetTitle: goal.title })}
                isPending={isPending}
              />
            ))}
            {addingStretch ? (
              <form onSubmit={handleAddStretch} className="flex gap-2">
                <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Stretch goal title" autoFocus />
                <Button type="submit" disabled={isPending || !newTitle.trim()}>
                  Add
                </Button>
                <Button type="button" variant="outline" onClick={resetAddForms}>
                  Cancel
                </Button>
              </form>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setAddingStretch(true)} className="w-fit">
                + Add a stretch goal
              </Button>
            )}
          </div>
        )}
      </div>

      {deadlineDialog && (
        <SetDeadlineDialog
          open
          onOpenChange={(open) => !open && setDeadlineDialog(null)}
          targetTitle={deadlineDialog.targetTitle}
          onSubmit={async (deadline) => {
            await editTarget(deadlineDialog.targetId, { deadline });
          }}
        />
      )}
    </div>
  );
}
