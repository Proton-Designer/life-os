"use client";

import { createContext, useContext, useOptimistic, useTransition, type ReactNode } from "react";
import {
  nextStage,
  previousStage,
  type CoopTaskRow,
  type CoopTaskStatus,
} from "@/lib/coop/tasks";
import {
  addAgendaTask,
  editTask,
  removeTask,
  advanceTask,
  retreatTask,
  blockTask,
  unblockTask,
} from "@/app/(app)/work/tasks-actions";

/**
 * Item 1 (batch 5): the whole 1-2s "frozen button" feel came from having
 * no optimistic state at all — every card just sat disabled until the
 * revalidated RSC payload came back. This provider is the fix, and it has
 * to be a shared ancestor of BOTH the pipeline board and the "+ Add a
 * task" control, because those are two independent props Panel places in
 * different slots (`children` vs `controls`) from a Server Component —
 * they can't share plain lifted state, only a context both sides read
 * (same shape as LockInOverlayProvider elsewhere in this app).
 */

type OptimisticAction =
  | { type: "setStatus"; id: string; status: Exclude<CoopTaskStatus, "blocked"> }
  | { type: "block"; id: string; blockedFrom: Exclude<CoopTaskStatus, "blocked"> }
  | { type: "edit"; id: string; title: string }
  | { type: "remove"; id: string }
  | { type: "add"; task: CoopTaskRow };

function reduce(tasks: CoopTaskRow[], action: OptimisticAction): CoopTaskRow[] {
  switch (action.type) {
    case "setStatus":
      return tasks.map((t) => (t.id === action.id ? { ...t, status: action.status, blockedFrom: null } : t));
    case "block":
      return tasks.map((t) => (t.id === action.id ? { ...t, status: "blocked", blockedFrom: action.blockedFrom } : t));
    case "edit":
      return tasks.map((t) => (t.id === action.id ? { ...t, title: action.title } : t));
    case "remove":
      return tasks.filter((t) => t.id !== action.id);
    case "add":
      return [...tasks, action.task];
  }
}

type PipelineContextValue = {
  tasks: CoopTaskRow[];
  isPending: boolean;
  addTask: (title: string, deadline?: string) => void;
  taskActions: (task: CoopTaskRow) => {
    onAdvance: () => void;
    onRetreat: () => void;
    onBlock: () => void;
    onUnblock: () => void;
    onEdit: (title: string) => void;
    onRemove: () => void;
  };
};

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline must be used within a PipelineProvider");
  return ctx;
}

export function PipelineProvider({
  targetId,
  initialTasks,
  children,
}: {
  targetId: string;
  initialTasks: CoopTaskRow[];
  children: ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [tasks, dispatch] = useOptimistic(initialTasks, reduce);

  function addTask(title: string, deadline?: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    startTransition(async () => {
      dispatch({
        type: "add",
        task: {
          id: `optimistic-${crypto.randomUUID()}`,
          title: trimmed,
          deadline: deadline ?? null,
          status: "backlog",
          blockedFrom: null,
          createdAt: new Date().toISOString(),
          completedAt: null,
        },
      });
      await addAgendaTask(targetId, trimmed, deadline);
    });
  }

  function taskActions(task: CoopTaskRow) {
    const status = task.status as Exclude<CoopTaskStatus, "blocked">;
    const blockedFrom = task.blockedFrom;
    return {
      onAdvance: () => {
        const next = nextStage(status);
        if (!next) return;
        startTransition(async () => {
          dispatch({ type: "setStatus", id: task.id, status: next });
          await advanceTask(task.id, status);
        });
      },
      onRetreat: () => {
        const prev = previousStage(status);
        if (!prev) return;
        startTransition(async () => {
          dispatch({ type: "setStatus", id: task.id, status: prev });
          await retreatTask(task.id, status);
        });
      },
      onBlock: () => {
        startTransition(async () => {
          dispatch({ type: "block", id: task.id, blockedFrom: status });
          await blockTask(task.id, status);
        });
      },
      onUnblock: () => {
        if (!blockedFrom) return;
        startTransition(async () => {
          dispatch({ type: "setStatus", id: task.id, status: blockedFrom });
          await unblockTask(task.id, blockedFrom);
        });
      },
      onEdit: (newTitle: string) => {
        startTransition(async () => {
          dispatch({ type: "edit", id: task.id, title: newTitle });
          await editTask(task.id, { title: newTitle });
        });
      },
      onRemove: () => {
        startTransition(async () => {
          dispatch({ type: "remove", id: task.id });
          await removeTask(task.id);
        });
      },
    };
  }

  return (
    <PipelineContext.Provider value={{ tasks, isPending, addTask, taskActions }}>{children}</PipelineContext.Provider>
  );
}
