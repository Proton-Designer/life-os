"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskCard } from "@/components/co-op/task-card";
import { groupByStage, blockedTasks, type CoopTaskRow, type CoopTaskStatus } from "@/lib/coop/tasks";
import { editTask, removeTask, advanceTask, retreatTask, blockTask, unblockTask } from "@/app/(app)/co-op/tasks-actions";

const COLUMN_LABELS: Record<Exclude<CoopTaskStatus, "blocked">, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  complete: "Complete",
};

/**
 * The status view over the SAME task rows the Weekly Agenda lists (Opus
 * Lead ruling 1) — Backlog -> In Progress -> Review -> Complete, plus a
 * detached Blocked section (ruling 2: blocked is a pause, not a fifth
 * column in the sequence — pulled out of the linear layout entirely
 * rather than shown inline with a badge, so "detached" is structural,
 * not just visual).
 */
export function PipelineBoard({ tasks }: { tasks: CoopTaskRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [blockedExpanded, setBlockedExpanded] = useState(true);
  const columns = groupByStage(tasks);
  const blocked = blockedTasks(tasks);

  function taskActions(task: CoopTaskRow) {
    const status = task.status as Exclude<CoopTaskStatus, "blocked">;
    const blockedFrom = task.blockedFrom;
    return {
      onAdvance: () => startTransition(() => advanceTask(task.id, status)),
      onRetreat: () => startTransition(() => retreatTask(task.id, status)),
      onBlock: () => startTransition(() => blockTask(task.id, status)),
      onUnblock: () => {
        if (blockedFrom) startTransition(() => unblockTask(task.id, blockedFrom));
      },
      onEdit: (newTitle: string) => startTransition(() => editTask(task.id, { title: newTitle })),
      onRemove: () => startTransition(() => removeTask(task.id)),
    };
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-4 md:overflow-visible">
        {(Object.keys(COLUMN_LABELS) as Exclude<CoopTaskStatus, "blocked">[]).map((stage) => (
          <div key={stage} className="w-[70vw] shrink-0 snap-start md:w-auto">
            <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-2">
              <span className="text-xs font-medium text-muted-foreground">
                {COLUMN_LABELS[stage]} ({columns[stage].length})
              </span>
              <div className="flex flex-col gap-2">
                {columns[stage].length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">Empty</p>}
                {columns[stage].map((task) => (
                  <TaskCard key={task.id} task={task} isPending={isPending} {...taskActions(task)} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setBlockedExpanded((v) => !v)}
          className="flex items-center gap-1 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {blockedExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Blocked ({blocked.length})
        </button>
        {blockedExpanded && (
          <div className="flex flex-col gap-2 pl-2">
            {blocked.length === 0 && <p className="text-sm text-muted-foreground">Nothing blocked</p>}
            {blocked.map((task) => (
              <TaskCard key={task.id} task={task} isPending={isPending} {...taskActions(task)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
