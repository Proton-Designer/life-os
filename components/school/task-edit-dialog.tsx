"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TASK_TYPE_OPTIONS, TASK_TYPE_LABEL, TASK_TYPE_COLOR, dateFieldLabel, type TaskType } from "@/lib/tasks/task-type";
import type { TaskWizardClassOption } from "./task-wizard-dialog";
import type { TaskListItem } from "./task-list-module";
import { cn } from "@/lib/utils";

export type TaskUpdateInput = {
  title: string;
  dueDate?: string;
  taskType?: TaskType;
  taskTypeOtherLabel?: string;
  classId?: string | null;
};

type EditForm = { title: string; dueDate: string; taskType: TaskType; taskTypeOtherLabel: string; classId: string };

function formFromTask(t: TaskListItem): EditForm {
  return {
    title: t.title,
    dueDate: t.dueDate ?? "",
    taskType: t.taskType,
    taskTypeOtherLabel: t.taskTypeOtherLabel ?? "",
    classId: t.classId ?? "",
  };
}

/**
 * Item 5's Edit popup (2026-08-26 night batch 2): "remove any task from
 * any group, or change the contents of any task." A flat, sorted list
 * rather than the four visual groups the main module shows — this is a
 * maintenance view, not a second copy of the grouped display.
 */
export function TaskEditDialog({
  tasks,
  classes,
  updateTask,
  removeTask,
}: {
  tasks: TaskListItem[];
  classes: TaskWizardClassOption[];
  updateTask: (id: string, input: TaskUpdateInput) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sorted = [...tasks].sort((a, b) => {
    if (a.dueDate === b.dueDate) return 0;
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setEditingId(null);
      setForm(null);
      setError(null);
    }
  }

  function startEdit(t: TaskListItem) {
    setEditingId(t.id);
    setForm(formFromTask(t));
    setError(null);
  }

  function handleSave() {
    if (!editingId || !form) return;
    const title = form.title.trim();
    if (!title) {
      setError("Enter a description");
      return;
    }
    if (!form.dueDate) {
      setError(`Enter a ${dateFieldLabel(form.taskType).toLowerCase()}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateTask(editingId, {
          title,
          dueDate: form.dueDate,
          taskType: form.taskType,
          taskTypeOtherLabel: form.taskType === "other" ? form.taskTypeOtherLabel.trim() || undefined : undefined,
          classId: form.classId || null,
        });
        setEditingId(null);
        setForm(null);
      } catch {
        setError("Couldn't save — try again");
      }
    });
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      try {
        await removeTask(id);
      } catch {
        setError("Couldn't remove — try again");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit task list</DialogTitle>
        </DialogHeader>
        <div className="-mx-1 flex min-h-0 flex-col gap-2 overflow-y-auto px-1">
          {sorted.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nothing here yet</p>
          ) : (
            sorted.map((t) =>
              editingId === t.id && form ? (
                <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
                  <Input
                    value={form.title}
                    onChange={(e) => setForm((f) => f && { ...f, title: e.target.value })}
                    placeholder="Description"
                  />
                  <div className="flex gap-2">
                    <select
                      value={form.taskType}
                      onChange={(e) => setForm((f) => f && { ...f, taskType: e.target.value as TaskType })}
                      className="flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                    >
                      {TASK_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={form.classId}
                      onChange={(e) => setForm((f) => f && { ...f, classId: e.target.value })}
                      className="flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                    >
                      <option value="">Generic</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {form.taskType === "other" && (
                    <Input
                      value={form.taskTypeOtherLabel}
                      onChange={(e) => setForm((f) => f && { ...f, taskTypeOtherLabel: e.target.value })}
                      placeholder="Describe the type"
                    />
                  )}
                  <Input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((f) => f && { ...f, dueDate: e.target.value })}
                  />
                  {error && <p className="text-xs text-destructive">{error}</p>}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingId(null);
                        setForm(null);
                        setError(null);
                      }}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleSave} disabled={isPending}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm">{t.title}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className={cn("font-medium", TASK_TYPE_COLOR[t.taskType])}>
                        {t.taskType === "other" && t.taskTypeOtherLabel ? t.taskTypeOtherLabel : TASK_TYPE_LABEL[t.taskType]}
                      </span>
                      {t.className && ` · ${t.className}`}
                      {t.dueDate && ` · ${t.dueDate}`}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      aria-label={`Edit ${t.title}`}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(t.id)}
                      disabled={isPending}
                      aria-label={`Remove ${t.title}`}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              )
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
