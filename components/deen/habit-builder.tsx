"use client";

import { useState, useTransition } from "react";
import { Repeat } from "lucide-react";
import { toggleDeenHabitLog, setWeeklyFocus, createDeenHabit } from "@/app/(app)/deen/actions";
import { habitStage, type StageOverride } from "@/lib/deen/habit-stage";
import { HabitEditorDialog } from "@/components/deen/habit-editor-dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ConsistencyGrid, type ConsistencyRow } from "@/components/charts/consistency-grid";
import { ACCENT_VAR } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { featuredCardStyle } from "@/lib/featured-card-style";

export type DeenHabitData = {
  id: string;
  name: string;
  committedDate: string;
  /** Implementation-intention cue ("After Fajr") — see redesign proposal §1.
   * Null means never set; shown as a small tag, never fused into a sentence
   * with the habit name (concatenation reads as broken grammar for names
   * that weren't authored as verb phrases). */
  anchorCue: string | null;
  streak: number;
  /** Rolling count over the last 30 days (or since committed_date if
   * younger) — the primary progress signal now, not the hard-reset streak.
   * See redesign proposal §2 and lib/deen/habit-consistency.ts. */
  rollingRate: { done: number; total: number };
  completedToday: boolean;
  /** Manual pin set from the habit editor (item 6) — wins over the
   * committedDate-derived stage when set. See lib/deen/habit-stage.ts. */
  stageOverride: StageOverride;
};

// Reuses the on_time/positive-green semantic already established elsewhere
// on this page (PrayerRow, Prayer consistency) rather than inventing a new
// palette — and, just as importantly, is structurally distinct from
// whatever severity ramp the Reflection module's redesign uses, since this
// is a plain done/in-progress/not-done map, not an ordinal intensity scale.
//
// "in_progress" (today, not yet done) is deliberately neutral, not red —
// the day isn't over, so it hasn't actually been missed. Same
// upcoming-vs-missed distinction the prayer-windows work draws, applied
// here: painting today red is telling the user they failed at something
// they still have time to do.
const HABIT_STATUS_STYLE = {
  done: { colorVar: "--accent-business", treatment: "solid" as const, label: "Done" },
  in_progress: { colorVar: "--muted-foreground", treatment: "hollow" as const, label: "Today — not yet done" },
  missed: { colorVar: "--destructive", treatment: "hollow" as const, label: "Not done" },
};

const VISIBLE_HABIT_ROWS = 5;

function HabitToggleButton({
  habitId,
  todayStr,
  completed,
  onToggle,
}: {
  habitId: string;
  todayStr: string;
  completed: boolean;
  onToggle: (habitId: string, completed: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          onToggle(habitId, !completed);
          await toggleDeenHabitLog(habitId, todayStr);
        })
      }
      aria-label={completed ? "Mark incomplete" : "Mark complete"}
      className={cn(
        "size-5 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        completed ? "border-accent-deen bg-accent-deen" : "border-border"
      )}
    />
  );
}

function AnchorCueTag({ cue }: { cue: string | null }) {
  if (!cue) return null;
  return (
    <span className="mb-0.5 inline-block rounded-full bg-accent/50 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
      {cue}
    </span>
  );
}

function HabitRow({
  habit,
  todayStr,
  quiet,
  onToggle,
}: {
  habit: DeenHabitData;
  todayStr: string;
  quiet?: boolean;
  onToggle: (habitId: string, completed: boolean) => void;
}) {
  return (
    <li className={cn("flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2", quiet && "opacity-60")}>
      <HabitToggleButton habitId={habit.id} todayStr={todayStr} completed={habit.completedToday} onToggle={onToggle} />
      <span className="min-w-0 flex-1">
        <AnchorCueTag cue={habit.anchorCue} />
        <span className="block truncate text-sm">{habit.name}</span>
      </span>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-mono text-xs tabular-nums">
          {habit.rollingRate.done}/{habit.rollingRate.total}
        </span>
        {habit.streak > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{habit.streak}d streak</span>
        )}
      </div>
    </li>
  );
}

// Mirrors lib/deen/habit-stage.ts's own boundaries exactly (0-13 / 14-29 /
// 30+ days since committed_date) — shown, not just implied, per Ayman's
// explicit ask: "at least making it visible is easier to understand what
// goes where."
const STAGE_WINDOW: Record<string, string> = {
  "Active Build": "Days 0–13",
  Stabilized: "Days 14–29",
  Locked: "Day 30+",
};

