"use client";

import { createContext, useContext, useOptimistic, useState, useTransition, type ReactNode } from "react";
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
  error: string | null;
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
  // If a Server Action throws mid-transition, React reverts the optimistic
  // value on its own — that part needs no help. What it does NOT do is stop
  // the throw from propagating; left unhandled, that crashes the nearest
  // error boundary (or the whole route, on one with none) instead of just
  // snapping the card back. Every mutation below is wrapped so the revert
  // is the whole story, and the user sees why, the same shape as
  // LockInOverlayProvider's `error` slot.
  const [error, setError] = useState<string | null>(null);

  function addTask(title: string, deadline?: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
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
      try {
        await addAgendaTask(targetId, trimmed, deadline);
      } catch {
        setError(`Couldn't add "${trimmed}" — it's been removed. Try again.`);
      }
    });
  }

  function taskActions(task: CoopTaskRow) {
    const status = task.status as Exclude<CoopTaskStatus, "blocked">;
    const blockedFrom = task.blockedFrom;
    return {
      onAdvance: () => {
        const next = nextStage(status);
        if (!next) return;
        setError(null);
        startTransition(async () => {
          dispatch({ type: "setStatus", id: task.id, status: next });
          try {
            await advanceTask(task.id, status);
          } catch {
            setError(`Couldn't move "${task.title}" — it's back where it was.`);
          }
        });
      },
      onRetreat: () => {
        const prev = previousStage(status);
        if (!prev) return;
        setError(null);
        startTransition(async () => {
          dispatch({ type: "setStatus", id: task.id, status: prev });
          try {
            await retreatTask(task.id, status);
          } catch {
            setError(`Couldn't move "${task.title}" — it's back where it was.`);
          }
        });
      },
      onBlock: () => {
        setError(null);
        startTransition(async () => {
          dispatch({ type: "block", id: task.id, blockedFrom: status });
          try {
            await blockTask(task.id, status);
          } catch {
            setError(`Couldn't block "${task.title}" — it's back where it was.`);
          }
        });
      },
      onUnblock: () => {
        if (!blockedFrom) return;
        setError(null);
        startTransition(async () => {
          dispatch({ type: "setStatus", id: task.id, status: blockedFrom });
          try {
            await unblockTask(task.id, blockedFrom);
          } catch {
            setError(`Couldn't unblock "${task.title}" — it's back where it was.`);
          }
        });
      },
      onEdit: (newTitle: string) => {
        setError(null);
        startTransition(async () => {
          dispatch({ type: "edit", id: task.id, title: newTitle });
          try {
            await editTask(task.id, { title: newTitle });
          } catch {
            setError(`Couldn't rename "${task.title}" — the old title is back.`);
          }
        });
      },
      onRemove: () => {
        setError(null);
        startTransition(async () => {
          dispatch({ type: "remove", id: task.id });
          try {
            await removeTask(task.id);
          } catch {
            setError(`Couldn't delete "${task.title}" — it's back.`);
          }
        });
      },
    };
  }

  return (
    <PipelineContext.Provider value={{ tasks, isPending, error, addTask, taskActions }}>
      {children}
    </PipelineContext.Provider>
  );
}
