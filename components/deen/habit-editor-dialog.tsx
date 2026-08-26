"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";
import {
  updateDeenHabit,
  archiveDeenHabit,
  setDeenHabitStageOverride,
  setDeenHabitCommittedDate,
  setDeenHabitLogStatus,
  getDeenHabitLogRange,
} from "@/app/(app)/deen/actions";
import { habitStage, isStageOverridden, type HabitStage } from "@/lib/deen/habit-stage";
import { addDaysToDateString } from "@/lib/date-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DeenHabitData } from "@/components/deen/habit-builder";

const STAGE_ORDER: HabitStage[] = ["active_build", "stabilized", "locked"];
const STAGE_LABEL: Record<HabitStage, string> = {
  active_build: "Active Build",
  stabilized: "Stabilized",
  locked: "Locked",
};

// How many days back the Advanced screen's day-by-day grid covers — same
// window habit-consistency.ts's rolling rate reads, so what's editable here
// lines up with what the rolling-rate number on the main screen reflects.
const ADVANCED_LOG_WINDOW_DAYS = 30;

type EditorView = "main" | "advanced";

/**
 * One dialog, two screens (Ayman's spec, verbatim: "keep the view in the
 * same popup module but just switch the popup screen contents") — a single
 * `view` state, not a nested dialog and not a route. Every edit here
 * persists immediately through its own Server Action (matches the app's
 * existing instant-persist pattern — prayer/task toggles, kill list, etc.),
 * so the "Save" button on each screen is a plain close, not a batched
 * commit — there's no local diff to lose if it's dismissed any other way.
 */
