"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ListChecks } from "lucide-react";
import { delayItem, toggleItem } from "@/app/(app)/actions";
import { FitnessRow } from "@/components/home/fitness-row";
import { PlanRow } from "@/components/home/plan-row";
import { metaFor, mostUrgentId, toTaskRowItem } from "@/components/home/priority-row";
import { usePlanActions } from "@/components/home/use-plan-actions";
import { useHomeRefresh } from "@/components/home/use-home-refresh";
import { ActiveRow, CompletedRow, type TaskRowItem } from "@/components/shared/task-row-list";
import { useRowOverlay } from "@/components/shared/use-row-overlay";
import { EmptyState } from "@/components/ui/empty-state";
import type { AreaWeightLookup } from "@/lib/home/build-candidates";
import { buildTodayList, pickFocusId, todayRowId } from "@/lib/home/today-list";
import type { CompletedItem, PriorityItem } from "@/lib/home/types";
import type { PlanItem } from "@/lib/plan/get-plan-items";
import { cn } from "@/lib/utils";

/**
 * Home's "Today" list: every task for today in ONE ordered list (crown, starred, the rest of the plan, then every other
 * priority item ranked across domains -- lib/home/today-list.ts), one row in focus and the others slightly dimmed.
 * Prayers are not here (they live in the "Right now" strip above).
 *
 * Plan rows (Start / Mark Done / timer) and priority rows (tap to check off, Delay) are different components but share
 * one leave-cleanly rule (components/shared/use-row-overlay.ts): strike, a short confirmation beat, a 200 ms fade +
 * collapse, then Completed -- and it never comes back while the server catches up. Completed plan lines keep an Undo.
 * Data is plain props from the server; every write is an imported Server Action.
 */

const TICK_MS = 60 * 1000;
const TIMER_TICK_MS = 1000;

type Item =
  | { kind: "plan"; id: string; completedAtIso: string | null; plan: PlanItem }
  | { kind: "priority"; id: string; completedAtIso: null; priority: PriorityItem }
  | { kind: "done"; id: string; completedAtIso: string; done: CompletedItem };

function doneToTaskRowItem(c: CompletedItem): TaskRowItem {
  return { id: c.id, title: c.title, domain: c.domain, mode: "toggle", completedAtIso: c.completedAtIso };
}

