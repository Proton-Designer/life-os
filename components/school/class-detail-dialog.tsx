"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
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
import { ClassGradeLedger } from "@/components/school/class-grade-ledger";
import { GradeScenarioPanel } from "@/components/school/grade-scenario-panel";
import { GradeCategoriesPanel } from "@/components/school/grade-categories-panel";
import { QuestionBankPanel } from "@/components/school/question-bank-panel";
import { SyllabusPanel } from "@/components/school/syllabus-panel";
import { AnnouncementPanel } from "@/components/school/announcement-panel";
import { LecturePanel } from "@/components/school/lecture-panel";
import { PracticeTestPanel } from "@/components/school/practice-test-panel";
import { SyllabusReviewPanel } from "@/components/school/syllabus-review-panel";
import { TaskListModule, type TaskListItem } from "@/components/school/task-list-module";
import { TaskWizardDialog, type TaskWizardSubmitInput } from "@/components/school/task-wizard-dialog";
import { TASK_TYPE_OPTIONS, TASK_TYPE_LABEL, dateFieldLabel, type TaskType } from "@/lib/tasks/task-type";
import { localDateString, getWeekStartDate, weekDatesFrom } from "@/lib/date-utils";
import type { ClassCardData } from "@/lib/school/get-class-cards";

function mapAssessments(source: ClassCardData["assessments"]): ClassAssessment[] {
  return source.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as AssessmentType,
    date: a.date,
    task_id: a.taskId,
    risk: a.risk,
    weightPct: a.weightPct,
    categoryId: a.categoryId,
    pointsEarned: a.pointsEarned,
    pointsPossible: a.pointsPossible,
  }));
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

/** A `classData.gradeBoundaries` row plus a stable client-only `key` — the
 * server shape ({letter, minPct}) has nothing unique to key React rows on
 * once two rows can share a letter or a minPct mid-edit, so this is drawn
 * from an incrementing counter, never `crypto.randomUUID()` (this file has
 * no other client-generated ids, and a counter is enough for a same-session
 * list that's never persisted with its key). */
type GradeBoundaryDraft = { key: number; letter: string; minPct: string };

let nextBoundaryDraftKey = 0;

function toDrafts(boundaries: ClassCardData["gradeBoundaries"]): GradeBoundaryDraft[] {
  return boundaries.map((b) => ({ key: nextBoundaryDraftKey++, letter: b.letter, minPct: b.minPct.toString() }));
}

/**
 * CANVAS-GAP-01 -- Canvas's own computed grade, DISPLAY-ONLY (never wired
 * into anything below that reads points_earned). Prefers the numeric
 * current score (what a student actually checks); falls back to the
 * letter grade when Canvas reports one but no numeric score; an honest
 * "no grade reported yet" when it's linked but Canvas has nothing at all
 * -- never a fabricated 0%.
 */
function formatCanvasComputedGrade(g: NonNullable<ClassCardData["canvasComputedGrade"]>): string {
  if (g.currentScore !== null) return `${g.currentScore}%`;
  if (g.currentLetterGrade !== null) return g.currentLetterGrade;
  return "no grade reported yet";
}

