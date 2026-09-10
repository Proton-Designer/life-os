"use client";

import { useLockInOverlay } from "./lock-in-overlay-context";
import type { SessionObjective } from "@/lib/business/session-objectives";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The overlay's own checklist of the objectives HE chose at setup (146,
 * Phase 4) — not the whole kill list. Replaces `LockInKillList` for any
 * goal-based session (lock-in-overlay.tsx's own comment explains why
 * `session.goalMinutes !== null`, not `objectives.length > 0`, is the
 * actual switch — a goal-based session with zero objectives picked still
 * gets this component, which correctly renders nothing for it, rather than
 * falling back to the old full-kill-list view).
 *
 * Each row calls the context's `toggleObjective`, which is already
 * optimistic and write-through (kill_list_item/task kinds toggle the real
 * underlying row via toggleSessionObjectiveCore; only kind='custom' writes
 * this table's own `completed`) — this component has no state of its own
 * to manage, it just reflects `session.objectives`, which the provider
 * already keeps current.
 *
 * The single custom objective (at most one, DB-enforced) is NOT rendered
 * here — it's the caller's job to pull it out and render it as the
 * headline above the kind label (Ayman: it "renders ABOVE the DEEP WORK/
 * DEEP STUDY title"). This component only ever receives the rest.
 */
export function LockInObjectives({ objectives, className }: { objectives: SessionObjective[]; className?: string }) {
  const { toggleObjective } = useLockInOverlay();
  if (objectives.length === 0) return null;

  return (
    <div className={className}>
      {objectives.map((objective) => (
        <LockInObjectiveItem key={objective.id} objective={objective} onToggle={() => toggleObjective(objective.id)} />
      ))}
    </div>
  );
}

function LockInObjectiveItem({ objective, onToggle }: { objective: SessionObjective; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={objective.completed}
      aria-label={objective.completed ? `Mark "${objective.label}" incomplete` : `Mark "${objective.label}" complete`}
      // Same visual language as lock-in-kill-list.tsx's own item (pill,
      // border-foreground/20, min-w-0 for the same mobile-truncation
      // reason kill-list.tsx and task-row-list.tsx both already document) —
      // this replaces that component for goal-based sessions, so it should
      // not look like a different control.
      className={cn(
        "flex min-w-0 max-w-full items-center gap-2 rounded-full border border-foreground/20 bg-background/10 px-3 py-1.5 text-left text-sm text-foreground transition-colors",
        "hover:bg-background/20"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-4 shrink-0 rounded-full border transition-colors",
          objective.completed ? "border-foreground bg-foreground" : "border-foreground/50"
        )}
      />
      <span className={cn("min-w-0 flex-1 truncate", objective.completed && "text-foreground/50 line-through")}>
        {objective.label}
      </span>
      {objective.completed && <Badge variant="positive">Done</Badge>}
    </button>
  );
}
