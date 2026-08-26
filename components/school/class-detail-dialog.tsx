"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updateClass, listClassAssessments, listClassTasks } from "@/app/(app)/school/class-actions";
import { addTask, toggleTask } from "@/app/(app)/school/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClassAssessments, type ClassAssessment } from "@/components/school/class-assessments";
import { SyllabusPanel } from "@/components/school/syllabus-panel";
import { TaskListModule, type TaskListItem } from "@/components/school/task-list-module";
import { TaskWizardDialog } from "@/components/school/task-wizard-dialog";
import { localDateString, getWeekStartDate, weekDatesFrom } from "@/lib/date-utils";
import type { ClassCardData } from "@/lib/school/get-class-cards";

/**
 * The expanded class view (item 6c, verbatim spec order): class details in
 * one line at the top; Assessments on the left, syllabus view/add on the
 * right, beneath that; the class's own task list (grouped Today/This
 * Week/This Month/Future, filterable) at the bottom.
 *
 * The task list is the SAME `tasks` rows the main School Task list reads
 * (item 5's TaskListModule), filtered to this class_id, and adding here
 * uses B's shared TaskWizardDialog (Ruling R4) rather than a second
 * implementation — this file never reimplements either.
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
  const [shortName, setShortName] = useState(classData.shortName ?? "");
  const [room, setRoom] = useState(classData.room ?? "");
  const [instructor, setInstructor] = useState(classData.instructor ?? "");
  const [assessments, setAssessments] = useState<ClassAssessment[] | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);

  const displayName = classData.shortName ?? classData.code;

  useEffect(() => {
    if (!open) return;
    setAssessments(null);
    setTasks(null);
    listClassAssessments(classData.id).then((rows) =>
      setAssessments(rows.map((r) => ({ ...r, type: r.type as ClassAssessment["type"] })))
    );
    listClassTasks(classData.id).then((rows) => setTasks(rows.map((t) => ({ ...t, className: displayName }))));
  }, [open, classData.id, displayName]);

  function reloadTasks() {
    listClassTasks(classData.id).then((rows) => setTasks(rows.map((t) => ({ ...t, className: displayName }))));
  }

  async function handleToggle(id: string) {
    await toggleTask(id);
    reloadTasks();
  }

  function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      await updateClass(classData.id, {
        shortName: shortName.trim() || null,
        room: room.trim() || null,
        instructor: instructor.trim() || null,
      });
      setEditing(false);
      router.refresh();
    });
  }

  async function handleAddTask(input: Parameters<typeof addTask>[0]) {
    await addTask(input);
    reloadTasks();
  }

  const todayStr = localDateString(new Date(), timezone);
  const weekDates = weekDatesFrom(getWeekStartDate(todayStr));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{displayName}</DialogTitle>
        </DialogHeader>

        {editing ? (
          <form onSubmit={saveDetails} className="flex flex-wrap items-end gap-2">
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Abbreviation" className="w-40" />
            <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" className="w-40" />
            <Input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="Instructor" className="w-48" />
            <Button type="submit" size="sm" disabled={isPending}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {classData.code}
              {classData.room && ` · ${classData.room}`}
              {classData.instructor && ` · ${classData.instructor}`}
            </span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit class details" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" />
            </Button>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {assessments === null ? (
            <p className="text-sm text-muted-foreground">Loading assessments…</p>
          ) : (
            <ClassAssessments classId={classData.id} initialAssessments={assessments} />
          )}
          <SyllabusPanel classId={classData.id} hasSyllabus={classData.hasSyllabus} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Task list</h3>
            <TaskWizardDialog
              classes={[{ id: classData.id, label: displayName }]}
              timezone={timezone}
              onSubmit={handleAddTask}
            />
          </div>
          {tasks === null ? (
            <p className="text-sm text-muted-foreground">Loading tasks…</p>
          ) : (
            <TaskListModule
              tasks={tasks}
              classes={[{ id: classData.id, label: displayName }]}
              todayStr={todayStr}
              weekDates={weekDates}
              toggleTask={handleToggle}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
