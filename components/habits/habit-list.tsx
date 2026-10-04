"use client";

import { useState, useTransition } from "react";
import { Check, Circle, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createIdentityHabitAction,
  castHabitVoteAction,
  retractHabitVoteAction,
  pauseIdentityHabitAction,
  resumeIdentityHabitAction,
  refreshHabitViews,
} from "@/app/(app)/habits/actions";
import { MAX_ACTIVE_HABITS } from "@/lib/habits/constants";
import type { HabitWithStatus, PausedHabit } from "@/lib/habits/queries";
import { useOptimisticItem } from "@/lib/client/use-optimistic-item";
import { KillHabitDialog } from "@/components/habits/kill-habit-dialog";

/**
 * The Habits board (#39/#40/#41) -- up to 7 identity-statement habits, each
 * with a tap-to-affirm/tap-to-retract vote for today and a decaying score
 * replayed from the vote log (never stored -- lib/habits/decay-score.ts).
 *
 * Server actions are IMPORTED here, not passed as props -- same discipline
 * as components/worries/worry-list.tsx and components/goals/goal-board.tsx
 * (the RSC function-prop hazard CLAUDE.md records).
 *
 * SET, NOT TOGGLE, on the wire (actions-core.ts's own doctrine): a vote tap
 * calls `castHabitVoteAction` or `retractHabitVoteAction` depending on the
 * NEW state, never a single "flip whatever it is" action. Optimistic
 * locally, corrected by the server -- rolled back if the write is rejected
 * (e.g. the today-only rule firing because the tab's been open since
 * yesterday), same shape as WorryList's handle/reopen.
 *
 * `today` is a plain string prop, computed server-side by the page
 * (`localDateString(now, timezone)`) -- never derived in this client
 * component, and never a function prop (CLAUDE.md's hard rule).
 *
 * P3-07 -- Pause/Resume, alongside Kill: pausing is reversible (no
 * confirmation dialog, unlike Kill) and FREEZES the decaying score rather
 * than ending the habit (lib/habits/actions-core.ts's own header on
 * `pauseIdentityHabitCore` has the full reasoning). A paused habit moves
 * out of the active board into its own "Paused" section below, with a
 * Resume button -- no score/vote affordance shown there, since both are
 * meaningless while paused.
 */

function ScoreBadge({ habit }: { habit: HabitWithStatus }) {
  if (habit.isNew) {
    return (
      <span
        className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        title="Under 7 days old -- refuses to judge this habit yet"
      >
        New
      </span>
    );
  }
  const pct = Math.round((habit.score ?? 0) * 100);
  return (
    <span
      className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums"
      title="Decaying score, replayed from the vote log every time -- never stored"
    >
      {pct}%
    </span>
  );
}

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshHabits = () => refreshHabitViews();

