"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ClassEventInput } from "@/app/(app)/school/actions";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function emptyForm() {
  return { shortName: "", code: "", room: "", instructor: "", days: new Set<number>(), eventTime: "", endTime: "" };
}

/**
 * "This week's classes" Add popup (evening batch, 2026-08-26), Ayman
 * verbatim: "Class name, class code, room (if applicable), professor, and
 * timings (if applicable)." Sits beside ClassEditorDialog's "Edit classes"
 * trigger, adding a NEW `classes` entity (item 6b/6c's short_name/code/
 * room/instructor) — not the `schedule_events`-only groups that dialog
 * edits. Timings are genuinely optional: no days selected means no
 * schedule_events at all, the exact shape MATH 2418 already has in
 * production (an online class with zero linked meeting times).
 *
 * Day-picker/time-input styling deliberately mirrors ClassEditorDialog's
 * own form — "read as a pair," not two unrelated controls (Opus Lead
 * review of the mismatched-Add-button complaint this afternoon).
 */
export function AddClassDialog({
  createClass,
  addClassEvent,
}: {
  createClass: (fields: { shortName: string; code: string; room?: string; instructor?: string }) => Promise<{ id: string }>;
  addClassEvent: (input: ClassEventInput) => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleDay(dow: number) {
    setForm((f) => {
      const days = new Set(f.days);
      if (days.has(dow)) days.delete(dow);
      else days.add(dow);
      return { ...f, days };
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setForm(emptyForm());
      setError(null);
    }
  }

  function handleSave() {
    const shortName = form.shortName.trim();
    const code = form.code.trim();
    if (!shortName) {
      setError("Enter a class name");
      return;
    }
    if (!code) {
      setError("Enter a class code");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const room = form.room.trim() || undefined;
        const instructor = form.instructor.trim() || undefined;
        const { id } = await createClass({ shortName, code, room, instructor });
        if (form.days.size > 0) {
          await addClassEvent({
            title: shortName,
            days: Array.from(form.days),
            eventTime: form.eventTime || undefined,
            endTime: form.endTime || undefined,
            location: room,
            instructor,
            classId: id,
          });
        }
        handleOpenChange(false);
        router.refresh();
      } catch {
        setError("Couldn't save — try again");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus className="size-3.5" aria-hidden />
          Add class
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a class</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            value={form.shortName}
            onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))}
            placeholder="Class name"
            autoFocus
          />
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="Class code" />
          <Input
            value={form.room}
            onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))}
            placeholder="Room (optional)"
          />
          <Input
            value={form.instructor}
            onChange={(e) => setForm((f) => ({ ...f, instructor: e.target.value }))}
            placeholder="Professor (optional)"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Timings (optional)</span>
            <div className="flex gap-1">
              {DAY_LABELS.map((label, dow) => (
                <button
                  key={dow}
                  type="button"
                  onClick={() => toggleDay(dow)}
                  aria-pressed={form.days.has(dow)}
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
              aria-label="Start time"
              value={form.eventTime}
              onChange={(e) => setForm((f) => ({ ...f, eventTime: e.target.value }))}
              placeholder="Start"
            />
            <Input
              type="time"
              aria-label="End time"
              value={form.endTime}
              onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              placeholder="End"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isPending}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
