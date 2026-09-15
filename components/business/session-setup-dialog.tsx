"use client";

import { useEffect, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MAX_GOAL_MINUTES, parseGoalMinutes, parseGoalMinutesText } from "@/lib/business/session-goal";
// Imported directly, not threaded down as a prop from a Server Component —
// same pattern as app/(app)/close/plan-actions.ts's dumpLine (AGENTS.md: a
// Server Action reference survives the RSC boundary; importing removes the
// hazard rather than testing for it, and this dialog is exactly the shape
// that trips the alternative).
import { getClassTasksDueSoon, getSessionKillListObjectives, getSessionClasses } from "@/app/(app)/business/actions";
import type {
  ObjectiveTaskOption,
  KillListObjectiveOption,
  SessionClassOption,
  ObjectiveSelection,
  SessionStartPayload,
} from "@/lib/business/session-setup-data";
import type { LockInSessionKind } from "./lock-in-overlay-context";
import { KIND_LABEL } from "@/lib/business/work-session-kind";
import { cn } from "@/lib/utils";

export type { SessionClassOption, ObjectiveSelection, SessionStartPayload };

const MAX_HOURS = Math.floor(MAX_GOAL_MINUTES / 60);

/** The minutes slider's own ceiling given the current hours value — pre-clamps the two sliders so they can never combine into a total over MAX_GOAL_MINUTES; only the free-text field can produce an out-of-range value, and that path is validated (parseGoalMinutesText) rather than clamped. */
function maxMinutesForHours(hours: number): number {
  return hours >= MAX_HOURS ? 0 : 59;
}

/**
 * "One of those that they use for setting alarms" (Ayman) — two range
 * sliders plus a free-text field for an exact value, all three kept in
 * sync. `minutes` is the single source of truth, owned by the parent;
 * this component only ever derives hours/mins from it and reports a new
 * total back up, never holds its own copy of the chosen duration.
 */
