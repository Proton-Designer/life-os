"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TASK_TYPE_OPTIONS, dateFieldLabel, type TaskType } from "@/lib/tasks/task-type";
import { localDateString, addDaysToDateString, getWeekStartDate, dayOfWeekFromDateString } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

/**
 * A caller-supplied class option — deliberately opaque (`id` + `label`
 * only). This wizard is built ONCE and reused by both School's Task list
 * (item 5) and the per-class expanded view (item 6c, Opus Lead ruling R4)
 * — it must not know or care whether `id` is a real `classes` row or an
 * interim stand-in; the caller decides what it means and what `onSubmit`
 * does with it. Never fetch classes inside this component.
 */
export type TaskWizardClassOption = { id: string; label: string };

export type TaskWizardSubmitInput = {
  classId: string | null;
  taskType: TaskType;
  taskTypeOtherLabel?: string;
  title: string;
  dueDate: string;
};

type Step = 1 | 2 | 3;

function QuickDateChips({ timezone, onPick }: { timezone: string; onPick: (date: string) => void }) {
  const today = localDateString(new Date(), timezone);
  const dow = dayOfWeekFromDateString(today);
  const weekStart = getWeekStartDate(today);

  const chips: { label: string; date: string }[] = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDaysToDateString(today, 1) },
    // Friday is unambiguous only from Sunday through Friday itself (dow 0-5)
    // — on Saturday, "this Friday" would already be in the past, so the
    // chip is dropped rather than guessed (Opus Lead ruling).
    ...(dow <= 5 ? [{ label: "This Friday", date: addDaysToDateString(weekStart, 5) }] : []),
    // "Next week" = the following Sunday, the one unambiguous instant that
    // phrase can mean given weeks start Sunday repo-wide.
    { label: "Next week", date: addDaysToDateString(weekStart, 7) },
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => onPick(c.date)}
          className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The shared three-step Add-task wizard (2026-08-26 night batch 2, item 5;
 * reused by item 6c per Opus Lead ruling R4 — built once, never
 * reimplemented). Step 1: class or Generic. Step 2: type (Other prompts an
 * inline custom label). Step 3: description + date, with quick-pick date
 * chips alongside the native date input (Opus Lead ruling — a calendar
 * widget would be a new dependency at deploy time; chips cover the common
 * case, the native input covers everything else).
 */
export function TaskWizardDialog({
  classes,
  timezone,
  onSubmit,
  triggerLabel = "Add",
  triggerVariant = "default",
  lockedClass,
}: {
  classes: TaskWizardClassOption[];
  /** IANA timezone — quick-pick chips compute "today" through this, never a naive `new Date()` day (AGENTS.md). */
  timezone: string;
  onSubmit: (input: TaskWizardSubmitInput) => Promise<void>;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
  /**
   * When set (the per-class expanded view, item 6c, Ayman's C2 report: "no
   * need to ask [which class] again, it should just take the class for
   * which the user is in"), the wizard starts on step 2 — step 1 never
   * renders at all, not even briefly before advancing — and step 2's Back
   * button is hidden rather than revealing step 1. School's main Task list
   * never passes this, so it keeps the full 3-step flow (Ruling R4: one
   * component, not a second implementation).
   */
  lockedClass?: TaskWizardClassOption;
}) {
  const initialStep: Step = lockedClass ? 2 : 1;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(initialStep);
  const [classId, setClassId] = useState<string | null>(lockedClass?.id ?? null);
  const [taskType, setTaskType] = useState<TaskType | null>(null);
  const [otherLabel, setOtherLabel] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setStep(initialStep);
    setClassId(lockedClass?.id ?? null);
    setTaskType(null);
    setOtherLabel("");
    setTitle("");
    setDueDate("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function pickClass(id: string | null) {
    setClassId(id);
    setStep(2);
  }

  function pickType(type: TaskType) {
    setTaskType(type);
    if (type !== "other") setStep(3);
    // "Other" stays on step 2 until a custom label is entered — see the Next button below.
  }

  async function handleSubmit() {
    if (!taskType) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Enter a description");
      return;
    }
    if (!dueDate) {
      setError(`Enter a ${dateFieldLabel(taskType).toLowerCase()}`);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        classId,
        taskType,
        taskTypeOtherLabel: taskType === "other" ? otherLabel.trim() || undefined : undefined,
        title: trimmedTitle,
        dueDate,
      });
      handleOpenChange(false);
    } catch {
      setError("Couldn't save — try again");
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={triggerVariant}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 1 && "Which class?"}
            {step === 2 && "What type of task?"}
            {step === 3 && "Describe the task"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="flex flex-col gap-2">
            {classes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickClass(c.id)}
                className="rounded-lg border border-border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
              >
                {c.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => pickClass(null)}
              className="rounded-lg border border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50"
            >
              Generic
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              {TASK_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => pickType(opt.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    taskType === opt.value
                      ? "border-accent-business bg-accent-business/10"
                      : "border-border hover:bg-accent/50"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {taskType === "other" && (
              <div className="flex flex-col gap-2">
                <Input
                  value={otherLabel}
                  onChange={(e) => setOtherLabel(e.target.value)}
                  placeholder="Describe the type"
                  autoFocus
                />
                <Button
                  type="button"
                  onClick={() => {
                    if (!otherLabel.trim()) {
                      setError("Enter a type");
                      return;
                    }
                    setError(null);
                    setStep(3);
                  }}
                >
                  Next
                </Button>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
            )}
            {!lockedClass && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="self-start text-xs text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
            )}
          </div>
        )}

        {step === 3 && taskType && (
          <div className="flex flex-col gap-3">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Description"
              autoFocus
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{dateFieldLabel(taskType)}</span>
              <QuickDateChips timezone={timezone} onPick={setDueDate} />
              <Input
                type="date"
                aria-label={dateFieldLabel(taskType)}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
              <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
                Add
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
