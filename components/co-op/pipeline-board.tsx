"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskCard } from "@/components/co-op/task-card";
import { PastCompletedDialog } from "@/components/co-op/past-completed-dialog";
import { usePipeline } from "@/components/co-op/pipeline-context";
import { groupByStage, blockedTasks, type CoopTaskStatus } from "@/lib/coop/tasks";
import type { CoopTaskRow } from "@/lib/coop/tasks";

const COLUMN_LABELS: Record<Exclude<CoopTaskStatus, "blocked">, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  complete: "Complete",
};

/**
 * The status view over the SAME task rows the Weekly Agenda's add-task
 * form feeds (Opus Lead ruling 1) — Backlog -> In Progress -> Review ->
 * Complete, plus a detached Blocked section (ruling 2: blocked is a
 * pause, not a fifth column in the sequence — pulled out of the linear
 * layout entirely rather than shown inline with a badge, so "detached" is
 * structural, not just visual).
 *
 * Reads its task list from PipelineProvider's optimistic state (item 1,
 * batch 5) rather than a plain `tasks` prop — a card must move columns on
 * the same frame as the tap, not once the server round trip lands.
 * `pastTasks` stays a plain prop: the 7-day Past boundary is a server-side
 * classification (lib/coop/tasks.ts's splitByPastComplete) that can't
 * change mid-session from a client mutation, so there's nothing to make
 * optimistic there.
 */
export function PipelineBoard({ pastTasks }: { pastTasks: CoopTaskRow[] }) {
  const { tasks, taskActions } = usePipeline();
  const [blockedExpanded, setBlockedExpanded] = useState(true);
  const [pastOpen, setPastOpen] = useState(false);
  const columns = groupByStage(tasks);
  const blocked = blockedTasks(tasks);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-4 md:overflow-visible">
        {(Object.keys(COLUMN_LABELS) as Exclude<CoopTaskStatus, "blocked">[]).map((stage) => (
          <div key={stage} className="w-[70vw] shrink-0 snap-start md:w-auto">
            <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-2">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                  {COLUMN_LABELS[stage]} ({columns[stage].length})
                </span>
                {stage === "complete" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground"
                    onClick={() => setPastOpen(true)}
                  >
                    Past ({pastTasks.length})
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {columns[stage].length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">Empty</p>}
                {columns[stage].map((task) => (
                  <TaskCard key={task.id} task={task} {...taskActions(task)} />
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
              <TaskCard key={task.id} task={task} {...taskActions(task)} />
            ))}
          </div>
        )}
      </div>

      <PastCompletedDialog open={pastOpen} onOpenChange={setPastOpen} tasks={pastTasks} />
    </div>
  );
}