function DurationPicker({
  minutes,
  onChange,
}: {
  minutes: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const hours = minutes === null ? 0 : Math.floor(minutes / 60);
  const mins = minutes === null ? 0 : minutes % 60;
  const [text, setText] = useState(minutes === null ? "" : String(minutes));
  const [textError, setTextError] = useState<string | null>(null);

  function setFromSliders(nextHours: number, nextMinutes: number) {
    const clamped = Math.min(nextMinutes, maxMinutesForHours(nextHours));
    try {
      const total = parseGoalMinutes(nextHours, clamped);
      setText(String(total));
      setTextError(null);
      onChange(total);
    } catch {
      // Both sliders at their floor (0h 0m) is a real resting position, not
      // an error — represent it as "no duration chosen yet" rather than
      // showing a validation message for where the control starts.
      setText("");
      onChange(null);
    }
  }

  function handleTextChange(next: string) {
    setText(next);
    if (next.trim() === "") {
      setTextError(null);
      onChange(null);
      return;
    }
    try {
      onChange(parseGoalMinutesText(next));
      setTextError(null);
    } catch (e) {
      setTextError(e instanceof Error ? e.message : "Enter a valid duration.");
      onChange(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-hidden
        className="flex items-baseline justify-center gap-1 font-mono text-4xl font-semibold tabular-nums"
      >
        <span>{hours}</span>
        <span className="text-base font-normal text-muted-foreground">h</span>
        <span>{String(mins).padStart(2, "0")}</span>
        <span className="text-base font-normal text-muted-foreground">m</span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="session-goal-hours" className="text-xs text-muted-foreground">
          Hours
        </label>
        <input
          id="session-goal-hours"
          type="range"
          min={0}
          max={MAX_HOURS}
          step={1}
          value={hours}
          aria-label="Hours"
          onChange={(e) => setFromSliders(Number(e.target.value), mins)}
          className="w-full"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="session-goal-minutes" className="text-xs text-muted-foreground">
          Minutes
        </label>
        <input
          id="session-goal-minutes"
          type="range"
          min={0}
          max={maxMinutesForHours(hours)}
          step={1}
          value={mins}
          aria-label="Minutes"
          onChange={(e) => setFromSliders(hours, Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="session-goal-text" className="text-xs text-muted-foreground">
          Or enter exact minutes
        </label>
        <Input
          id="session-goal-text"
          // inputMode="numeric" summons the digit-only keypad on a phone
          // (Ayman: the text input "must be usable on a phone keyboard")
          // without restricting what a hardware keyboard can type — the
          // actual validation is parseGoalMinutesText, not this attribute.
          inputMode="numeric"
          aria-label="Duration in minutes"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="e.g. 90"
          aria-invalid={textError !== null}
        />
        {textError && <p className="text-xs text-destructive">{textError}</p>}
      </div>
    </div>
  );
}

/** A single selectable objective row — a kill-list item or a class task.
 * Selection order (not list order) becomes `position`, shown as a badge. */
function ObjectiveRow({
  label,
  meta,
  selected,
  position,
  onToggle,
}: {
  label: string;
  meta?: string;
  selected: boolean;
  /** 1-indexed selection order; undefined/0 when not selected. */
  position?: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        selected ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50"
      )}
    >
      {selected ? (
        <Badge variant="positive" className="shrink-0">
          {position}
        </Badge>
      ) : (
        <span aria-hidden className="size-5 shrink-0 rounded-full border-2 border-border" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
    </button>
  );
}

function useOrderedSelection() {
  const [order, setOrder] = useState<string[]>([]);
  function toggle(id: string) {
    setOrder((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function positionOf(id: string): number | undefined {
    const i = order.indexOf(id);
    return i === -1 ? undefined : i + 1;
  }
  function reset() {
    setOrder([]);
  }
  return { order, toggle, positionOf, reset };
}

export function SessionSetupDialog({
  open,
  onOpenChange,
  kind,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: LockInSessionKind;
  onStart: (payload: SessionStartPayload) => Promise<void>;
}) {
  const [goalMinutes, setGoalMinutes] = useState<number | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [classes, setClasses] = useState<SessionClassOption[]>([]);
  const [classTasks, setClassTasks] = useState<ObjectiveTaskOption[]>([]);
  const [killListItems, setKillListItems] = useState<KillListObjectiveOption[]>([]);
  const [customText, setCustomText] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const killList = useOrderedSelection();
  const tasks = useOrderedSelection();
  const [isLoadingTasks, startLoadingTasks] = useTransition();
  const [isLoadingKillList, setIsLoadingKillList] = useState(false);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [isStarting, startStarting] = useTransition();
  const [startError, setStartError] = useState<string | null>(null);

  const isDeepStudy = kind === "deep_study";

  // Resets on the transition TO open, not on close. This component never
  // unmounts across a close/reopen cycle (the caller toggles `open`, it
  // doesn't conditionally render <SessionSetupDialog> — Radix's own
  // DialogContent may skip rendering its children while closed, but this
  // component's own useState hooks live at the SessionSetupDialog level
  // above that and are untouched by what Radix does internally), so a
  // reset tied to `handleOpenChange(false)` only fires when THIS component
  // is what closed the dialog — it would miss a parent that sets `open`
  // false for its own reason without going through here. Resetting on the
  // `open` transition instead covers every path a reopen can take.
  //
  // ALSO where Deep Work's kill-list objectives and Deep Study's classes
  // are fetched — on-demand, the moment the dialog opens, never threaded
  // down as a prop (see getSessionKillListObjectives's and
  // getSessionClasses's own comments for why: app-shell.tsx deliberately
  // does NOT fetch either on every navigation).
  useEffect(() => {
    if (open) {
      setGoalMinutes(null);
      setClassId(null);
      setClasses([]);
      setClassTasks([]);
      setKillListItems([]);
      setCustomText("");
      setShowCustomInput(false);
      killList.reset();
      tasks.reset();
      setStartError(null);
      // Plain async state, not useTransition, for both fetches below: this
      // runs on dialog OPEN (an effect), not from a click handler — the
      // case useTransition is designed around (marking a user-initiated
      // update as interruptible low priority). A loading flag that must
      // flip back to false the moment a fetch started on mount/open
      // resolves is a better fit for an ordinary state update than for a
      // transition (also: a `useTransition` started from inside an effect
      // was observed NOT to reliably clear its own `isPending` across a
      // close/reopen cycle in this component's own tests — plain state
      // sidesteps that entirely, whatever its cause).
      let cancelled = false;
      if (kind === "deep_work") {
        setIsLoadingKillList(true);
        getSessionKillListObjectives().then((items) => {
          if (!cancelled) {
            setKillListItems(items);
            setIsLoadingKillList(false);
          }
        });
      } else {
        setIsLoadingClasses(true);
        getSessionClasses().then((items) => {
          if (!cancelled) {
            setClasses(items);
            setIsLoadingClasses(false);
          }
        });
      }
      return () => {
        cancelled = true;
      };
    }
    // Deliberately keyed on `open`/`kind` only — the setters and .reset()
    // functions are stable enough for this component's lifetime and
    // including them would only make this effect's intent less legible,
    // same posture as lock-in-overlay-context.tsx's mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  function handlePickClass(id: string) {
    setClassId(id);
    // Switching classes invalidates any task selections made for the
    // previous one — a selected task id from class A means nothing (and
    // could collide with a same-shaped id) once class B's list replaces it.
    tasks.reset();
    setClassTasks([]);
    startLoadingTasks(async () => {
      const result = await getClassTasksDueSoon(id);
      setClassTasks(result);
    });
  }

  // #37: "can't start without typing what you'll produce" — Opus Lead's
  // ruling (2026-09-14) gates EVERY Lock-In session, not a distinct "Hour"
  // type. A selected kill-list item or class task already NAMES a
  // deliverable (it has its own title) — this only additionally requires
  // typed text from the free-form custom-objective field, so a real
  // selection never has to be re-typed on top of itself (ruling condition
  // 4). THE REAL GATE IS THE SERVER'S — startWorkSessionCore
  // (lib/business/actions-core.ts) throws if this doesn't hold; this is
  // only the client-side mirror so Start's disabled state has a legible
  // reason attached to it rather than being silently unclickable.
  const hasDeliverable = (isDeepStudy ? tasks.order.length > 0 : killList.order.length > 0) || customText.trim() !== "";

  const canStart =
    goalMinutes !== null &&
    (!isDeepStudy || classId !== null) &&
    hasDeliverable &&
    !isStarting &&
    !isLoadingTasks &&
    !isLoadingKillList &&
    !isLoadingClasses;

  function handleStart() {
    if (goalMinutes === null) return;
    if (isDeepStudy && classId === null) return;
    if (!hasDeliverable) return;

    const objectives: ObjectiveSelection[] = isDeepStudy
      ? tasks.order.map((id) => ({ kind: "task" as const, id }))
      : killList.order.map((id) => ({ kind: "kill_list_item" as const, id }));

    const trimmedCustom = customText.trim();
    if (trimmedCustom !== "") objectives.push({ kind: "custom", text: trimmedCustom });

    setStartError(null);
    startStarting(async () => {
      try {
        await onStart({ goalMinutes, classId: isDeepStudy ? classId : null, objectives });
        onOpenChange(false);
      } catch (e) {
        setStartError(e instanceof Error ? e.message : "Couldn't start the session. Try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{KIND_LABEL[kind]} — set a goal</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          <DurationPicker minutes={goalMinutes} onChange={setGoalMinutes} />

          {isDeepStudy ? (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Class</p>
                {isLoadingClasses ? (
                  <p className="text-sm text-muted-foreground">Loading classes…</p>
                ) : classes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No classes yet — add one on School first.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {classes.map((c) => (
                      <ObjectiveRow
                        key={c.id}
                        label={c.label}
                        selected={classId === c.id}
                        onToggle={() => handlePickClass(c.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {classId !== null && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Objectives — due in the next 14 days
                  </p>
                  {/* #37: this used to read "optional" nowhere explicitly, but
                      Study Material below had no indication it could be
                      required either — this section and the custom-objective
                      one in the Deep Work branch now both state the rule
                      plainly rather than leaving it to the disabled Start
                      button to explain. */}
                  <p className="text-xs text-muted-foreground">
                    Select a task, or add Study Material below — Start needs at least one.
                  </p>
                  {isLoadingTasks ? (
                    <p className="text-sm text-muted-foreground">Loading tasks…</p>
                  ) : classTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing due soon for this class — add Study Material below.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {classTasks.map((t) => (
                        <ObjectiveRow
                          key={t.id}
                          label={t.title}
                          meta={t.dueDate}
                          selected={tasks.order.includes(t.id)}
                          position={tasks.positionOf(t.id)}
                          onToggle={() => tasks.toggle(t.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant={showCustomInput ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setShowCustomInput((v) => !v);
                    if (showCustomInput) setCustomText("");
                  }}
                  className="self-start"
                >
                  Study Material
                </Button>
                {showCustomInput && (
                  <Input
                    aria-label="Study material"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="Topics or material to cover"
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Objectives</p>
                {/* #37: the field below used to read "(optional)", which
                    directly contradicted the gate a few lines down (Opus
                    Lead review, 2026-09-14) — this states the actual rule
                    instead of leaving it to a disabled Start button to imply. */}
                <p className="text-xs text-muted-foreground">
                  Select at least one item, or add a custom objective below — Start needs at least one.
                </p>
                {isLoadingKillList ? (
                  <p className="text-sm text-muted-foreground">Loading kill list…</p>
                ) : killListItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing on today's kill list yet — add a custom objective below.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {killListItems.map((item) => (
                      <ObjectiveRow
                        key={item.id}
                        label={item.text}
                        selected={killList.order.includes(item.id)}
                        position={killList.positionOf(item.id)}
                        onToggle={() => killList.toggle(item.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="session-custom-objective" className="text-xs text-muted-foreground">
                  Custom objective
                </label>
                <Input
                  id="session-custom-objective"
                  aria-label="Custom objective"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="What's the one thing?"
                />
              </div>
            </>
          )}

          {/* #37: mirrors the server's gate with a visible reason — never a
              silently disabled Start button. Only shown once the other
              fields are satisfied, so it doesn't compete with "pick a
              class"/"set a duration" for attention before those are done. */}
          {!hasDeliverable && goalMinutes !== null && (!isDeepStudy || classId !== null) && (
            <p className="text-xs text-muted-foreground">What will you produce? Select an objective or add one above.</p>
          )}

          {startError && <p className="text-sm text-destructive">{startError}</p>}

          <Button type="button" size="lg" disabled={!canStart} onClick={handleStart}>
            {isStarting ? "Starting…" : "Start"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
