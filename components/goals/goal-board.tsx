"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, CircleCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOptimisticItem } from "@/lib/client/use-optimistic-item";
import { formatShortDate } from "@/lib/date-utils";
import {
  createGoalAction,
  setGoalStatusAction,
  addMilestoneAction,
  setMilestoneDoneAction,
  refreshGoalViews,
} from "@/app/(app)/goals/actions";
import type { Goal } from "@/lib/goals/actions-core";
import type { GoalMilestone } from "@/lib/goals/queries";

/**
 * The Goals board (#43/#44) — this month's Top 5 ranked goals, each with a
 * reason and at most one milestone, plus the 5-goal ceiling surfaced
 * honestly rather than hidden.
 *
 * Server actions are IMPORTED, not passed as props (same discipline as
 * components/worries/worry-list.tsx) — the RSC function-prop hazard
 * CLAUDE.md records; importing removes the hazard rather than testing for
 * it.
 *
 * THE CEILING IS THE DATABASE'S (`goals_rank_per_month_idx`, migration
 * 165), not this component's rank list — this file computes "which ranks
 * look free" purely to steer the add form toward a rank the write is
 * actually likely to succeed at (and to word the button honestly when none
 * are), but the real refusal, including a race between two tabs, comes
 * back from `createGoalAction` as a real error and is shown, not swallowed.
 */

const RANKS = [1, 2, 3, 4, 5] as const;

const DOMAIN_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "No domain" },
  { value: "deen", label: "Personal" },
  { value: "business", label: "Business" },
  { value: "fitness", label: "Fitness" },
  { value: "school", label: "School" },
  { value: "co_op", label: "Work" },
];

function domainLabel(domain: string | null): string | null {
  if (!domain) return null;
  return DOMAIN_OPTIONS.find((d) => d.value === domain)?.label ?? domain;
}

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshGoals = () => refreshGoalViews();

function GoalMilestoneRow({
  goalId,
  monthStart,
  milestone,
}: {
  goalId: string;
  monthStart: string;
  milestone: GoalMilestone | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  // PERF-4: the milestone checkbox is per-item optimistic with ordered ABSOLUTE writes
  // (last tap wins) and never disabled while one saves; one deferred refresh.
  const doneItem = useOptimisticItem<boolean>({
    serverValue: milestone ? milestone.doneAt !== null : false,
    queueKey: `milestone:${milestone?.id ?? goalId}`,
    write: async (next) => {
      const res = await setMilestoneDoneAction(milestone!.id, next);
      if ("error" in res) throw new Error(res.error);
    },
    refresh: refreshGoals,
  });

  if (!milestone) {
    if (!adding) {
      return (
        <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(true)} className="w-fit text-xs">
          + Add this month's milestone
        </Button>
      );
    }
    return (
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const t = title.trim();
          if (!t) return;
          startTransition(async () => {
            const res = await addMilestoneAction({ goalId, monthStart, title: t });
            if ("error" in res) {
              setError(res.error);
            } else {
              setAdding(false);
              setTitle("");
              setError(null);
              // #43/#44 BUG FIX (2026-09-15, found investigating the Opus
              // Lead's e2e report): addMilestoneAction is called directly
              // from this handler, not a <form action={...}>, so Next.js
              // does NOT automatically refresh the current route
              // afterward -- the same class of bug createGoalAction below
              // had. Without this, `milestone` (a prop, not local state)
              // never updates, this component falls back to its own
              // "+ Add this month's milestone" button as if nothing
              // happened, and a second attempt hits
              // goal_milestones_user_goal_month_key's real uniqueness with
              // a confusing "already has a milestone" error.
              router.refresh();
            }
          });
        }}
      >
        <div className="flex gap-1.5">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="This month's milestone"
            autoFocus
            className="h-7 text-xs"
          />
          <Button type="submit" size="sm" disabled={isPending || !title.trim()}>
            Add
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    );
  }

  const done = doneItem.value;

  function toggle() {
    setError(null);
    void doneItem.set(!done);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <CircleCheck className={done ? "size-3.5 text-accent-business" : "size-3.5"} strokeWidth={2} />
        <span className={done ? "line-through decoration-muted-foreground/50" : undefined}>{milestone.title}</span>
      </button>
      {(error ?? doneItem.error) && <p className="text-xs text-destructive">{error ?? doneItem.error}</p>}
    </div>
  );
}

