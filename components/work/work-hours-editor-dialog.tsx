"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { resolveOccurrence, type ExceptionsByEvent } from "@/lib/tasks/schedule-cancellations";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type PermanentWorkRow = { id: string; dayOfWeek: number; eventTime: string | null; endTime: string | null };
export type OneOffWorkRow = { id: string; eventDate: string; eventTime: string | null; endTime: string | null };

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${String(m).padStart(2, "0")} ${suffix}`;
}

type Actions = {
  addWorkHours: (dayOfWeek: number, eventTime: string, endTime?: string) => Promise<void>;
  updateWorkHours: (id: string, options: { dayOfWeek: number; eventTime: string; endTime?: string }) => Promise<void>;
  removeWorkHours: (id: string) => Promise<void>;
  addOneOffWorkShift: (eventDate: string, eventTime: string, endTime?: string) => Promise<void>;
  setWorkHoursOverride: (eventId: string, date: string, eventTime: string, endTime?: string) => Promise<void>;
  removeWorkHoursOverride: (eventId: string, date: string) => Promise<void>;
  cancelScheduleOccurrence: (eventId: string, date: string) => Promise<void>;
  uncancelScheduleOccurrence: (eventId: string, date: string) => Promise<void>;
};

function PermanentRow({
  row,
  onSave,
  onRemove,
}: {
  row: PermanentWorkRow;
  onSave: (id: string, dayOfWeek: number, eventTime: string, endTime: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState(row.dayOfWeek);
  const [eventTime, setEventTime] = useState(row.eventTime ?? "");
  const [endTime, setEndTime] = useState(row.endTime ?? "");
  const [isPending, startTransition] = useTransition();

  if (editing) {
    return (
      <li className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
        <select
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(Number(e.target.value))}
          className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
        >
          {DAY_LABELS.map((label, i) => (
            <option key={i} value={i}>
              {label}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending || !eventTime}
            onClick={() =>
              startTransition(async () => {
                await onSave(row.id, dayOfWeek, eventTime, endTime);
                setEditing(false);
              })
            }
          >
            Save
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2.5">
      <span className="text-sm">
        {DAY_LABELS[row.dayOfWeek]}
        {row.eventTime && (
          <span className="text-muted-foreground">
            {" · "}
            {formatTime(row.eventTime)}
            {row.endTime ? `–${formatTime(row.endTime)}` : ""}
          </span>
        )}
      </span>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${DAY_LABELS[row.dayOfWeek]} hours`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => onRemove(row.id))}
          aria-label={`Remove ${DAY_LABELS[row.dayOfWeek]} hours`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}

function AddPermanentRow({ onAdd }: { onAdd: (dayOfWeek: number, eventTime: string, endTime: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [eventTime, setEventTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="self-start">
        <Plus className="size-3.5" aria-hidden />
        Add a day
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
      <select
        value={dayOfWeek}
        onChange={(e) => setDayOfWeek(Number(e.target.value))}
        className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
      >
        {DAY_LABELS.map((label, i) => (
          <option key={i} value={i}>
            {label}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
        <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={isPending || !eventTime}
          onClick={() =>
            startTransition(async () => {
              await onAdd(dayOfWeek, eventTime, endTime);
              setOpen(false);
              setEventTime("");
              setEndTime("");
            })
          }
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function OccurrenceRow({
  date,
  permanentRow,
  oneOffRow,
  exceptions,
  actions,
}: {
  date: string;
  permanentRow: PermanentWorkRow | null;
  oneOffRow: OneOffWorkRow | null;
  exceptions: ExceptionsByEvent;
  actions: Actions;
}) {
  const [changingHours, setChangingHours] = useState(false);
  const [addingHours, setAddingHours] = useState(false);
  const [eventTime, setEventTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isPending, startTransition] = useTransition();

  const label = `${DAY_LABELS[new Date(`${date}T00:00:00Z`).getUTCDay()]} (${date.slice(5)})`;

  if (oneOffRow) {
    return (
      <li className="flex items-center justify-between gap-2 text-xs">
        <span>
          {label}
          {oneOffRow.eventTime && (
            <span className="text-muted-foreground">
              {" · "}
              {formatTime(oneOffRow.eventTime)}
              {oneOffRow.endTime ? `–${formatTime(oneOffRow.endTime)}` : ""} (one-off)
            </span>
          )}
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => actions.removeWorkHours(oneOffRow.id))}
          className="text-destructive hover:underline"
        >
          Remove
        </button>
      </li>
    );
  }

  if (!permanentRow) {
    if (addingHours) {
      return (
        <li className="flex flex-col gap-2 rounded-lg border border-border/40 p-2 text-xs">
          <span>{label}</span>
          <div className="flex gap-2">
            <Input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAddingHours(false)} className="text-muted-foreground hover:underline">
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending || !eventTime}
              onClick={() =>
                startTransition(async () => {
                  await actions.addOneOffWorkShift(date, eventTime, endTime || undefined);
                  setAddingHours(false);
                })
              }
              className="font-medium text-accent-business hover:underline"
            >
              Add
            </button>
          </div>
        </li>
      );
    }
    return (
      <li className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label} · —</span>
        <button type="button" onClick={() => setAddingHours(true)} className="text-accent-business hover:underline">
          Add hours
        </button>
      </li>
    );
  }

  const resolved = resolveOccurrence(exceptions, permanentRow.id, date);

  if (changingHours) {
    return (
      <li className="flex flex-col gap-2 rounded-lg border border-border/40 p-2 text-xs">
        <span>{label}</span>
        <div className="flex gap-2">
          <Input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setChangingHours(false)} className="text-muted-foreground hover:underline">
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending || !eventTime}
            onClick={() =>
              startTransition(async () => {
                await actions.setWorkHoursOverride(permanentRow.id, date, eventTime, endTime || undefined);
                setChangingHours(false);
              })
            }
            className="font-medium text-accent-business hover:underline"
          >
            Save
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span>
        {label}
        {resolved.kind === "cancelled" && <span className="ml-1 font-medium text-destructive">Cancelled</span>}
        {resolved.kind === "override" && (
          <span className="ml-1 text-muted-foreground">
            {formatTime(resolved.eventTime)}
            {resolved.endTime ? `–${formatTime(resolved.endTime)}` : ""} <span className="text-accent-warning">(this week)</span>
          </span>
        )}
        {resolved.kind === "normal" && permanentRow.eventTime && (
          <span className="text-muted-foreground">
            {" · "}
            {formatTime(permanentRow.eventTime)}
            {permanentRow.endTime ? `–${formatTime(permanentRow.endTime)}` : ""}
          </span>
        )}
      </span>
      <span className="flex shrink-0 gap-2">
        {resolved.kind === "cancelled" ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(() => actions.uncancelScheduleOccurrence(permanentRow.id, date))}
            className="text-accent-business hover:underline"
          >
            Undo cancel
          </button>
        ) : (
          <>
            {resolved.kind === "override" ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(() => actions.removeWorkHoursOverride(permanentRow.id, date))}
                className="text-accent-business hover:underline"
              >
                Revert
              </button>
            ) : (
              <button type="button" onClick={() => setChangingHours(true)} className="text-muted-foreground hover:underline">
                Change hours
              </button>
            )}
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => actions.cancelScheduleOccurrence(permanentRow.id, date))}
              className="text-destructive hover:underline"
            >
              Cancel this week
            </button>
          </>
        )}
      </span>
    </li>
  );
}