/** Same no-timezone-conversion reasoning as canvas-settings.tsx's own `formatSyncedAt` -- this Client Component's initial render also happens during SSR. */
function formatCanvasSyncedAt(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

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
  hasOpenAiKey = false,
  hasGoogleKey = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classData: ClassCardData;
  /** IANA timezone — "today"/"this week" for the class task list are
   * derived through this (AGENTS.md), never a bare `new Date()` day. */
  timezone: string;
  /** P3-15 — threaded through to LecturePanel. */
  hasOpenAiKey?: boolean;
  hasGoogleKey?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const displayName = classData.shortName ?? classData.code;
  const todayStr = localDateString(new Date(), timezone);
  const weekDates = weekDatesFrom(getWeekStartDate(todayStr));

  const [shortName, setShortName] = useState(classData.shortName ?? "");
  const [code, setCode] = useState(classData.code);
  const [room, setRoom] = useState(classData.room ?? "");
  const [instructor, setInstructor] = useState(classData.instructor ?? "");
  const [term, setTerm] = useState(classData.term ?? "");
  const [latePolicy, setLatePolicy] = useState(classData.latePolicy ?? "");
  const [attendancePolicy, setAttendancePolicy] = useState(classData.attendancePolicy ?? "");
  // String, not number -- lets the field sit empty (unset) rather than coalescing to 0,
  // the same "empty input means null, never a fabricated zero" contract handleWeightChange
  // in class-assessments.tsx already uses for weight_pct. Parsed back to a number (or null)
  // only in handleSave.
  const [allowedAbsences, setAllowedAbsences] = useState(classData.allowedAbsences?.toString() ?? "");
  const [gradeBoundaries, setGradeBoundaries] = useState<GradeBoundaryDraft[]>(() => toDrafts(classData.gradeBoundaries));
  const [assessments, setAssessments] = useState<ClassAssessment[]>(() => mapAssessments(classData.assessments));
  const [tasks, setTasks] = useState<TaskListItem[]>(() => mapTasks(classData.tasks, displayName));

  // Resyncs staged state from fresh server props — on initial open, and
  // again once a Save's router.refresh() lands new classData. Skipped while
  // `editing` so a background refresh (another tab, another agent) can
  // never clobber in-progress, unsaved edits.
  useEffect(() => {
    if (editing) return;
    setShortName(classData.shortName ?? "");
    setCode(classData.code);
    setRoom(classData.room ?? "");
    setInstructor(classData.instructor ?? "");
    setTerm(classData.term ?? "");
    setLatePolicy(classData.latePolicy ?? "");
    setAttendancePolicy(classData.attendancePolicy ?? "");
    setAllowedAbsences(classData.allowedAbsences?.toString() ?? "");
    setGradeBoundaries(toDrafts(classData.gradeBoundaries));
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
    setCode(classData.code);
    setRoom(classData.room ?? "");
    setInstructor(classData.instructor ?? "");
    setTerm(classData.term ?? "");
    setLatePolicy(classData.latePolicy ?? "");
    setAttendancePolicy(classData.attendancePolicy ?? "");
    setAllowedAbsences(classData.allowedAbsences?.toString() ?? "");
    setGradeBoundaries(toDrafts(classData.gradeBoundaries));
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
        // Empty input -> null (unset), never a fabricated "" or 0 — same contract as
        // updateClassCore's other optional fields and class-assessments.tsx's weight.
        const trimmedLatePolicy = latePolicy.trim() || null;
        const trimmedAttendancePolicy = attendancePolicy.trim() || null;
        const parsedAllowedAbsences = allowedAbsences.trim() === "" ? null : Number(allowedAbsences);
        // A row with no letter typed yet is a draft, not a boundary — dropped before
        // save rather than persisted as `{letter: "", minPct}`, which parseGradeBoundaries
        // (the READ side) would reject anyway (see that file's own validation).
        const parsedBoundaries = gradeBoundaries
          .filter((b) => b.letter.trim() !== "" && b.minPct.trim() !== "" && Number.isFinite(Number(b.minPct)))
          .map((b) => ({ letter: b.letter.trim(), minPct: Number(b.minPct) }));

        const trimmedCode = code.trim();

        const detailsChanged =
          shortName.trim() !== (classData.shortName ?? "") ||
          trimmedCode !== classData.code ||
          room.trim() !== (classData.room ?? "") ||
          instructor.trim() !== (classData.instructor ?? "") ||
          term.trim() !== (classData.term ?? "") ||
          trimmedLatePolicy !== classData.latePolicy ||
          trimmedAttendancePolicy !== classData.attendancePolicy ||
          (parsedAllowedAbsences !== null && !Number.isFinite(parsedAllowedAbsences)
            ? true // garbage input still counts as "changed" so Save's error path can catch it, not silently no-op
            : parsedAllowedAbsences !== classData.allowedAbsences) ||
          JSON.stringify(parsedBoundaries) !== JSON.stringify(classData.gradeBoundaries);

        // Add (both sections) commits immediately outside this flow — see
        // handleAddAssessment/handleAddTask — so there is no staged-insert
        // branch here. Only removes and updates of EXISTING rows are staged.
        const originalAssessments = originalAssessmentsRef.current;
        const originalAssessmentById = new Map(originalAssessments.map((a) => [a.id, a]));
        const currentAssessmentIds = new Set(assessments.map((a) => a.id));
        const assessmentsToRemove = originalAssessments.filter((a) => !currentAssessmentIds.has(a.id));
        const assessmentsToUpdate = assessments.filter((a) => {
          const orig = originalAssessmentById.get(a.id);
          return (
            orig !== undefined &&
            (orig.name !== a.name ||
              orig.type !== a.type ||
              orig.date !== a.date ||
              orig.weightPct !== a.weightPct ||
              orig.categoryId !== a.categoryId ||
              orig.pointsEarned !== a.pointsEarned ||
              orig.pointsPossible !== a.pointsPossible)
          );
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
          if (parsedAllowedAbsences !== null && !Number.isFinite(parsedAllowedAbsences)) {
            throw new Error("Allowed absences must be a number");
          }
          if (trimmedCode === "") {
            throw new Error("Class code can't be empty.");
          }
          await updateClass(classData.id, {
            shortName: shortName.trim() || null,
            code: trimmedCode,
            room: room.trim() || null,
            instructor: instructor.trim() || null,
            term: term.trim() || null,
            latePolicy: trimmedLatePolicy,
            attendancePolicy: trimmedAttendancePolicy,
            allowedAbsences: parsedAllowedAbsences,
            gradeBoundaries: parsedBoundaries,
          });
        }
        for (const a of assessmentsToUpdate) {
          const orig = originalAssessmentById.get(a.id);
          // GAP-01: pointsEarned/pointsPossible are sent ONLY when they
          // actually changed -- unlike weightPct/categoryId, providing
          // either ALWAYS clears points_source server-side (the P2-21
          // never-overwrite marker). Sending them unconditionally on every
          // save (as weightPct/categoryId already do) would silently strip
          // a Canvas-synced grade's protection the next time the user
          // merely renamed the assessment or moved its date.
          const pointsChanged = orig !== undefined && (orig.pointsEarned !== a.pointsEarned || orig.pointsPossible !== a.pointsPossible);
          await updateClassAssessment(a.id, {
            name: a.name,
            type: a.type,
            date: a.date,
            weightPct: a.weightPct,
            categoryId: a.categoryId,
            ...(pointsChanged ? { pointsEarned: a.pointsEarned, pointsPossible: a.pointsPossible } : {}),
          });
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
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Abbreviation" className="w-40" />
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (e.g. CS-3341)" aria-label="Class code" className="w-40" />
              <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" className="w-40" />
              <Input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="Instructor" className="w-48" />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Term (e.g. Fall 2026)" className="w-48" />
            </div>
            {/* Policies + grade boundaries (Phase 1 #11) — schema shipped in migration 152 with
                zero UI wired to it; this is that wiring. Informational only (late_policy/
                attendance_policy), no feature reads them yet — same posture the migration's own
                comment documents. */}
            <div className="flex flex-wrap items-end gap-2">
              <Input
                value={latePolicy}
                onChange={(e) => setLatePolicy(e.target.value)}
                placeholder="Late-work policy"
                className="w-64"
              />
              <Input
                value={attendancePolicy}
                onChange={(e) => setAttendancePolicy(e.target.value)}
                placeholder="Attendance policy"
                className="w-64"
              />
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={allowedAbsences}
                onChange={(e) => setAllowedAbsences(e.target.value)}
                placeholder="Allowed absences"
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Grading scale (optional)</p>
              {gradeBoundaries.map((b) => (
                <div key={b.key} className="flex items-center gap-2">
                  <Input
                    value={b.letter}
                    onChange={(e) =>
                      setGradeBoundaries((prev) => prev.map((row) => (row.key === b.key ? { ...row, letter: e.target.value } : row)))
                    }
                    placeholder="Letter (e.g. A-)"
                    aria-label="Grade letter"
                    className="h-8 w-28"
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={b.minPct}
                    onChange={(e) =>
                      setGradeBoundaries((prev) => prev.map((row) => (row.key === b.key ? { ...row, minPct: e.target.value } : row)))
                    }
                    placeholder="Min %"
                    aria-label="Minimum percent for this letter"
                    className="h-8 w-24"
                  />
                  <button
                    type="button"
                    onClick={() => setGradeBoundaries((prev) => prev.filter((row) => row.key !== b.key))}
                    aria-label={`Remove ${b.letter || "this"} boundary`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setGradeBoundaries((prev) => [...prev, { key: nextBoundaryDraftKey++, letter: "", minPct: "" }])}
              >
                Add letter grade
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <p className="text-sm text-muted-foreground">
              {classData.code}
              {classData.room && ` · ${classData.room}`}
              {classData.instructor && ` · ${classData.instructor}`}
              {classData.term && ` · ${classData.term}`}
            </p>
            {/* Opus Lead review (2026-09-15): these previously only showed in edit mode —
                a cheap, separate line here rather than crowding the summary line above,
                since a policy is free text and can run longer than a room/instructor. */}
            {(classData.latePolicy || classData.attendancePolicy) && (
              <p className="text-xs text-muted-foreground">
                {classData.latePolicy && `Late: ${classData.latePolicy}`}
                {classData.latePolicy && classData.attendancePolicy && " · "}
                {classData.attendancePolicy && `Attendance: ${classData.attendancePolicy}`}
              </p>
            )}
          </div>
        )}

        {/* items-start: Syllabus is usually much shorter than Assessments
            (View, or View/Swap/Remove — a single button row either way) —
            without it, CSS Grid's default stretch inflates the Syllabus
            card to match its neighbor's height, leaving a dead empty area
            inside the border that's the same "bare, empty-looking panel"
            complaint the redesign was supposed to fix, just moved inside a
            box instead of solved. Same fix as the class-card grid's
            treatment of Lin Alg's shorter card.

            2fr/1fr, not an even split: Assessments is a real data table
            (and squeezing it to half-width is what was truncating "Take-
            home Final Exam d…" on desktop) while Syllabus only ever holds a
            button row — an even 50/50 split gives the low-information
            panel the same width as the high-information one. */}
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <ClassAssessments
              assessments={assessments}
              categories={classData.categories}
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
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <AnnouncementPanel classId={classData.id} editing={editing} />
          </div>
        </div>

        {/* Phase 1 #16/#17/#19 — reads straight from classData.pendingStagingBatch
            (server props), owns its own card wrapper the way GradeScenarioPanel does,
            since it renders nothing at all once there's no batch to review. */}
        {classData.pendingStagingBatch && <SyllabusReviewPanel batch={classData.pendingStagingBatch} />}

        {/* P2-09 -- self-contained, own client-side fetch (there's no existing
            server prop to extend for this), same reasoning practice-test-
            panel.tsx's own header gives. Assembly itself happens server-side
            (the cron dispatcher); this only lists/takes already-assembled tests. */}
        <div className="rounded-2xl border border-border/40 bg-card p-4">
          <PracticeTestPanel classId={classData.id} />
        </div>

        {/* Self-contained immediate-commit CRUD (own Server Actions), same shape as
            SyllabusPanel/QuestionBankPanel below — nothing staged here. Assignment of an
            assessment TO a category is staged, through ClassAssessments' own category
            select above; creating/editing/deleting a category itself is not. */}
        <div className="rounded-2xl border border-border/40 bg-card p-4">
          <GradeCategoriesPanel classId={classData.id} categories={classData.categories} />
        </div>

        {/* P3-14 -- same self-contained immediate-commit shape as
            SyllabusPanel/QuestionBankPanel: reads straight from
            classData.lectures (server props), nothing staged here. */}
        <div className="rounded-2xl border border-border/40 bg-card p-4">
          <LecturePanel
            classId={classData.id}
            lectures={classData.lectures}
            editing={editing}
            hasOpenAiKey={hasOpenAiKey}
            hasGoogleKey={hasGoogleKey}
          />
        </div>

        {/* Reads straight from classData.assessments (server props), not the
            staged `assessments` state above — there's no grade-ENTRY (points) UI yet
            (out of scope for this pass), so there's nothing to stage. Same
            B3 instant-load contract as everything else in this dialog. */}
        <div className="rounded-2xl border border-border/40 bg-card p-4">
          <ClassGradeLedger
            assessments={classData.assessments}
            categories={classData.categories}
            targetGradePct={classData.targetGradePct}
            gradeBoundaries={classData.gradeBoundaries}
          />
          {/* CANVAS-GAP-01 -- a course-level SNAPSHOT from Canvas itself,
              clearly labelled with its own sync time so it can never be
              mistaken for the grade this ledger just computed from
              individual assessments above. Renders nothing at all for a
              class with no Canvas link (never a fabricated line). */}
          {classData.canvasComputedGrade ? (
            <p className="mt-2 border-t border-border/30 pt-2 text-xs text-muted-foreground">
              Canvas, as of {formatCanvasSyncedAt(classData.canvasComputedGrade.syncedAt)}: {formatCanvasComputedGrade(classData.canvasComputedGrade)}
            </p>
          ) : null}
        </div>

        {/* Phase 1 #13 — computeScenario's first production caller (previously zero
            callers anywhere, verified by grep). Owns its own card wrapper (unlike its
            siblings above) because it returns null once there's nothing left to
            hypothesize about — no fabricated "what-if" on a fully-graded or empty
            class, and no empty bordered box left behind when it has nothing to say. */}
        <GradeScenarioPanel
          assessments={classData.assessments}
          categories={classData.categories}
          targetGradePct={classData.targetGradePct}
        />

        {/* Same B3 instant-load contract as the grade ledger above: reads
            straight from classData.questions (server props). The panel is
            self-contained (immediate-commit CRUD via its own Server Actions,
            like SyllabusPanel), so it needs nothing staged here. */}
        <div className="rounded-2xl border border-border/40 bg-card p-4">
          <QuestionBankPanel classId={classData.id} questions={classData.questions} lectures={classData.lectures} />
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
