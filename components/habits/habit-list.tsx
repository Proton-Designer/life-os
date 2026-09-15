"use client";

import { useState, useTransition } from "react";
import { Check, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createIdentityHabitAction,
  archiveIdentityHabitAction,
  castHabitVoteAction,
  retractHabitVoteAction,
} from "@/app/(app)/habits/actions";
import { MAX_ACTIVE_HABITS } from "@/lib/habits/actions-core";
import type { HabitWithStatus } from "@/lib/habits/queries";

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

function HabitRow({
  habit,
  today,
  onVoteChange,
  onArchive,
}: {
  habit: HabitWithStatus;
  today: string;
  onVoteChange: (habitId: string, voted: boolean) => void;
  onArchive: (habitId: string) => void;
}) {
  const [voted, setVoted] = useState(habit.votedToday);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleVote() {
    setError(null);
    const next = !voted;
    setVoted(next);
    onVoteChange(habit.id, next);
    startTransition(async () => {
      const res = next ? await castHabitVoteAction(habit.id, today) : await retractHabitVoteAction(habit.id, today);
      if ("error" in res) {
        setError(res.error);
        setVoted(!next);
        onVoteChange(habit.id, !next);
      }
    });
  }

  function archive() {
    setError(null);
    startTransition(async () => {
      const res = await archiveIdentityHabitAction(habit.id);
      if ("error" in res) {
        setError(res.error);
      } else {
        onArchive(habit.id);
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
            disabled={isPending}
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
            disabled={isPending}
            onClick={archive}
            aria-label="Archive this habit"
            title="Archive"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
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

export function HabitList({ habits, today }: { habits: HabitWithStatus[]; today: string }) {
  const [allHabits, setAllHabits] = useState(habits);
  const [adding, setAdding] = useState(false);

  const atCeiling = allHabits.length >= MAX_ACTIVE_HABITS;

  function handleVoteChange(habitId: string, voted: boolean) {
    setAllHabits((prev) => prev.map((h) => (h.id === habitId ? { ...h, votedToday: voted } : h)));
  }

  function handleArchive(habitId: string) {
    setAllHabits((prev) => prev.filter((h) => h.id !== habitId));
  }

  function handleAdded(habit: NewHabit) {
    setAllHabits((prev) => [
      ...prev,
      { id: habit.id, identityStatement: habit.identityStatement, rank: habit.rank, votedToday: false, isNew: true, score: null },
    ]);
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Your identities</span>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {allHabits.length}/{MAX_ACTIVE_HABITS}
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
              <HabitRow key={habit.id} habit={habit} today={today} onVoteChange={handleVoteChange} onArchive={handleArchive} />
            ))}
        </ul>
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
