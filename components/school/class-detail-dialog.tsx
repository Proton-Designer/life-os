"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  updateClass,
  addClassAssessment,
  updateClassAssessment,
  deleteClassAssessment,
  type AssessmentType,
} from "@/app/(app)/school/class-actions";
import { addTask, updateTask, removeTask, toggleTask } from "@/app/(app)/school/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClassAssessments, type ClassAssessment } from "@/components/school/class-assessments";
import { SyllabusPanel } from "@/components/school/syllabus-panel";
import { TaskListModule, type TaskListItem } from "@/components/school/task-list-module";
import { TaskWizardDialog, type TaskWizardSubmitInput } from "@/components/school/task-wizard-dialog";
import { TASK_TYPE_OPTIONS, TASK_TYPE_LABEL, dateFieldLabel, type TaskType } from "@/lib/tasks/task-type";
import { localDateString, getWeekStartDate, weekDatesFrom } from "@/lib/date-utils";
import type { ClassCardData } from "@/lib/school/get-class-cards";

function mapAssessments(source: ClassCardData["assessments"]): ClassAssessment[] {
  return source.map((a) => ({ id: a.id, name: a.name, type: a.type as AssessmentType, date: a.date, task_id: a.taskId }));
}

function mapTasks(source: ClassCardData["tasks"], className: string): TaskListItem[] {
  return source.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate,
    taskType: (t.taskType ?? "other") as TaskType,
    taskTypeOtherLabel: t.taskTypeOtherLabel,
    classId: t.classId,
    className,
  }));
}

type TaskDraft = { title: string; dueDate: string; taskType: TaskType; taskTypeOtherLabel: string };

/**
 * The expanded class view (B1/B2/B3 redesign, 2026-08-26 afternoon batch).
 *
 * B3 (instant load): renders straight from `classData.assessments`/`.tasks`
 * (A widened getClassCards to carry them, item A2) — no useEffect fetch, no
 * "Loading…" state, zero round-trips on open.
 *
 * B2 (consolidated editing): `editing` gates changes to EXISTING rows —
 * course details, per-row assessment/task edits, and Remove — which stage
 * into local state and only commit on the header's Save (deletes, then
 * updates — Opus Lead ruling), or discard on Cancel with no network calls
 * at all. Add (both assessments and tasks) is available regardless of
 * `editing` and commits immediately: it creates a new, independent row
 * rather than modifying one that already exists, so it was never part of
 * the staged contract — see handleAddAssessment/handleAddTask. Syllabus is
 * the other deliberate exception, for a different reason — file uploads
 * can't be staged client-side — so SyllabusPanel keeps writing through
 * immediately and only gates its mutating buttons behind `editing`.
 *
 * Deleting an assessment also deletes its linked task (existing RPC,
 * R5's inverse) — `implicitlyDeletedTaskIds` in handleSave keeps a
 * same-session staged edit/remove of that same task from double-acting on
 * a row that's already gone.
 */