export function HabitEditorDialog({
  open,
  onOpenChange,
  habits,
  todayStr,
  onHabitsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habits: DeenHabitData[];
  todayStr: string;
  /** Optimistic local mirror — the caller (HabitBuilder) owns the list; this
   * dialog never holds its own copy that could drift from what the main
   * habit board shows once closed. */
  onHabitsChange: (updater: (prev: DeenHabitData[]) => DeenHabitData[]) => void;
}) {
  const [view, setView] = useState<EditorView>("main");
  const [advancedHabitId, setAdvancedHabitId] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setView("main"); // never reopen mid-advanced-screen from a stale state
  }

  function openAdvanced(habitId: string) {
    setAdvancedHabitId(habitId);
    setView("advanced");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto sm:max-w-2xl">
        {view === "main" ? (
          <MainScreen
            habits={habits}
            todayStr={todayStr}
            onHabitsChange={onHabitsChange}
            onAdvancedFor={openAdvanced}
            onAdvancedGlobal={() => openAdvanced(habits[0]?.id ?? "")}
            onSave={close}
          />
        ) : (
          <AdvancedScreen
            habits={habits}
            todayStr={todayStr}
            selectedHabitId={advancedHabitId}
            onSelectHabit={setAdvancedHabitId}
            onHabitsChange={onHabitsChange}
            onBack={() => setView("main")}
            onSave={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MainScreen({
  habits,
  todayStr,
  onHabitsChange,
  onAdvancedFor,
  onAdvancedGlobal,
  onSave,
}: {
  habits: DeenHabitData[];
  todayStr: string;
  onHabitsChange: (updater: (prev: DeenHabitData[]) => DeenHabitData[]) => void;
  onAdvancedFor: (habitId: string) => void;
  onAdvancedGlobal: () => void;
  onSave: () => void;
}) {
  const grouped: Record<HabitStage, DeenHabitData[]> = { active_build: [], stabilized: [], locked: [] };
  for (const h of habits) {
    grouped[habitStage(h.committedDate, todayStr, h.stageOverride)].push(h);
  }

  return (
    <>
      <DialogHeader className="flex-row items-center justify-between space-y-0">
        <DialogTitle>Edit habits</DialogTitle>
        {/* Corner "Advanced" button (Ayman's spec) — global, not per-row;
            opens the second screen with no habit pre-selected if there's
            more than one, or the only habit selected automatically. Not
            disabled at zero habits — the Advanced screen has its own empty
            state, same as this one, rather than blocking navigation to it. */}
        <Button type="button" variant="ghost" size="sm" onClick={onAdvancedGlobal}>
          Advanced
        </Button>
      </DialogHeader>

      {habits.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No habits yet — nothing to edit.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {STAGE_ORDER.map((stage) => (
            <StageGroup
              key={stage}
              stage={stage}
              habits={grouped[stage]}
              todayStr={todayStr}
              onHabitsChange={onHabitsChange}
              onAdvancedFor={onAdvancedFor}
            />
          ))}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="button" onClick={onSave}>
          Save
        </Button>
      </div>
    </>
  );
}

function StageGroup({
  stage,
  habits,
  todayStr,
  onHabitsChange,
  onAdvancedFor,
}: {
  stage: HabitStage;
  habits: DeenHabitData[];
  todayStr: string;
  onHabitsChange: (updater: (prev: DeenHabitData[]) => DeenHabitData[]) => void;
  onAdvancedFor: (habitId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3>
        <Badge variant="neutral">{STAGE_LABEL[stage]}</Badge>
      </h3>
      {habits.length === 0 ? (
        <p className="text-xs text-muted-foreground">None in this stage.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {habits.map((h) => (
            <HabitEditRow
              key={h.id}
              habit={h}
              todayStr={todayStr}
              onHabitsChange={onHabitsChange}
              onAdvancedFor={onAdvancedFor}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function HabitEditRow({
  habit,
  todayStr,
  onHabitsChange,
  onAdvancedFor,
}: {
  habit: DeenHabitData;
  todayStr: string;
  onHabitsChange: (updater: (prev: DeenHabitData[]) => DeenHabitData[]) => void;
  onAdvancedFor: (habitId: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [name, setName] = useState(habit.name);
  const [anchorCue, setAnchorCue] = useState(habit.anchorCue ?? "");

  const currentStage = habitStage(habit.committedDate, todayStr, habit.stageOverride);
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const overridden = isStageOverridden(habit.stageOverride);

  function patchHabit(patch: Partial<DeenHabitData>) {
    onHabitsChange((prev) => prev.map((h) => (h.id === habit.id ? { ...h, ...patch } : h)));
  }

  function saveNameCue(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedCue = anchorCue.trim() || null;
    startTransition(async () => {
      await updateDeenHabit(habit.id, trimmedName, trimmedCue);
      patchHabit({ name: trimmedName, anchorCue: trimmedCue });
      setEditing(false);
    });
  }

  function remove() {
    startTransition(async () => {
      await archiveDeenHabit(habit.id);
      onHabitsChange((prev) => prev.filter((h) => h.id !== habit.id));
    });
  }

  function setStage(stage: HabitStage | null) {
    startTransition(async () => {
      await setDeenHabitStageOverride(habit.id, stage);
      patchHabit({ stageOverride: stage });
    });
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-border/40 p-3">
        <form onSubmit={saveNameCue} className="flex flex-col gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Habit name" />
          <Input
            value={anchorCue}
            onChange={(e) => setAnchorCue(e.target.value)}
            placeholder="Cue (optional) — e.g. Fajr"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              Save
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{habit.name}</span>
          {habit.anchorCue && <span className="text-xs text-muted-foreground">After {habit.anchorCue}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setEditing(true)}>
            Edit
          </Button>
          {/* Jumps straight to the Advanced screen pre-selecting this habit
              — deliberately NOT labeled "Advanced" too: two same-labeled
              buttons (this one and the dialog's corner button) would be
              genuinely ambiguous to a screen reader user, not just to a
              test's role query. */}
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => onAdvancedFor(habit.id)}>
            Edit history
          </Button>
          {confirmingRemove ? (
            <>
              <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={remove}>
                Confirm remove
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirmingRemove(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirmingRemove(true)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          Stage: <span className="font-medium text-foreground">{STAGE_LABEL[currentStage]}</span>
          {overridden && " (manually set)"}
        </span>
        {currentIndex < STAGE_ORDER.length - 1 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => setStage(STAGE_ORDER[currentIndex + 1])}
          >
            Advance to {STAGE_LABEL[STAGE_ORDER[currentIndex + 1]]}
          </Button>
        )}
        {STAGE_ORDER.slice(0, currentIndex).map((earlierStage) => (
          <Button
            key={earlierStage}
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => setStage(earlierStage)}
          >
            Move back to {STAGE_LABEL[earlierStage]}
          </Button>
        ))}
        {overridden && (
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setStage(null)}>
            Reset to automatic
          </Button>
        )}
      </div>
    </li>
  );
}

function AdvancedScreen({
  habits,
  todayStr,
  selectedHabitId,
  onSelectHabit,
  onHabitsChange,
  onBack,
  onSave,
}: {
  habits: DeenHabitData[];
  todayStr: string;
  selectedHabitId: string | null;
  onSelectHabit: (habitId: string) => void;
  onHabitsChange: (updater: (prev: DeenHabitData[]) => DeenHabitData[]) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const selectedHabit = habits.find((h) => h.id === selectedHabitId) ?? habits[0] ?? null;
  const [isPending, startTransition] = useTransition();
  const [committedDate, setCommittedDate] = useState(selectedHabit?.committedDate ?? todayStr);
  const [logsByDate, setLogsByDate] = useState<Record<string, boolean>>({});
  const [loadingLogs, setLoadingLogs] = useState(false);

  const startDate = addDaysToDateString(todayStr, -(ADVANCED_LOG_WINDOW_DAYS - 1));
  const dayRange: string[] = [];
  for (let i = 0; i < ADVANCED_LOG_WINDOW_DAYS; i++) dayRange.push(addDaysToDateString(startDate, i));
  // Most recent day first — that's the one a user editing history cares about first.
  const dayRangeDescending = [...dayRange].reverse();

  useEffect(() => {
    if (!selectedHabit) return;
    setCommittedDate(selectedHabit.committedDate);
    setLoadingLogs(true);
    getDeenHabitLogRange(selectedHabit.id, startDate, todayStr)
      .then((rows) => {
        const map: Record<string, boolean> = {};
        for (const row of rows) map[row.date] = row.completed;
        setLogsByDate(map);
      })
      .finally(() => setLoadingLogs(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHabit?.id]);

  if (!selectedHabit) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Advanced habit settings</DialogTitle>
        </DialogHeader>
        <p className="py-8 text-center text-sm text-muted-foreground">No habits yet — nothing to configure.</p>
        <div className="flex items-center justify-between pt-2">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
            <ArrowLeft />
          </Button>
          <Button type="button" onClick={onSave}>
            Save
          </Button>
        </div>
      </>
    );
  }

  function handleCommittedDateChange(value: string) {
    if (value > todayStr) return; // never offer a future date, belt-and-suspenders with the server check
    setCommittedDate(value);
    startTransition(async () => {
      await setDeenHabitCommittedDate(selectedHabit!.id, value);
      onHabitsChange((prev) => prev.map((h) => (h.id === selectedHabit!.id ? { ...h, committedDate: value } : h)));
    });
  }

  function toggleDay(date: string) {
    if (date > todayStr) return; // never allow marking a future date
    const nextCompleted = !(logsByDate[date] ?? false);
    setLogsByDate((prev) => ({ ...prev, [date]: nextCompleted }));
    startTransition(async () => {
      await setDeenHabitLogStatus(selectedHabit!.id, date, nextCompleted);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Advanced habit settings</DialogTitle>
      </DialogHeader>

      {habits.length > 1 && (
        <Select value={selectedHabit.id} onValueChange={onSelectHabit}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {habits.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="habit-committed-date" className="text-xs font-medium text-muted-foreground">
          Started on
        </label>
        <Input
          id="habit-committed-date"
          type="date"
          value={committedDate}
          max={todayStr}
          onChange={(e) => handleCommittedDateChange(e.target.value)}
          className="w-40"
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Last {ADVANCED_LOG_WINDOW_DAYS} days — tap a day to toggle done/not done
        </span>
        {loadingLogs ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {dayRangeDescending.map((date) => {
              const completed = logsByDate[date] ?? false;
              return (
                <li key={date} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-accent/30">
                  <span className="text-sm">{date}</span>
                  <Button
                    type="button"
                    variant={completed ? "default" : "outline"}
                    size="sm"
                    disabled={isPending}
                    onClick={() => toggleDay(date)}
                  >
                    {completed ? "Done" : "Not done"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <Button type="button" onClick={onSave}>
          Save
        </Button>
      </div>
    </>
  );
}