/**
 * Item 4's Edit popup (2026-08-26 night batch 2): permanent work-hours CRUD
 * plus temporary this-week/next-week changes — a genuinely different axis
 * from School's class editor (Opus Lead: "a temporary CHANGE is a
 * different shape" from cancellation). See lib/tasks/schedule-cancellations.ts
 * for the resolver and actions-core.ts for the write-side rules governing
 * how a cancellation and an override on the same date interact.
 */
export function WorkHoursEditorDialog({
  permanentRows,
  oneOffRows,
  weekDates,
  nextWeekDates,
  exceptions,
  actions,
}: {
  permanentRows: PermanentWorkRow[];
  oneOffRows: OneOffWorkRow[];
  weekDates: string[];
  nextWeekDates: string[];
  exceptions: ExceptionsByEvent;
  actions: Actions;
}) {
  const [open, setOpen] = useState(false);

  function rowsForWeek(dates: string[]) {
    return dates.map((date) => {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const permanentRow = permanentRows.find((r) => r.dayOfWeek === dow) ?? null;
      const oneOffRow = oneOffRows.find((r) => r.eventDate === date) ?? null;
      return { date, permanentRow, oneOffRow };
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil className="size-3.5" aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Work hours</DialogTitle>
        </DialogHeader>
        <div className="-mx-1 flex min-h-0 flex-col gap-5 overflow-y-auto px-1">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Permanent hours</span>
            <ul className="flex flex-col gap-2">
              {permanentRows.map((row) => (
                <PermanentRow
                  key={row.id}
                  row={row}
                  onSave={(id, dayOfWeek, eventTime, endTime) =>
                    actions.updateWorkHours(id, { dayOfWeek, eventTime, endTime: endTime || undefined })
                  }
                  onRemove={(id) => actions.removeWorkHours(id)}
                />
              ))}
            </ul>
            <AddPermanentRow
              onAdd={(dayOfWeek, eventTime, endTime) => actions.addWorkHours(dayOfWeek, eventTime, endTime || undefined)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">This week</span>
            <ul className="flex flex-col gap-2">
              {rowsForWeek(weekDates).map(({ date, permanentRow, oneOffRow }) => (
                <OccurrenceRow
                  key={date}
                  date={date}
                  permanentRow={permanentRow}
                  oneOffRow={oneOffRow}
                  exceptions={exceptions}
                  actions={actions}
                />
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Next week</span>
            <ul className="flex flex-col gap-2">
              {rowsForWeek(nextWeekDates).map(({ date, permanentRow, oneOffRow }) => (
                <OccurrenceRow
                  key={date}
                  date={date}
                  permanentRow={permanentRow}
                  oneOffRow={oneOffRow}
                  exceptions={exceptions}
                  actions={actions}
                />
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