function HabitRow({
  habit,
  today,
  onVoteChange,
  onArchive,
  onPause,
}: {
  habit: HabitWithStatus;
  today: string;
  onVoteChange: (habitId: string, voted: boolean) => void;
  onArchive: (habitId: string) => void;
  onPause: (habit: HabitWithStatus) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [killDialogOpen, setKillDialogOpen] = useState(false);
  const [pausePending, startPauseTransition] = useTransition();

  // PERF-2: per-habit optimistic vote -- instant, ordered absolute cast/retract writes
  // (last tap wins), nothing disabled while one saves, one deferred refresh.
  const vote = useOptimisticItem<boolean>({
    serverValue: habit.votedToday,
    queueKey: `habit-vote:${habit.id}:${today}`,
    write: async (next) => {
      const res = next ? await castHabitVoteAction(habit.id, today) : await retractHabitVoteAction(habit.id, today);
      if ("error" in res) throw new Error(res.error);
    },
    onRevert: (confirmed) => onVoteChange(habit.id, confirmed),
    refresh: refreshHabits,
  });
  const voted = vote.value;
  const voteError = vote.error;

  function toggleVote() {
    setError(null);
    const next = !voted;
    onVoteChange(habit.id, next);
    void vote.set(next);
  }

  function handlePause() {
    setError(null);
    startPauseTransition(async () => {
      const res = await pauseIdentityHabitAction(habit.id);
      if ("error" in res) {
        setError(res.error);
      } else {
        onPause(habit);
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant={voted ? "default" : "outline"}
            size="icon"
            className="shrink-0 rounded-full"
            onClick={toggleVote}
            aria-pressed={voted}
            aria-label={voted ? "Retract today's vote" : "Vote for this identity today"}
          >
            {voted ? <Check className="size-4" aria-hidden /> : <Circle className="size-4" aria-hidden />}
          </Button>
          <span className="truncate text-sm font-medium">{habit.identityStatement}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ScoreBadge habit={habit} />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={pausePending}
            onClick={handlePause}
            aria-label="Pause this habit"
            title="Pause — freezes the score, doesn't end the habit"
          >
            <Pause className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setKillDialogOpen(true)}
            aria-label="Kill this habit"
            title="Kill"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      {(error ?? voteError) && <p className="text-xs text-destructive">{error ?? voteError}</p>}
      <KillHabitDialog
        open={killDialogOpen}
        onOpenChange={setKillDialogOpen}
        habitId={habit.id}
        identityStatement={habit.identityStatement}
        voteCount={habit.voteCount}
        onKilled={onArchive}
      />
    </li>
  );
}

function PausedHabitRow({ habit, onResume }: { habit: PausedHabit; onResume: (habitId: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleResume() {
    setError(null);
    startTransition(async () => {
      const res = await resumeIdentityHabitAction(habit.id);
      if ("error" in res) {
        setError(res.error);
      } else {
        onResume(habit.id);
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-dashed border-border/40 bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-muted-foreground">{habit.identityStatement}</span>
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleResume} className="shrink-0 gap-1.5">
          <Play className="size-3.5" aria-hidden />
          {isPending ? "Resuming…" : "Resume"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}

type NewHabit = { id: string; identityStatement: string; rank: number };

function AddHabitForm({ onAdded, onCancel }: { onAdded: (habit: NewHabit) => void; onCancel: () => void }) {
  const [statement, setStatement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = statement.trim();
        if (!trimmed) return;
        startTransition(async () => {
          const res = await createIdentityHabitAction(trimmed);
          if ("error" in res) {
            setError(res.error);
          } else {
            onAdded(res.habit);
          }
        });
      }}
    >
      <Input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder='Identity statement, e.g. "the athlete"' autoFocus />
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || !statement.trim()}>
          Add habit
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function HabitList({
  habits,
  pausedHabits,
  today,
}: {
  habits: HabitWithStatus[];
  pausedHabits: PausedHabit[];
  today: string;
}) {
  const [allHabits, setAllHabits] = useState(habits);
  const [pausedList, setPausedList] = useState(pausedHabits);
  const [adding, setAdding] = useState(false);

  // A paused habit still occupies its rank slot (migration 202: the rank
  // unique index covers 'active' AND 'paused' -- pausing isn't archiving,
  // so it doesn't free the slot up), so the ceiling is the COMBINED count.
  const totalOccupied = allHabits.length + pausedList.length;
  const atCeiling = totalOccupied >= MAX_ACTIVE_HABITS;

  function handleVoteChange(habitId: string, voted: boolean) {
    setAllHabits((prev) => prev.map((h) => (h.id === habitId ? { ...h, votedToday: voted } : h)));
  }

  function handleArchive(habitId: string) {
    setAllHabits((prev) => prev.filter((h) => h.id !== habitId));
  }

  function handleAdded(habit: NewHabit) {
    setAllHabits((prev) => [
      ...prev,
      { id: habit.id, identityStatement: habit.identityStatement, rank: habit.rank, votedToday: false, isNew: true, score: null, voteCount: 0 },
    ]);
    setAdding(false);
  }

  // Optimistic locally, corrected by the server -- same doctrine as the
  // vote toggle above. Pause/resume both move a habit between two lists
  // this component already has full data for (id/identityStatement/rank),
  // so no refetch is needed for the visible transition itself; a resumed
  // habit's real score/votedToday/isNew only matter once it's rendered in
  // the ACTIVE list again, which happens on the next natural navigation/
  // revalidation of the server-rendered /habits page (revalidatePath, done
  // server-side by the action already).
  function handlePause(habit: HabitWithStatus) {
    setAllHabits((prev) => prev.filter((h) => h.id !== habit.id));
    setPausedList((prev) => [...prev, { id: habit.id, identityStatement: habit.identityStatement, rank: habit.rank }]);
  }

  function handleResume(habitId: string) {
    setPausedList((prev) => prev.filter((h) => h.id !== habitId));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Your identities</span>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {totalOccupied}/{MAX_ACTIVE_HABITS}
        </span>
      </div>

      {allHabits.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/60 py-10 text-center">
          <p className="text-sm font-medium">No identity habits yet.</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Pick who you&apos;re becoming — up to seven identities — and vote for each one, once a day.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {allHabits
            .slice()
            .sort((a, b) => a.rank - b.rank)
            .map((habit) => (
              <HabitRow
                key={habit.id}
                habit={habit}
                today={today}
                onVoteChange={handleVoteChange}
                onArchive={handleArchive}
                onPause={handlePause}
              />
            ))}
        </ul>
      )}

      {pausedList.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted-foreground">Paused</span>
          <ul className="flex flex-col gap-2">
            {pausedList
              .slice()
              .sort((a, b) => a.rank - b.rank)
              .map((habit) => (
                <PausedHabitRow key={habit.id} habit={habit} onResume={handleResume} />
              ))}
          </ul>
        </div>
      )}

      {adding ? (
        <AddHabitForm onAdded={handleAdded} onCancel={() => setAdding(false)} />
      ) : atCeiling ? (
        <Button type="button" variant="outline" disabled className="w-fit" title={`All ${MAX_ACTIVE_HABITS} slots are in use`}>
          Ceiling reached — {MAX_ACTIVE_HABITS}/{MAX_ACTIVE_HABITS}
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)} className="w-fit">
          + Add an identity habit
        </Button>
      )}
    </div>
  );
}
