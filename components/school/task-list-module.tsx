"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Check, Pencil, Trash2 } from "lucide-react";
import { TASK_GROUP_ORDER, TASK_GROUP_LABEL, groupTasksByBucket, type TaskGroupKey } from "@/lib/tasks/task-groups";
import { TASK_TYPE_LABEL, TASK_TYPE_COLOR, TASK_TYPE_OPTIONS, type TaskType } from "@/lib/tasks/task-type";
import type { TaskWizardClassOption } from "./task-wizard-dialog";
import { formatShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export type TaskListItem = {
  id: string;
  title: string;
  dueDate: string | null;
  taskType: TaskType;
  taskTypeOtherLabel: string | null;
  classId: string | null;
  className: string | null;
};

function typeLabel(item: Pick<TaskListItem, "taskType" | "taskTypeOtherLabel">): string {
  return item.taskType === "other" && item.taskTypeOtherLabel ? item.taskTypeOtherLabel : TASK_TYPE_LABEL[item.taskType];
}

function TaskRow({
  task,
  todayStr,
  onComplete,
  editing,
  onEditTask,
  onRemoveTask,
}: {
  task: TaskListItem;
  todayStr: string;
  onComplete: () => Promise<void>;
  editing: boolean;
  onEditTask?: (id: string) => void;
  onRemoveTask?: (id: string) => void;
}) {
  const [justCompleted, setJustCompleted] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    // Completing is an immediate mutation and would fight the caller's
    // staged edit/remove model (Opus Lead ruling, C3) — inert while editing.
    if (editing || justCompleted || isPending) return;
    setJustCompleted(true);
    startTransition(async () => {
      try {
        await onComplete();
      } catch {
        setJustCompleted(false);
      }
    });
  }

  return (
    <li className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || editing}
        aria-label={`Mark "${task.title}" done`}
        // min-w-0 is load-bearing: without it, this flex-1 button's
        // automatic minimum size (min-width:auto) refuses to shrink below
        // its min-content — the whole task title — so a long title pushes
        // the row past the card instead of truncating. Same shape fixed in
        // task-row-list.tsx (6ff8e68) and kill-list.tsx; measured 2026-08-28.
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/50 disabled:cursor-default disabled:opacity-60"
      >
        <span
          aria-hidden
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300",
            justCompleted ? "border-accent-business bg-accent-business" : "border-border"
          )}
        >
          {justCompleted && <Check className="size-3.5 text-white" strokeWidth={3} />}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm transition-colors duration-300",
            justCompleted && "text-muted-foreground line-through decoration-accent-business"
          )}
        >
          {task.title}
        </span>
        <span className={cn("shrink-0 text-xs font-medium", TASK_TYPE_COLOR[task.taskType])}>{typeLabel(task)}</span>
        {task.className && <span className="shrink-0 text-xs text-muted-foreground">{task.className}</span>}
        {task.dueDate && <span className="shrink-0 text-xs text-muted-foreground">{formatShortDate(task.dueDate, todayStr)}</span>}
      </button>
      {editing && (
        <span className="flex shrink-0 gap-1 pr-2">
          <button
            type="button"
            onClick={() => onEditTask?.(task.id)}
            aria-label={`Edit ${task.title}`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onRemoveTask?.(task.id)}
            aria-label={`Remove ${task.title}`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </span>
      )}
    </li>
  );
}

function GroupSection({
  groupKey,
  tasks,
  todayStr,
  onComplete,
  editing,
  onEditTask,
  onRemoveTask,
}: {
  groupKey: TaskGroupKey;
  tasks: TaskListItem[];
  todayStr: string;
  onComplete: (id: string) => Promise<void>;
  editing: boolean;
  onEditTask?: (id: string) => void;
  onRemoveTask?: (id: string) => void;
}) {
  // Only "Today" starts expanded (Ayman: "by default, all groups except
  // 'Today' group should be collapsed") — every group, Today included,
  // stays independently toggleable, and filtering never touches this
  // state (Ayman: "filters are present doesn't mean the groups besides
  // 'Today' automatically get auto expanded, they still filter but still
  // stay collapsed").
  const [expanded, setExpanded] = useState(groupKey === "today");

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/50"
      >
        <span className="text-sm font-medium">
          {TASK_GROUP_LABEL[groupKey]}{" "}
          <span className="font-mono text-xs font-normal text-muted-foreground">· {tasks.length}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
      </button>
      {expanded &&
        (tasks.length === 0 ? (
          <p className="px-3 pb-1 text-xs text-muted-foreground">Nothing here</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                todayStr={todayStr}
                onComplete={() => onComplete(t.id)}
                editing={editing}
                onEditTask={onEditTask}
                onRemoveTask={onRemoveTask}
              />
            ))}
          </ul>
        ))}
    </div>
  );
}

/**
 * The unified Task list (2026-08-26 night batch 2, item 5) — merges the
 * old Deadlines panel and Task list panel into four collapsible groups
 * (Today/This Week/This Month/Future) with class/type/date filters. Add
 * (TaskWizardDialog) and Edit (TaskEditDialog) live in the caller's Panel
 * `controls` slot, not here — this component only renders the filter row
 * and the four groups.
 */
export function TaskListModule({
  tasks,
  classes,
  todayStr,
  weekDates,
  toggleTask,
  editing = false,
  onEditTask,
  onRemoveTask,
  hideClassFilter = false,
}: {
  tasks: TaskListItem[];
  classes: TaskWizardClassOption[];
  todayStr: string;
  weekDates: string[];
  toggleTask: (id: string) => Promise<void>;
  /**
   * A dumb editing mode (C3, Opus Lead ruling): this component holds no
   * staged state of its own — it renders exactly the `tasks` array it's
   * handed (the caller already reflects pending edits and omits pending
   * deletes) and only calls back. While true, tap-to-complete is inert —
   * completing is an immediate mutation and would fight the caller's
   * staged model.
   */
  editing?: boolean;
  onEditTask?: (id: string) => void;
  onRemoveTask?: (id: string) => void;
  /** Suppresses "Filter by class" when every task in `tasks` already
   * belongs to one class (the per-class expanded view, C4/R7) — an
   * "All classes" dropdown over a single-class list is the same
   * redundancy Ayman named in C2, just unlabeled. */
  hideClassFilter?: boolean;
}) {
  const [classFilter, setClassFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const hasFilters = classFilter !== "" || typeFilter !== "" || dateFilter !== "";

  function deselectAll() {
    setClassFilter("");
    setTypeFilter("");
    setDateFilter("");
  }

  const filtered = tasks.filter((t) => {
    if (classFilter !== "" && t.classId !== classFilter) return false;
    if (typeFilter !== "" && t.taskType !== typeFilter) return false;
    if (dateFilter !== "" && t.dueDate !== dateFilter) return false;
    return true;
  });

  const groups = groupTasksByBucket(filtered, todayStr, weekDates);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {!hideClassFilter && (
          <select
            aria-label="Filter by class"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
        >
          <option value="">All types</option>
          {TASK_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="Filter by date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
        />
        {hasFilters && (
          <button
            type="button"
            onClick={deselectAll}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Deselect filters
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {TASK_GROUP_ORDER.map((key) => (
          <GroupSection
            key={key}
            groupKey={key}
            tasks={groups[key]}
            todayStr={todayStr}
            onComplete={toggleTask}
            editing={editing}
            onEditTask={onEditTask}
            onRemoveTask={onRemoveTask}
          />
        ))}
      </div>
    </div>
  );
}