export function TodayTasks({
  planItems,
  priorityItems,
  completedToday,
  weights,
  nowIso,
  deenMode,
  isFreshInstall,
}: {
  planItems: PlanItem[];
  priorityItems: PriorityItem[];
  completedToday: CompletedItem[];
  weights: AreaWeightLookup;
  nowIso: string;
  deenMode: boolean;
  isFreshInstall: boolean;
}) {
  const scheduleRefresh = useHomeRefresh();
  const [now, setNow] = useState(() => new Date(nowIso));
  const [nowMs, setNowMs] = useState(() => new Date(nowIso).getTime());
  useEffect(() => {
    // The immediate tick matters as much as the nowIso seed, not just a nicety: next.config.ts's staleTimes.dynamic
    // (3600s) means a Home RSC payload (nowIso baked in) can be served from the client Router Cache up to an hour
    // stale. Without this call, first paint would compute relative times against that clock for up to another 60 s.
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const plan = usePlanActions(planItems);
  const viewPlan = planItems.map(plan.view);
  const built = buildTodayList({ planItems: viewPlan, priorityItems, weights, now, deenMode });

  const anyRunning = built.rows.some((r) => r.source === "plan" && r.plan.timerStartedAt !== null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    if (!anyRunning) return;
    const id = setInterval(tick, TIMER_TICK_MS);
    return () => clearInterval(id);
  }, [anyRunning]);

  const all: Item[] = [
    ...built.rows.map((r): Item => (r.source === "plan" ? { kind: "plan", id: r.id, completedAtIso: null, plan: r.plan } : { kind: "priority", id: r.id, completedAtIso: null, priority: r.priority })),
    // A plan line that is already done carries no completion instant; its creation time only orders it among the done ones.
    ...built.completedPlan.map((p): Item => ({ kind: "plan", id: p.id, completedAtIso: p.createdAt, plan: p })),
    ...completedToday.map((c): Item => ({ kind: "done", id: c.id, completedAtIso: c.completedAtIso, done: c })),
  ];
  const overlay = useRowOverlay(all);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [completedOpen, setCompletedOpen] = useState(false);

  const pending = overlay.view.filter((i) => !i.completedAtIso);
  const completed = overlay.view.filter((i) => i.completedAtIso).sort((a, b) => (a.completedAtIso! < b.completedAtIso! ? -1 : 1));
  const pendingPriority = pending.flatMap((i) => (i.kind === "priority" ? [i.priority] : []));
  const urgentId = mostUrgentId(pendingPriority);
  const focusId = pickFocusId(
    pending.map((i) => ({ id: i.id, running: i.kind === "plan" && i.plan.timerStartedAt !== null })),
    overlay.exitingIds,
  );
  const priorityByRowId = new Map(priorityItems.map((p) => [todayRowId(p), p]));
  const emphasisOf = (id: string): "focus" | "dim" => (id === focusId ? "focus" : "dim");

  function tickPlan(item: PlanItem) {
    setTicked((s) => new Set(s).add(item.id));
    overlay
      .completeRow(item.id, () => plan.completeWrite(item), (err) => (err instanceof Error && err.message ? err.message : "Couldn't save — try again"))
      .catch(() => setTicked((s) => {
        const next = new Set(s);
        next.delete(item.id);
        return next;
      }));
  }

  async function undoPlan(item: PlanItem) {
    overlay.forget(item.id);
    setTicked((s) => {
      const next = new Set(s);
      next.delete(item.id);
      return next;
    });
    await plan.undo(item);
  }

  const completePriority = (row: TaskRowItem) =>
    overlay.completeRow(row.id, async () => {
      const original = priorityByRowId.get(row.id);
      if (!original) throw new Error(`Unknown Today item: ${row.id}`);
      try {
        await toggleItem(original);
      } finally {
        scheduleRefresh(); // one deferred Home revalidation per burst (toggleItem no longer revalidates per tap)
      }
    });

  const delayPriority = (row: TaskRowItem) =>
    overlay.removeRow(row.id, async () => {
      const original = priorityByRowId.get(row.id);
      if (!original) throw new Error(`Unknown Today item: ${row.id}`);
      try {
        const result = await delayItem(original);
        if (!result.ok) throw new Error(result.message);
      } finally {
        scheduleRefresh();
      }
    });

  const emptyState = (
    <EmptyState
      icon={ListChecks}
      message={isFreshInstall ? "Welcome — head into a domain tab to get started" : "You're all clear"}
      action={{ label: "Plan the week", href: "#weekly-focus" }}
    />
  );

  return (
    <div className="flex flex-col gap-1" data-testid="today-tasks">
      {pending.length === 0 ? (
        emptyState
      ) : (
        <ul className="flex flex-col gap-1">
          {pending.map((item) => {
            if (item.kind === "plan") {
              return (
                <PlanRow
                  key={item.id}
                  item={item.plan}
                  nowMs={nowMs}
                  busy={plan.busy === item.id}
                  message={plan.messages[item.id] ?? overlay.rowErrors[item.id]}
                  struck={ticked.has(item.id)}
                  exiting={overlay.exitingIds.has(item.id)}
                  emphasis={emphasisOf(item.id)}
                  onComplete={() => tickPlan(item.plan)}
                  onStart={() => void plan.start(item.plan)}
                  onStop={() => void plan.stop(item.plan)}
                />
              );
            }
            if (item.kind !== "priority") return null;
            const p = item.priority;
            if (p.actionType === "open_fitness") return <FitnessRow key={item.id} item={p} meta={metaFor(p, now, p.id === urgentId)} emphasis={emphasisOf(item.id)} />;
            return (
              <ActiveRow
                key={item.id}
                item={toTaskRowItem(p, item.id, now, p.id === urgentId)}
                exiting={overlay.exitingIds.has(item.id)}
                emphasis={emphasisOf(item.id)}
                initialError={overlay.rowErrors[item.id] ?? null}
                onComplete={completePriority}
                onDelay={delayPriority}
              />
            );
          })}
        </ul>
      )}

      {completed.length > 0 && (
        <div className="mt-1 border-t border-border/40 pt-1">
          <button
            type="button"
            onClick={() => setCompletedOpen((o) => !o)}
            aria-expanded={completedOpen}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50"
          >
            <span>Completed</span>
            <ChevronDown className={cn("size-3.5 transition-transform", completedOpen && "rotate-180")} aria-hidden />
          </button>
          {completedOpen && (
            <ul className="flex flex-col gap-1">
              {completed.map((item) =>
                item.kind === "plan" ? (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                    <Check className="size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate line-through">{item.plan.title}</span>
                    <button type="button" onClick={() => void undoPlan(item.plan)} aria-label={`Undo ${item.plan.title}`} className="shrink-0 underline underline-offset-4 transition-colors hover:text-foreground">
                      Undo
                    </button>
                  </li>
                ) : item.kind === "priority" ? (
                  <CompletedRow key={item.id} item={toTaskRowItem(item.priority, item.id, now, false)} />
                ) : (
                  <CompletedRow key={item.id} item={doneToTaskRowItem(item.done)} />
                ),
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
