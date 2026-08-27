"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ClassGroupDay = { dayOfWeek: number; eventId: string; date: string; cancelledThisWeek: boolean };

export type ClassGroup = {
  /** class_group_id if this class has one, otherwise the id of its single row — see school/actions.ts's updateClassEvent header comment. */
  groupKey: string;
  title: string;
  eventTime: string | null;
  endTime: string | null;
  location: string | null;
  instructor: string | null;
  days: ClassGroupDay[];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${String(m).padStart(2, "0")} ${suffix}`;
}

type FormState = {
  title: string;
  days: Set<number>;
  eventTime: string;
  endTime: string;
  location: string;
  instructor: string;
};

function emptyForm(): FormState {
  return { title: "", days: new Set(), eventTime: "", endTime: "", location: "", instructor: "" };
}

function formFromGroup(group: ClassGroup): FormState {
  return {
    title: group.title,
    days: new Set(group.days.map((d) => d.dayOfWeek)),
    eventTime: group.eventTime ?? "",
    endTime: group.endTime ?? "",
    location: group.location ?? "",
    instructor: group.instructor ?? "",
  };
}

/**
 * School's "This week's classes" Edit popup (2026-08-26 night batch, item
 * B1) — replaces the deleted "Class schedule" panel's add/cancel-only
 * DomainScheduleView entirely. A class is one editable/removable thing even
 * when it spans multiple days (Ayman: "the class is T/TH" — singular);
 * school/actions.ts's ClassEvent* actions handle the day-diffing this
 * implies. Undoing an accidental "cancel this week" lives here (per Opus
 * Lead's ruling) rather than inline on the read-only weekly grid.
 */
export function ClassEditorDialog({
  classes,
  addClassEvent,
  updateClassEvent,
  removeClassEvent,
  cancelScheduleOccurrence,
  uncancelScheduleOccurrence,
}: {
  classes: ClassGroup[];
  addClassEvent: (input: {
    title: string;
    days: number[];
    eventTime?: string;
    endTime?: string;
    location?: string;
    instructor?: string;
  }) => Promise<void>;
  updateClassEvent: (
    key: string,
    input: { title: string; days: number[]; eventTime?: string; endTime?: string; location?: string; instructor?: string }
  ) => Promise<void>;
  removeClassEvent: (key: string) => Promise<void>;
  cancelScheduleOccurrence: (eventId: string, date: string) => Promise<void>;
  uncancelScheduleOccurrence: (eventId: string, date: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null | "new">(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openList() {
    setEditingKey(null);
    setError(null);
  }

  function openAddForm() {
    setForm(emptyForm());
    setEditingKey("new");
    setError(null);
  }

  function openEditForm(group: ClassGroup) {
    setForm(formFromGroup(group));
    setEditingKey(group.groupKey);
    setError(null);
  }

  function toggleDay(dow: number) {
    setForm((f) => {
      const days = new Set(f.days);
      if (days.has(dow)) days.delete(dow);
      else days.add(dow);
      return { ...f, days };
    });
  }

  function handleSave() {
    const title = form.title.trim();
    if (!title) {
      setError("Enter a class name");
      return;
    }
    if (form.days.size === 0) {
      setError("Select at least one day");
      return;
    }
    const input = {
      title,
      days: Array.from(form.days),
      eventTime: form.eventTime || undefined,
      endTime: form.endTime || undefined,
      location: form.location || undefined,
      instructor: form.instructor || undefined,
    };
    setError(null);
    startTransition(async () => {
      try {
        if (editingKey === "new") await addClassEvent(input);
        else if (editingKey) await updateClassEvent(editingKey, input);
        openList();
      } catch {
        setError("Couldn't save — try again");
      }
    });
  }

  function handleRemove(key: string) {
    startTransition(async () => {
      try {
        await removeClassEvent(key);
        openList();
      } catch {
        setError("Couldn't remove — try again");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) openList();
      }}
    >
      <DialogTrigger asChild>
        {/* "Edit classes", not bare "Edit" — evening batch (2026-08-26) put
            an "Add class" button right beside this one; two controls in the
            same slot both needed a name that says what they open, not just
            which icon they carry. Label hidden below sm (icon + aria-label
            carry it instead) — the pair didn't fit this panel's own header
            at 320px (layout-overflow.spec.ts, batch 3 verification). */}
        <Button type="button" variant="outline" size="sm" aria-label="Edit classes">
          <Pencil className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Edit classes</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingKey === null ? "This week's classes" : editingKey === "new" ? "Add a class" : "Edit class"}</DialogTitle>
        </DialogHeader>

        {editingKey === null ? (
          <div className="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1">
            {classes.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No classes yet</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {classes.map((group) => (
                  <li key={group.groupKey} className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">{group.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {group.days.map((d) => DAY_LABELS[d.dayOfWeek]).join("/")}
                          {group.eventTime && ` · ${formatTime(group.eventTime)}${group.endTime ? `–${formatTime(group.endTime)}` : ""}`}
                        </span>
                        {(group.location || group.instructor) && (
                          <span className="text-xs text-muted-foreground">
                            {[group.location, group.instructor].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => openEditForm(group)}
                          aria-label={`Edit ${group.title}`}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(group.groupKey)}
                          disabled={isPending}
                          aria-label={`Remove ${group.title}`}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/40 pt-2">
                      {group.days.map((d) => (
                        <span key={d.eventId} className="flex items-center gap-1.5 text-[11px]">
                          <span className={cn("text-muted-foreground", d.cancelledThisWeek && "line-through")}>
                            {DAY_LABELS[d.dayOfWeek]} ({d.date.slice(5)})
                          </span>
                          {d.cancelledThisWeek ? (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => startTransition(() => uncancelScheduleOccurrence(d.eventId, d.date))}
                              className="font-medium text-accent-business hover:underline"
                            >
                              Undo cancel
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => startTransition(() => cancelScheduleOccurrence(d.eventId, d.date))}
                              className="text-destructive hover:underline"
                            >
                              Cancel this week
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" variant="outline" onClick={openAddForm} className="self-start">
              <Plus className="size-3.5" aria-hidden />
              Add a class
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Class name"
              autoFocus
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Days</span>
              <div className="flex gap-1">
                {DAY_LABELS.map((label, dow) => (
                  <button
                    key={dow}
                    type="button"
                    onClick={() => toggleDay(dow)}
                    className={cn(
                      "flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                      form.days.has(dow)
                        ? "border-accent-business bg-accent-business/10 text-accent-business"
                        : "border-border text-muted-foreground hover:bg-accent/50"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                type="time"
                value={form.eventTime}
                onChange={(e) => setForm((f) => ({ ...f, eventTime: e.target.value }))}
                placeholder="Start"
              />
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                placeholder="End"
              />
            </div>
            <Input
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              placeholder="Location (optional)"
            />
            <Input
              value={form.instructor}
              onChange={(e) => setForm((f) => ({ ...f, instructor: e.target.value }))}
              placeholder="Instructor (optional)"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={openList} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSave} disabled={isPending}>
                Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