function StageColumn({
  title,
  variant,
  habits,
  todayStr,
  quiet,
  onToggle,
}: {
  title: string;
  variant: BadgeVariant;
  habits: DeenHabitData[];
  todayStr: string;
  quiet?: boolean;
  onToggle: (habitId: string, completed: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2">
        <Badge variant={variant}>{title}</Badge>
        <span className="text-xs text-muted-foreground">{STAGE_WINDOW[title]}</span>
      </h3>
      {habits.length === 0 ? (
        <p className="text-xs text-muted-foreground">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {habits.map((h) => (
            <HabitRow key={h.id} habit={h} todayStr={todayStr} quiet={quiet} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </div>
  );
}

function HabitFocusPicker({
  candidates,
  onDone,
  onCancel,
}: {
  candidates: DeenHabitData[];
  onDone: (habitId: string, createdName?: string, createdAnchorCue?: string | null) => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [anchorCue, setAnchorCue] = useState("");

  function selectExisting(habitId: string) {
    startTransition(async () => {
      await setWeeklyFocus(habitId);
      onDone(habitId);
    });
  }

  function createAndFocus(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const trimmedCue = anchorCue.trim() || null;
    startTransition(async () => {
      const { id } = await createDeenHabit(trimmed, anchorCue);
      await setWeeklyFocus(id);
      onDone(id, trimmed, trimmedCue);
      setNewName("");
      setAnchorCue("");
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border/60 p-3">
      {candidates.length > 0 && (
        <div className="flex flex-col gap-1">
          {candidates.map((h) => (
            <button
              key={h.id}
              type="button"
              disabled={isPending}
              onClick={() => selectExisting(h.id)}
              className="rounded-md px-2 py-1 text-left text-sm hover:bg-accent/40 disabled:opacity-50"
            >
              {h.name}
            </button>
          ))}
        </div>
      )}
      {/* Deliberately two separate fields, not "After ___ I will ___" laid
          out as a sentence — the evidence (Gollwitzer & Sheeran) is about
          stating and rehearsing the if-then link, not about grammatical
          fusion, and a sentence-shaped pair of inputs would drag the same
          "reads oddly for names that aren't verb phrases" problem into the
          create form that the row display avoids by using a tag instead. */}
      <form onSubmit={createAndFocus} className="flex flex-col gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Describe the habit — e.g. Read one page of Qur'an"
        />
        <Input
          value={anchorCue}
          onChange={(e) => setAnchorCue(e.target.value)}
          placeholder="Cue (optional) — e.g. After Fajr"
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={isPending}>
            Start
          </Button>
          {/* The only way out of this section used to be refreshing the page —
              this is the fix. Plain, always available, no side effects. */}
          <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

export function HabitBuilder({
  todayStr,
  habits: initialHabits,
  currentFocusHabitId,
  habitConsistencyRows,
}: {
  todayStr: string;
  habits: DeenHabitData[];
  currentFocusHabitId: string | null;
  /** One ConsistencyGrid row per active habit — a single shared grid, not
   * one grid per habit, so the cross-habit comparison ("one habit's
   * carrying, another's gone dark") is visible at a glance. See redesign
   * proposal §2 and lib/deen/habit-consistency.ts's buildHabitConsistencyRows. */
  habitConsistencyRows: ConsistencyRow[];
}) {
  const [habits, setHabits] = useState(initialHabits);
  const [focusHabitId, setFocusHabitId] = useState(currentFocusHabitId);
  const [showPicker, setShowPicker] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  function handleToggle(habitId: string, completed: boolean) {
    setHabits((prev) => prev.map((h) => (h.id === habitId ? { ...h, completedToday: completed } : h)));
  }

  function handleFocusChosen(habitId: string, createdName?: string, createdAnchorCue?: string | null) {
    setFocusHabitId(habitId);
    setShowPicker(false);
    setHabits((prev) =>
      prev.some((h) => h.id === habitId)
        ? prev
        : [
            ...prev,
            {
              id: habitId,
              name: createdName ?? "New habit",
              committedDate: todayStr,
              anchorCue: createdAnchorCue ?? null,
              streak: 0,
              // Committed today, not yet done today — today doesn't count
              // against the rate until it's either completed or over (see
              // computeHabitRollingRate), so the honest optimistic value is
              // 0/0, not 0/1.
              rollingRate: { done: 0, total: 0 },
              completedToday: false,
              stageOverride: null,
            },
          ]
    );
  }

  const activeBuild = habits.filter((h) => habitStage(h.committedDate, todayStr, h.stageOverride) === "active_build");
  const stabilized = habits.filter((h) => habitStage(h.committedDate, todayStr, h.stageOverride) === "stabilized");
  const locked = habits.filter((h) => habitStage(h.committedDate, todayStr, h.stageOverride) === "locked");

  const focusHabit = habits.find((h) => h.id === focusHabitId) ?? null;

  const visibleRows = showAllRows ? habitConsistencyRows : habitConsistencyRows.slice(0, VISIBLE_HABIT_ROWS);
  const hiddenRowCount = habitConsistencyRows.length - VISIBLE_HABIT_ROWS;

  return (
    <div className="flex flex-col gap-4">
      {showPicker ? (
        <HabitFocusPicker
          candidates={activeBuild.filter((h) => h.id !== focusHabitId)}
          onDone={handleFocusChosen}
          onCancel={() => setShowPicker(false)}
        />
      ) : focusHabit ? (
        <div
          data-testid="habit-focus-card"
          // Two buttons plus a toggle plus a full text stack don't fit on
          // one row at 390px, and min-w-0 alone can't make them — this row
          // stacks on mobile and goes back to one row at sm: (640px), well
          // above Ayman's 390px phone. Measured 2026-08-28.
          className="flex flex-col items-start gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
          style={featuredCardStyle(ACCENT_VAR.deen)}
        >
          <div className="flex min-w-0 items-center gap-3">
            <IconChip icon={DOMAIN_ICON.deen} accent="deen" />
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">This week&apos;s focus</div>
              <AnchorCueTag cue={focusHabit.anchorCue} />
              <div className="truncate font-medium">{focusHabit.name}</div>
              <div className="font-mono text-xs text-muted-foreground tabular-nums">
                {focusHabit.rollingRate.done}/{focusHabit.rollingRate.total} last 30 days
                {focusHabit.streak > 0 && ` · ${focusHabit.streak}d streak`}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 self-stretch sm:self-auto">
            {/* Was a 12px muted text link labeled "Edit" — Ayman's exact
                complaint was that adding a habit is hidden behind it. A
                real, clearly-labeled button in its place. */}
            <Button type="button" variant="outline" size="sm" onClick={() => setShowPicker(true)}>
              Add a habit
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowEditor(true)}>
              Edit
            </Button>
            <HabitToggleButton
              habitId={focusHabit.id}
              todayStr={todayStr}
              completed={focusHabit.completedToday}
              onToggle={handleToggle}
            />
          </div>
        </div>
      ) : (
        // Only when there's already at least one habit to pick a focus
        // from — with zero habits, the EmptyState below already owns the
        // "add one" prompt. Spec (2026-08-23 §5): the old "Pick this week's
        // focus habit" dashed prompt (plus its "Continue with X" branch) is
        // replaced outright by one plain button.
        habits.length > 0 && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setShowPicker(true)}>
              Create New Habit
            </Button>
            {/* Ayman: "there is no option to edit/remove habits, add this by
                creating an 'Edit' button next to the Create new Habit
                button" (item 6). */}
            <Button type="button" variant="outline" onClick={() => setShowEditor(true)}>
              Edit
            </Button>
          </div>
        )
      )}

      {/* Opus Lead review (2026-08-16): with zero habits, all three columns
          independently render "None yet." — three copies of the same
          non-message. A real per-stage empty ("None yet.") is legitimate
          once at least one habit exists somewhere; it's only noise when
          there's nothing at all, so that case gets one shared EmptyState
          instead of three. */}
      {habits.length === 0 ? (
        // Suppressed while the picker is already open above (showPicker) —
        // a second "Add a habit" prompt right below the real form it opens
        // is redundant, not a second real empty state.
        !showPicker && (
          <EmptyState
            icon={Repeat}
            message="No habits started yet"
            action={{ label: "Add a habit", onClick: () => setShowPicker(true) }}
          />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StageColumn title="Active Build" variant="info" habits={activeBuild} todayStr={todayStr} onToggle={handleToggle} />
            <StageColumn title="Stabilized" variant="positive" habits={stabilized} todayStr={todayStr} onToggle={handleToggle} />
            <StageColumn title="Locked" variant="neutral" habits={locked} todayStr={todayStr} quiet onToggle={handleToggle} />
          </div>

          {habitConsistencyRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Last 30 days</h3>
              <ConsistencyGrid rows={visibleRows} statusStyle={HABIT_STATUS_STYLE} showDateLabels />
              {hiddenRowCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllRows((v) => !v)}
                  className="self-start text-xs text-muted-foreground hover:text-foreground"
                >
                  {showAllRows ? "Show fewer" : `Show ${hiddenRowCount} more`}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <HabitEditorDialog
        open={showEditor}
        onOpenChange={setShowEditor}
        habits={habits}
        todayStr={todayStr}
        onHabitsChange={setHabits}
      />
    </div>
  );
}