function ActiveGoalCard({
  goal,
  milestone,
  monthStart,
  deenMode,
  onResolve,
}: {
  deenMode: boolean;
  goal: Goal;
  milestone: GoalMilestone | undefined;
  monthStart: string;
  onResolve: (goalId: string, status: "done" | "dropped") => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve(status: "done" | "dropped") {
    setError(null);
    startTransition(async () => {
      const res = await setGoalStatusAction(goal.id, status);
      if ("error" in res) {
        setError(res.error);
      } else {
        onResolve(goal.id, status);
      }
    });
  }

  const label = domainLabel(goal.domain);

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
            {goal.rank}
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{goal.title}</span>
            {label && <span className="text-xs text-muted-foreground">{label}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => resolve("done")}>
            <CircleCheck className="size-4" aria-hidden />
            Done
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => resolve("dropped")}>
            <X className="size-4" aria-hidden />
            Drop
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{goal.reason}</p>
      <GoalMilestoneRow goalId={goal.id} monthStart={monthStart} milestone={milestone} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}

function AddGoalForm({
  monthStart,
  availableRanks,
  deenMode,
  onAdded,
  onCancel,
}: {
  monthStart: string;
  availableRanks: number[];
  deenMode: boolean;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [domain, setDomain] = useState("none");
  const [rank, setRank] = useState(String(availableRanks[0] ?? 1));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        const r = reason.trim();
        if (!t || !r) return;
        startTransition(async () => {
          const res = await createGoalAction({
            monthStart,
            title: t,
            reason: r,
            rank: Number(rank) as 1 | 2 | 3 | 4 | 5,
            domain: domain === "none" ? null : domain,
          });
          if ("error" in res) {
            setError(res.error);
          } else {
            onAdded();
            // #43/#44 BUG FIX (2026-09-15, found investigating the Opus
            // Lead's e2e report of goals.spec.ts failing on Mobile Chrome
            // with "listitem not visible" — not a timing flake, the row
            // was never going to appear at all). createGoalAction is
            // called directly from this handler, not a
            // <form action={...}>, so Next.js does NOT automatically
            // refresh the current route the way it does for a native
            // form-action submission. GoalBoard's own `allGoals` is a
            // useState(goals) copy (below), so even a caller that DID
            // trigger a refresh still needed that state to actually
            // resync from the newly-fetched `goals` prop — both halves
            // are fixed together here: this refresh call, and the
            // useEffect in GoalBoard that adopts a fresh `goals` prop.
            // Same idiom this codebase already uses everywhere else a
            // mutation isn't reflected via local optimistic state (e.g.
            // components/business/kill-list-items-dialog.tsx,
            // components/school/add-class-dialog.tsx).
            router.refresh();
          }
        });
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal title" autoFocus />
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this goal matters (required)" />
      <div className="flex flex-wrap gap-2">
        <Select value={domain} onValueChange={setDomain}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DOMAIN_OPTIONS.filter((d) => deenMode || d.value !== "deen").map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={rank} onValueChange={setRank}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANKS.map((r) => (
              <SelectItem key={r} value={String(r)} disabled={!availableRanks.includes(r)}>
                Rank {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || !title.trim() || !reason.trim()}>
          Add goal
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function GoalBoard({
  monthStart,
  todayStr,
  goals,
  milestones,
  deenMode = false,
  reservedRanks = [],
}: {
  /** Ranks held by active goals this board is not showing (Deen Mode OFF hides deen goals): still unavailable, and they count toward the 5-goal ceiling. */
  reservedRanks?: number[];
  /** profiles.deen_mode via isDeenModeOn -- a plain boolean (no function prop). Off hides the "Deen" domain choice; existing goals keep their tag. */
  deenMode?: boolean;
  monthStart: string;
  todayStr: string;
  goals: Goal[];
  milestones: GoalMilestone[];
}) {
  const [allGoals, setAllGoals] = useState(goals);
  const [adding, setAdding] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // #43/#44 BUG FIX (2026-09-15): `goals` is only used as `useState`'s
  // INITIAL value — React does not re-run that initializer on a later
  // render with a different prop, so without this effect `allGoals` would
  // stay frozen at whatever `goals` looked like on first mount forever,
  // even after AddGoalForm's `router.refresh()` (above) delivers a fresh
  // one. `markResolved` below (Done/Drop) still updates `allGoals`
  // directly for its own optimistic paint — this effect only ever fires
  // on a genuinely NEW `goals` array from the server, which happens
  // strictly after that server-side write already committed, so it can
  // only ever confirm state this component already believes, never
  // contradict an in-flight optimistic update with stale data.
  useEffect(() => {
    setAllGoals(goals);
  }, [goals]);

  const active = allGoals.filter((g) => g.status === "active").sort((a, b) => a.rank - b.rank);
  const resolved = allGoals.filter((g) => g.status !== "active");
  const availableRanks = RANKS.filter((r) => !active.some((g) => g.rank === r) && !reservedRanks.includes(r));
  const atCeiling = active.length + reservedRanks.length >= 5;
  const milestoneByGoal = new Map(milestones.map((m) => [m.goalId, m]));

  function markResolved(goalId: string, status: "done" | "dropped") {
    setAllGoals((prev) =>
      prev.map((g) => (g.id === goalId ? { ...g, status, completedAt: status === "done" ? new Date().toISOString() : null } : g))
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">This month's Top 5</span>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">{active.length}/5</span>
        </div>
        {atCeiling && (
          <p className="text-xs text-muted-foreground">
            Your 5 active goals are full. Complete or drop one to make room for another.
          </p>
        )}
      </div>

      {active.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/60 py-10 text-center">
          <p className="text-sm font-medium">No goals set for this month yet.</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Pick up to five things that matter this month, in order, each with a reason.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((goal) => (
            <ActiveGoalCard
              key={goal.id}
              goal={goal}
              milestone={milestoneByGoal.get(goal.id)}
              monthStart={monthStart}
              deenMode={deenMode}
              onResolve={markResolved}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <AddGoalForm
          monthStart={monthStart}
          availableRanks={availableRanks}
          deenMode={deenMode}
          onAdded={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : atCeiling ? (
        <Button type="button" variant="outline" disabled className="w-fit" title="All 5 ranks are in use this month">
          Ceiling reached — 5/5 active
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)} className="w-fit">
          + Add a goal
        </Button>
      )}

      {resolved.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={historyExpanded}
            onClick={() => setHistoryExpanded((v) => !v)}
            className="flex w-fit items-center gap-1 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {historyExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Completed & dropped ({resolved.length})
          </button>
          {historyExpanded && (
            <ul className="flex flex-col gap-2 pl-2">
              {resolved.map((goal) => (
                <li
                  key={goal.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/20 bg-card/60 p-3 text-muted-foreground"
                >
                  <span className={goal.status === "done" ? "truncate text-sm line-through decoration-muted-foreground/50" : "truncate text-sm"}>
                    {goal.title}
                  </span>
                  <span className="shrink-0 text-xs">
                    {goal.status === "done" ? "Done" : "Dropped"}
                    {goal.completedAt ? ` · ${formatShortDate(goal.completedAt.slice(0, 10), todayStr)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
