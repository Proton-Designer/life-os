"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";
import {
  updateDeenHabit,
  archiveDeenHabit,
  setDeenHabitStageOverride,
  setDeenHabitCommittedDate,
  setDeenHabitLogStatus,
  setDeenHabitFrequency,
  getDeenHabitLogRange,
} from "@/app/(app)/deen/actions";
import { FrequencyPicker, isFrequencyValid } from "@/components/habits/frequency-picker";
import { computeDueState, describeFrequency, formatAdherence, normalizeFrequency, streakLabel, type HabitFrequency } from "@/lib/habits/frequency";
import { habitStage, isStageOverridden, type HabitStage } from "@/lib/deen/habit-stage";
import { addDaysToDateString } from "@/lib/date-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DeenHabitData } from "@/components/deen/habit-builder";
import { useScheduleRefresh } from "@/components/deen/use-optimistic-item";

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
  onSave,
}: {
  habits: DeenHabitData[];
  todayStr: string;
  onHabitsChange: (updater: (prev: DeenHabitData[]) => DeenHabitData[]) => void;
  onAdvancedFor: (habitId: string) => void;
  onSave: () => void;
}) {
  const grouped: Record<HabitStage, DeenHabitData[]> = { active_build: [], stabilized: [], locked: [] };
  for (const h of habits) {
    grouped[habitStage(h.committedDate, todayStr, h.stageOverride)].push(h);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit habits</DialogTitle>
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

// Names the actual consequence of a hard delete (deen_habit_logs and
// deen_weekly_focus both CASCADE from deen_habits — there is no undo, and no
// soft-delete/archive here) using only data already on the habit object, so
// the confirm dialog never needs its own query. Precedent shape:
// task-card.tsx's delete-confirm dialog.
function removeConsequence(habit: DeenHabitData): string {
  const hasHistory = habit.streak > 0 || habit.rollingRate.total > 0;
  if (!hasHistory) {
    return `Removing “${habit.name}” can’t be undone.`;
  }
  const rate = `${formatAdherence(habit.rollingRate)} last 30 days`;
  // A daily habit keeps its original wording ("3-day streak"); the other cadences use their own unit ("2 wk streak").
  const streak = habit.streakInfo && habit.streakInfo.unit !== "day" ? streakLabel(habit.streakInfo) : `${habit.streak}-day streak`;
  const stats = habit.streak > 0 ? `${streak}, ${rate}` : rate;
  return `Removing “${habit.name}” also deletes its logged history (${stats}). This can’t be undone.`;
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
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const currentStage = habitStage(habit.committedDate, todayStr, habit.stageOverride);
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const overridden = isStageOverridden(habit.stageOverride);

  function patchHabit(patch: Partial<DeenHabitData>) {
    onHabitsChange((prev) => prev.map((h) => (h.id === habit.id ? { ...h, ...patch } : h)));
  }

  function remove() {
    setConfirmingRemove(false);
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

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{habit.name}</span>
          {habit.anchorCue && <span className="text-xs text-muted-foreground">{habit.anchorCue}</span>}
          <span className="block text-xs text-muted-foreground" data-testid="habit-edit-frequency">
            {describeFrequency(habit.frequency)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Single entry point for everything about this habit — name/cue,
              start date, and day-by-day history — all now live on the
              Advanced screen this jumps to. */}
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => onAdvancedFor(habit.id)}>
            Edit
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirmingRemove(true)}>
            Remove
          </Button>
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

      <Dialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this habit?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{removeConsequence(habit)}</p>
          <DialogFooter>
            <Button type="button" variant="destructive" disabled={isPending} onClick={remove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const scheduleRefresh = useScheduleRefresh();
  const [isPending, startTransition] = useTransition();
  const [committedDate, setCommittedDate] = useState(selectedHabit?.committedDate ?? todayStr);
  const [name, setName] = useState(selectedHabit?.name ?? "");
  const [anchorCue, setAnchorCue] = useState(selectedHabit?.anchorCue ?? "");
  const [logsByDate, setLogsByDate] = useState<Record<string, boolean>>({});
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [frequency, setFrequency] = useState<HabitFrequency>(selectedHabit?.frequency ?? { kind: "daily" });
  const [frequencyError, setFrequencyError] = useState<string | null>(null);

  const startDate = addDaysToDateString(todayStr, -(ADVANCED_LOG_WINDOW_DAYS - 1));
  const dayRange: string[] = [];
  for (let i = 0; i < ADVANCED_LOG_WINDOW_DAYS; i++) dayRange.push(addDaysToDateString(startDate, i));
  // Most recent day first — that's the one a user editing history cares about first.
  const dayRangeDescending = [...dayRange].reverse();

  useEffect(() => {
    if (!selectedHabit) return;
    setCommittedDate(selectedHabit.committedDate);
    setName(selectedHabit.name);
    setAnchorCue(selectedHabit.anchorCue ?? "");
    setFrequency(selectedHabit.frequency);
    setFrequencyError(null);
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
          <DialogTitle>Edit habit</DialogTitle>
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

  function saveNameCue() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedCue = anchorCue.trim() || null;
    startTransition(async () => {
      await updateDeenHabit(selectedHabit!.id, trimmedName, trimmedCue);
      onHabitsChange((prev) =>
        prev.map((h) => (h.id === selectedHabit!.id ? { ...h, name: trimmedName, anchorCue: trimmedCue } : h))
      );
    });
  }

  function saveFrequency() {
    if (!isFrequencyValid(frequency)) return;
    const canonical = normalizeFrequency(frequency);
    setFrequencyError(null);
    startTransition(async () => {
      try {
        await setDeenHabitFrequency(selectedHabit!.id, canonical);
        setFrequency(canonical);
        onHabitsChange((prev) =>
          prev.map((h) =>
            h.id === selectedHabit!.id
              ? {
                  ...h,
                  frequency: canonical,
                  // Re-derive today's state under the new cadence now; the debounced refresh brings the exact server numbers.
                  due: computeDueState(canonical, todayStr, { completedDates: h.completedToday ? [todayStr] : [], committedDate: h.committedDate }),
                }
              : h
          )
        );
        scheduleRefresh();
      } catch {
        setFrequencyError("Couldn't save that — try again.");
      }
    });
  }

  function toggleDay(date: string) {
    if (date > todayStr) return; // never allow marking a future date
    const nextCompleted = !(logsByDate[date] ?? false);
    setLogsByDate((prev) => ({ ...prev, [date]: nextCompleted }));
    startTransition(async () => {
      await setDeenHabitLogStatus(selectedHabit!.id, date, nextCompleted);
      // The action no longer revalidates (PERF-1): one deferred refresh re-syncs streaks/Home.
      scheduleRefresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit habit</DialogTitle>
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

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="habit-name" className="text-xs font-medium text-muted-foreground">
            Name
          </label>
          <Input id="habit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Habit name" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="habit-cue" className="text-xs font-medium text-muted-foreground">
            Cue (optional)
          </label>
          <Input
            id="habit-cue"
            value={anchorCue}
            onChange={(e) => setAnchorCue(e.target.value)}
            placeholder="e.g. After Fajr"
          />
        </div>
        <Button
          type="button"
          size="sm"
          className="self-start"
          disabled={isPending || !name.trim()}
          onClick={saveNameCue}
        >
          Save name
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">How often</span>
        <FrequencyPicker value={frequency} onChange={setFrequency} disabled={isPending} idPrefix="deen-edit-habit" />
        {frequencyError && <p className="text-xs text-destructive">{frequencyError}</p>}
        <Button
          type="button"
          size="sm"
          className="self-start"
          disabled={isPending || !isFrequencyValid(frequency) || describeFrequency(normalizeFrequency(frequency)) === describeFrequency(selectedHabit.frequency)}
          onClick={saveFrequency}
        >
          Save frequency
        </Button>
        <p className="text-[11px] text-muted-foreground">Your logged history is kept — it is simply read under the new rule.</p>
      </div>

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