export function ClassDetailDialog({
  open,
  onOpenChange,
  classData,
  timezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classData: ClassCardData;
  /** IANA timezone — "today"/"this week" for the class task list are
   * derived through this (AGENTS.md), never a bare `new Date()` day. */
  timezone: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const displayName = classData.shortName ?? classData.code;
  const todayStr = localDateString(new Date(), timezone);
  const weekDates = weekDatesFrom(getWeekStartDate(todayStr));

  const [shortName, setShortName] = useState(classData.shortName ?? "");
  const [room, setRoom] = useState(classData.room ?? "");
  const [instructor, setInstructor] = useState(classData.instructor ?? "");
  const [assessments, setAssessments] = useState<ClassAssessment[]>(() => mapAssessments(classData.assessments));
  const [tasks, setTasks] = useState<TaskListItem[]>(() => mapTasks(classData.tasks, displayName));

  // Resyncs staged state from fresh server props — on initial open, and
  // again once a Save's router.refresh() lands new classData. Skipped while
  // `editing` so a background refresh (another tab, another agent) can
  // never clobber in-progress, unsaved edits.
  useEffect(() => {
    if (editing) return;
    setShortName(classData.shortName ?? "");
    setRoom(classData.room ?? "");
    setInstructor(classData.instructor ?? "");
    setAssessments(mapAssessments(classData.assessments));
    setTasks(mapTasks(classData.tasks, displayName));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `displayName` is derived from classData itself, not an independent input
  }, [classData, editing]);

  const originalAssessmentsRef = useRef<ClassAssessment[]>(assessments);
  const originalTasksRef = useRef<TaskListItem[]>(tasks);

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);

  function startEditing() {
    originalAssessmentsRef.current = assessments;
    originalTasksRef.current = tasks;
    setSaveError(null);
    setEditing(true);
  }

  function handleCancel() {
    setShortName(classData.shortName ?? "");
    setRoom(classData.room ?? "");
    setInstructor(classData.instructor ?? "");
    setAssessments(originalAssessmentsRef.current);
    setTasks(originalTasksRef.current);
    setSaveError(null);
    setEditingTaskId(null);
    setTaskDraft(null);
    setEditing(false);
  }

  // Add commits immediately (not staged — see class-assessments.tsx's own
  // doc comment for why). router.refresh() re-fetches classData, but the
  // resync effect above is deliberately paused while `editing` so it can't
  // clobber an in-progress staged edit — so if Add is used mid-edit, the
  // new row won't visibly appear until Save/Cancel ends the session. That's
  // an accepted limitation: the alternative (reconciling a placeholder id
  // against Save's remove/update diffing) risks a far worse bug — a
  // same-session Remove of a still-placeholder row calling the delete
  // action with an id the server has never seen.
  async function handleAddAssessment(input: { name: string; type: AssessmentType; date: string }) {
    await addClassAssessment(classData.id, input.name, input.type, input.date);
    router.refresh();
  }
  function handleUpdateAssessment(id: string, patch: Partial<{ name: string; type: AssessmentType; date: string }>) {
    setAssessments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  function handleRemoveAssessment(id: string) {
    setAssessments((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleToggle(id: string) {
    await toggleTask(id);
    router.refresh();
  }

  // Same immediate-commit reasoning as handleAddAssessment above.
  async function handleAddTask(input: TaskWizardSubmitInput) {
    await addTask({
      title: input.title,
      dueDate: input.dueDate,
      taskType: input.taskType,
      taskTypeOtherLabel: input.taskTypeOtherLabel,
      classId: input.classId,
    });
    router.refresh();
  }

  function handleEditTaskRequest(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    setEditingTaskId(id);
    setTaskDraft({
      title: t.title,
      dueDate: t.dueDate ?? "",
      taskType: t.taskType,
      taskTypeOtherLabel: t.taskTypeOtherLabel ?? "",
    });
  }
  function handleRemoveTaskRequest(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }
  function closeTaskDraft() {
    setEditingTaskId(null);
    setTaskDraft(null);
  }
  function submitTaskDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTaskId || !taskDraft) return;
    const title = taskDraft.title.trim();
    if (!title || !taskDraft.dueDate) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === editingTaskId
          ? {
              ...t,
              title,
              dueDate: taskDraft.dueDate,
              taskType: taskDraft.taskType,
              taskTypeOtherLabel: taskDraft.taskType === "other" ? taskDraft.taskTypeOtherLabel.trim() || null : null,
            }
          : t
      )
    );
    closeTaskDraft();
  }

  function handleSave() {
    setSaveError(null);
    startTransition(async () => {
      try {
        const detailsChanged =
          shortName.trim() !== (classData.shortName ?? "") ||
          room.trim() !== (classData.room ?? "") ||
          instructor.trim() !== (classData.instructor ?? "");

        // Add (both sections) commits immediately outside this flow — see
        // handleAddAssessment/handleAddTask — so there is no staged-insert
        // branch here. Only removes and updates of EXISTING rows are staged.
        const originalAssessments = originalAssessmentsRef.current;
        const originalAssessmentById = new Map(originalAssessments.map((a) => [a.id, a]));
        const currentAssessmentIds = new Set(assessments.map((a) => a.id));
        const assessmentsToRemove = originalAssessments.filter((a) => !currentAssessmentIds.has(a.id));
        const assessmentsToUpdate = assessments.filter((a) => {
          const orig = originalAssessmentById.get(a.id);
          return orig !== undefined && (orig.name !== a.name || orig.type !== a.type || orig.date !== a.date);
        });

        // A removed assessment's own delete RPC also deletes its linked
        // task — never independently act on that same task id below.
        const implicitlyDeletedTaskIds = new Set(
          assessmentsToRemove.map((a) => a.task_id).filter((id): id is string => id !== null)
        );

        const originalTasks = originalTasksRef.current;
        const originalTaskById = new Map(originalTasks.map((t) => [t.id, t]));
        const currentTaskIds = new Set(tasks.map((t) => t.id));
        const tasksToRemove = originalTasks.filter(
          (t) => !currentTaskIds.has(t.id) && !implicitlyDeletedTaskIds.has(t.id)
        );
        const tasksToUpdate = tasks.filter((t) => {
          if (implicitlyDeletedTaskIds.has(t.id)) return false;
          const orig = originalTaskById.get(t.id);
          return (
            orig !== undefined &&
            (orig.title !== t.title ||
              orig.dueDate !== t.dueDate ||
              orig.taskType !== t.taskType ||
              orig.taskTypeOtherLabel !== t.taskTypeOtherLabel ||
              orig.classId !== t.classId)
          );
        });

        // Deletes, then updates — one ordered pass across both assessments
        // and tasks rather than two independent passes, so a staged "delete
        // assessment X, update task Y" can't interleave badly (Opus Lead
        // ruling; the pass collapsed from three phases to two once inserts
        // could no longer be staged).
        for (const a of assessmentsToRemove) await deleteClassAssessment(a.id);
        for (const t of tasksToRemove) await removeTask(t.id);

        if (detailsChanged) {
          await updateClass(classData.id, {
            shortName: shortName.trim() || null,
            room: room.trim() || null,
            instructor: instructor.trim() || null,
          });
        }
        for (const a of assessmentsToUpdate) {
          await updateClassAssessment(a.id, { name: a.name, type: a.type, date: a.date });
        }
        for (const t of tasksToUpdate) {
          await updateTask(t.id, {
            title: t.title,
            dueDate: t.dueDate ?? undefined,
            taskType: t.taskType,
            taskTypeOtherLabel: t.taskTypeOtherLabel ?? undefined,
            classId: t.classId,
          });
        }

        setEditing(false);
        router.refresh();
      } catch (err) {
        // Stay in edit mode with the staged state intact — never silently
        // drop his edits (Opus Lead ruling).
        setSaveError(err instanceof Error ? err.message : "Couldn't save — try again");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-5xl flex-col gap-4 overflow-y-auto sm:max-w-5xl">
        {/* pr-8 clears DialogContent's own absolute-positioned close button
            (top-2 right-2) — established convention, see habit-editor-dialog.tsx. */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 pr-8">
          <DialogTitle>{displayName}</DialogTitle>
          {editing ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={handleCancel}
                aria-label={`Cancel ${displayName}`}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={isPending} onClick={handleSave} aria-label={`Save ${displayName}`}>
                Save
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${displayName}`}
              onClick={startEditing}
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
        </DialogHeader>

        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        {editing ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Abbreviation" className="w-40" />
            <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" className="w-40" />
            <Input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="Instructor" className="w-48" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {classData.code}
            {classData.room && ` · ${classData.room}`}
            {classData.instructor && ` · ${classData.instructor}`}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <ClassAssessments
              assessments={assessments}
              editing={editing}
              todayStr={todayStr}
              onAdd={handleAddAssessment}
              onUpdate={handleUpdateAssessment}
              onRemove={handleRemoveAssessment}
            />
          </div>
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <SyllabusPanel classId={classData.id} hasSyllabus={classData.hasSyllabus} editing={editing} />
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Task list</h3>
            {/* Always available, same as Assessments' Add — see
                handleAddTask's comment for why this isn't staged. */}
            <TaskWizardDialog
              classes={[{ id: classData.id, label: displayName }]}
              lockedClass={{ id: classData.id, label: displayName }}
              timezone={timezone}
              onSubmit={handleAddTask}
              triggerVariant="outline"
              triggerLabel="Add task"
            />
          </div>
          {/* Inline, not a nested Dialog (see the identical comment in
              class-assessments.tsx's add flow) — this is the same
              habit-editor-dialog.tsx precedent, applied to task rows. */}
          {taskDraft && (
            <form
              onSubmit={submitTaskDraft}
              className="flex flex-col gap-2 rounded-lg border border-border/40 p-3"
            >
              <p className="text-xs font-medium text-muted-foreground">Edit task</p>
              <Input
                value={taskDraft.title}
                onChange={(e) => setTaskDraft((d) => d && { ...d, title: e.target.value })}
                placeholder="Description"
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <select
                  value={taskDraft.taskType}
                  onChange={(e) => setTaskDraft((d) => d && { ...d, taskType: e.target.value as TaskType })}
                  className="flex-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
                >
                  {TASK_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Input
                  type="date"
                  aria-label={dateFieldLabel(taskDraft.taskType)}
                  value={taskDraft.dueDate}
                  onChange={(e) => setTaskDraft((d) => d && { ...d, dueDate: e.target.value })}
                  className="w-40"
                />
              </div>
              {taskDraft.taskType === "other" && (
                <Input
                  value={taskDraft.taskTypeOtherLabel}
                  onChange={(e) => setTaskDraft((d) => d && { ...d, taskTypeOtherLabel: e.target.value })}
                  placeholder="Describe the type"
                />
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={closeTaskDraft}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!taskDraft.title.trim() || !taskDraft.dueDate}>
                  Save {TASK_TYPE_LABEL[taskDraft.taskType]}
                </Button>
              </div>
            </form>
          )}
          <TaskListModule
            tasks={tasks}
            classes={[{ id: classData.id, label: displayName }]}
            todayStr={todayStr}
            weekDates={weekDates}
            toggleTask={handleToggle}
            editing={editing}
            onEditTask={handleEditTaskRequest}
            onRemoveTask={handleRemoveTaskRequest}
            hideClassFilter
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
