"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { DOMAIN_ACCENT } from "@/lib/accent-tokens";
import type { Domain } from "@/lib/home/types";
import { IconChip } from "@/components/ui/icon-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Shared one-tap task row + log-dialog list — the single component behind
 * every task list in the app (Home's Now module and every domain screen's
 * own list, 2026-08-25 tap-to-complete redesign, Opus Lead). Home
 * (next-actions.tsx) is the reference caller; every domain screen call site
 * is Engineer C's, built against this same contract.
 *
 * WIRING (read before calling this from a Server Component): `onComplete`/
 * `onLog` are plain client-side async functions, not Server Action
 * references passed across the RSC boundary — AGENTS.md forbids a Server
 * Component handing a Client Component a wrapping closure, and per-item
 * completion needs a closure over `item`. The fix used throughout this
 * codebase (KillList, LockInPanel, GoalCard) is the same one here: put the
 * Server Action import and the onComplete/onLog implementation in a client
 * component (a "use client" wrapper the domain page.tsx renders, exactly
 * like next-actions.tsx already is), never in the Server Component itself.
 * A domain page.tsx should never import TaskRowList directly if it also
 * wants to define these handlers inline.
 */

export type TaskLogSpec =
  | { kind: "count"; unit: string; target: number; current: number }
  | { kind: "choice"; options: { value: string; label: string }[] };

export type TaskLogValue = { kind: "count"; value: number } | { kind: "choice"; value: string };

export type TaskRowItem = {
  id: string;
  title: string;
  domain: Domain;
  /** "Today", a due label, etc. — short, optional, right-aligned. */
  meta?: string;
  /**
   * Render `meta` on its own line beneath the title instead of beside it.
   * Opt-in per caller, not a global change: School's KPI dialogs grew a
   * three-part meta ("Aug. 28th · Homework/Assignment · DSA") that simply
   * cannot share one line with a real task title at 390px — measured, the
   * title collapsed to a single letter. Every other caller's meta is one
   * short word ("Today") and stays inline, so this deliberately does not
   * change how Home or Fitness rows look.
   */
  metaBelow?: boolean;
  mode: "toggle" | "log";
  log?: TaskLogSpec;
  /** Set once completed. Absent/null items render in the active list. */
  completedAtIso?: string | null;
  /**
   * Optional chevron-disclosure marker (2026-08-25/26, Opus Lead ruling).
   * When present, ActiveRow renders a chevron button beside the row —
   * separate from the row's own tap target, stopPropagation'd — that
   * toggles an expanded panel below it, rendered via TaskRowList's
   * `renderExpanded` prop. TaskRowList has no idea what's inside that
   * panel (today: Home's sunnah disclosure for a prayer row) — it only
   * knows a row wants one.
   */
  expand?: { ariaLabel: string; badge?: string };
};

export type TaskLogResult = {
  completed: boolean;
  /** New running total, for a count log that didn't yet meet its target — lets the row show updated progress without a full round trip. */
  current?: number;
};

// Long enough to read as a deliberate confirmation, short enough not to feel
// laggy — Lead review: "an instant vanish reads as a glitch, not a
// confirmation."
const COMPLETE_ANIMATION_MS = 550;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300",
        checked ? "border-accent-business bg-accent-business" : "border-border"
      )}
    >
      {checked && <Check className="size-3.5 text-white" strokeWidth={3} />}
    </span>
  );
}

// Always visible, not hover-revealed — a hover affordance is undiscoverable
// and unusable on touch (this list's own complaint was mobile tap
// behavior), and Ayman uses this on a laptop too, where hover would work
// but shouldn't be required. Kept quiet (muted color, no border) and small,
// with real gap from the row's own tap target, so it isn't hit casually —
// deletion has no undo in this app (Lead review, 2026-08-25).
function RemoveButton({ title, onClick }: { title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove ${title}`}
      className="ml-1 shrink-0 rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
    >
      <X className="size-3.5" aria-hidden />
    </button>
  );
}

function ActiveRow({
  item,
  onComplete,
  onOpenLog,
  onRemove,
  renderExpanded,
}: {
  item: TaskRowItem;
  onComplete: (item: TaskRowItem) => Promise<void>;
  /** Absent when the caller never wired onLog — a log-mode row then renders inert rather than throwing (see the effect below). */
  onOpenLog?: (item: TaskRowItem) => void;
  onRemove?: (item: TaskRowItem) => Promise<void>;
  /**
   * See TaskRowItem.expand — the panel content for a row that opts into a
   * chevron disclosure. `collapse` lets that content ask to be closed
   * (e.g. an auto-collapse timer), same as it closing via the chevron
   * itself.
   *
   * STRUCTURAL GUARANTEE (Lead review, 2026-08-25/26): ActiveRow renders
   * this as a SIBLING of the row's own clickable button, never nested
   * inside it — a click inside whatever you return here cannot bubble
   * into the row's onComplete/onOpenLog handler. This matters concretely
   * on Home, where the row's primary tap completes a fard prayer: without
   * this guarantee, a tap inside a sunnah disclosure would silently also
   * mark the fard prayer done. Don't ALSO rely on this alone, though — the
   * content you return should stopPropagation on its own interactive
   * elements too (see SunnahDisclosure), since a future caller nesting
   * differently is a mistake this contract can't catch for them.
   */
  renderExpanded?: (item: TaskRowItem, collapse: () => void) => React.ReactNode;
}) {
  const [justCompleted, setJustCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRemoving, setIsRemoving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const inertLog = item.mode === "log" && !onOpenLog;
  useEffect(() => {
    if (inertLog) {
      // Degrade visibly (an inert row), never explode (a thrown exception
      // mid-tap on Home's most-used screen) — a caller that renders a
      // log-mode item without wiring onLog is a real bug, but the failure
      // mode for the PERSON using the app must be "nothing happens," not a
      // crash (Lead review, 2026-08-25).
      console.error(
        `TaskRowList: item "${item.id}" has mode: "log" but no onLog handler was provided — rendering it inert.`
      );
    }
  }, [inertLog, item.id]);

  function handleClick() {
    if (item.mode === "log") {
      onOpenLog?.(item);
      return;
    }
    if (justCompleted || isPending) return;
    setError(null);
    setJustCompleted(true);
    startTransition(async () => {
      try {
        await onComplete(item);
      } catch {
        setJustCompleted(false);
        setError("Couldn't save — try again");
      }
    });
  }

  function handleRemove(e: React.MouseEvent) {
    // A nested <button> inside the row's own <button> is invalid HTML and
    // makes the two clicks fight over the same target — this is a SIBLING
    // element instead (li is the flex row), so no stopPropagation is even
    // needed to keep the row tap from also firing; kept anyway for safety
    // against any future wrapping change.
    e.stopPropagation();
    if (!onRemove || isRemoving) return;
    setIsRemoving(true);
    startTransition(async () => {
      try {
        await onRemove(item);
      } catch {
        setIsRemoving(false);
        setError("Couldn't remove — try again");
      }
    });
  }

  return (
    <li className="flex min-w-0 flex-col">
      {/* min-w-0: without it this flex row sizes to max-content, so the
          button below can't actually shrink and a long title + long meta
          push the whole row past its container instead of truncating
          (measured 2026-08-27: a 344px dialog holding a 592px row). */}
      <div className="flex min-w-0 items-center">
        {/* The whole row is the tap target (Ayman: "tapped or clicked
            anywhere on its box"), not just a small circle — real
            min-height for a comfortable touch target. Sized flex-1 so the
            sibling chevron/Remove controls (when present) sit outside it,
            never nested inside. */}
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending || inertLog}
          aria-label={item.mode === "log" ? `Log ${item.title}` : `Mark "${item.title}" done`}
          // min-w-0 is load-bearing: a flex item's automatic minimum size
          // (min-width:auto) refuses to shrink below its min-content, and
          // this button's min-content includes the whole meta string. Without
          // it, flex-1 cannot actually shrink and the row runs past its
          // container instead of truncating — measured 2026-08-27 at 390px,
          // a 575px row inside a 313px list.
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/50 disabled:cursor-default disabled:opacity-60"
        >
          <Checkbox checked={justCompleted} />
          <IconChip icon={DOMAIN_ICON[item.domain]} accent={DOMAIN_ACCENT[item.domain]} size="sm" />
          <span
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              item.metaBelow ? "gap-0.5" : "flex-row items-center gap-3"
            )}
          >
            <span
              className={cn(
                "min-w-0 truncate text-sm transition-colors duration-300",
                !item.metaBelow && "flex-1",
                justCompleted && "text-muted-foreground line-through decoration-accent-business"
              )}
            >
              {item.title}
            </span>
            {item.meta && item.metaBelow && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{item.meta}</span>
            )}
          </span>
          {item.mode === "log" && item.log?.kind === "count" && (
            <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
              {item.log.current}/{item.log.target} {item.log.unit}
            </span>
          )}
          {/* Capped and truncating, not bare shrink-0 (2026-08-27): meta was
              unshrinkable while the title was `flex-1 truncate`, so a long
              meta took the whole row and crushed the title to an ellipsis —
              seen live at 390px the moment School's KPI rows grew a due-date
              segment. The title is the row's identity and must always win;
              the meta is context and can truncate. Cap rather than plain
              `shrink`, because flex shrinks proportionally to content and a
              long meta beside a short title would still dominate. */}
          {item.meta && !item.metaBelow && (
            <span className="max-w-[12rem] shrink-0 truncate text-xs text-muted-foreground">{item.meta}</span>
          )}
        </button>
        {item.expand && renderExpanded && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={item.expand.ariaLabel}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40"
          >
            {item.expand.badge && <span className="font-mono tabular-nums">{item.expand.badge}</span>}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
          </button>
        )}
        {onRemove && <RemoveButton title={item.title} onClick={handleRemove} />}
      </div>
      {error && <p className="px-3 pb-1 text-xs text-destructive">{error}</p>}
      {expanded && item.expand && renderExpanded && renderExpanded(item, () => setExpanded(false))}
    </li>
  );
}

function CompletedRow({
  item,
  onRemove,
}: {
  item: TaskRowItem;
  onRemove?: (item: TaskRowItem) => Promise<void>;
}) {
  const [isRemoving, setIsRemoving] = useState(false);
  const [, startTransition] = useTransition();

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onRemove || isRemoving) return;
    setIsRemoving(true);
    startTransition(async () => {
      try {
        await onRemove(item);
      } catch {
        setIsRemoving(false);
      }
    });
  }

  return (
    <li className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5">
      <Checkbox checked />
      <IconChip icon={DOMAIN_ICON[item.domain]} accent={DOMAIN_ACCENT[item.domain]} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through decoration-accent-business">
        {item.title}
      </span>
      {onRemove && <RemoveButton title={item.title} onClick={handleRemove} />}
    </li>
  );
}

function LogDialog({
  item,
  onOpenChange,
  onSubmit,
}: {
  item: TaskRowItem | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (item: TaskRowItem, value: TaskLogValue) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Reset local form state every time a different row opens the dialog.
  useEffect(() => {
    setAmount("");
    setError(null);
    setChoice(item?.log?.kind === "choice" ? (item.log.options[0]?.value ?? null) : null);
  }, [item]);

  if (!item || !item.log) return null;
  const log = item.log;

  function handleSubmit() {
    if (!item || !log) return;
    let value: TaskLogValue;
    if (log.kind === "count") {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) {
        setError("Enter a number greater than 0");
        return;
      }
      value = { kind: "count", value: n };
    } else {
      if (!choice) {
        setError("Choose an option");
        return;
      }
      value = { kind: "choice", value: choice };
    }
    setError(null);
    startTransition(async () => {
      try {
        await onSubmit(item, value);
      } catch {
        setError("Couldn't save — try again");
      }
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.title}</DialogTitle>
        </DialogHeader>
        {log.kind === "count" ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {log.current}/{log.target} {log.unit} so far
            </p>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Add ${log.unit}`}
              autoFocus
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {log.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setChoice(opt.value)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  choice === opt.value
                    ? "border-accent-business bg-accent-business/10"
                    : "border-border hover:bg-accent/50"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            Log
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OptimisticAction =
  | { type: "complete"; id: string; completedAtIso: string }
  | { type: "progress"; id: string; current: number }
  | { type: "remove"; id: string };

export function TaskRowList({
  items,
  onComplete,
  onLog,
  onRemove,
  emptyState,
  renderExpanded,
}: {
  items: TaskRowItem[];
  /** Reject (throw) to leave the row uncompleted and show an inline error — never let this resolve silently on failure. */
  onComplete: (item: TaskRowItem) => Promise<void>;
  /**
   * Optional — omit entirely if this list never has a `mode: "log"` item
   * (e.g. Home today). Return `{completed:true}` when a log fully met the
   * item's target — the row animates into Completed exactly like a one-tap
   * item. Otherwise return `{completed:false, current}` so the row shows
   * updated progress. If a log-mode item DOES show up without this
   * provided, that row renders inert (tap does nothing) rather than
   * throwing — a caller bug should never crash mid-tap on a screen this
   * central (Lead review, 2026-08-25).
   */
  onLog?: (item: TaskRowItem, value: TaskLogValue) => Promise<TaskLogResult>;
  /**
   * Optional — only pass this for lists of user-created rows a domain
   * screen lets you delete outright (e.g. School's task list). Home does
   * NOT pass this: its items are derived (prayers, kill list, fitness),
   * never user-created rows, so there's nothing to delete. When present, a
   * quiet Remove control renders on every row, active and completed alike
   * (Lead review, 2026-08-25: without it, the only way to clear a
   * mistyped/duplicate task is to mark it "complete," which files
   * something that was never done into the Completed accountability
   * record — strictly worse than the delete affordance).
   */
  onRemove?: (item: TaskRowItem) => Promise<void>;
  emptyState?: React.ReactNode;
  /** See TaskRowItem.expand. Omit entirely if no item in this list ever sets `expand` — the chevron itself only renders when both are present. */
  renderExpanded?: (item: TaskRowItem, collapse: () => void) => React.ReactNode;
}) {
  const [optimisticItems, applyOptimistic] = useOptimistic(items, (state, action: OptimisticAction) => {
    if (action.type === "complete") {
      return state.map((i) => (i.id === action.id ? { ...i, completedAtIso: action.completedAtIso } : i));
    }
    if (action.type === "remove") {
      return state.filter((i) => i.id !== action.id);
    }
    return state.map((i) =>
      i.id === action.id && i.log?.kind === "count" ? { ...i, log: { ...i.log, current: action.current } } : i
    );
  });
  const [logItem, setLogItem] = useState<TaskRowItem | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);

  const pending = optimisticItems.filter((i) => !i.completedAtIso);
  // Completion order, oldest first (Ayman: "in order of completion").
  const completed = optimisticItems
    .filter((i) => i.completedAtIso)
    .sort((a, b) => (a.completedAtIso! < b.completedAtIso! ? -1 : 1));

  async function handleComplete(item: TaskRowItem) {
    // Kick off the real call immediately (don't wait for the animation beat
    // to even start it), but only commit the optimistic "moved to
    // Completed" state once it's actually confirmed. Applying the optimistic
    // dispatch unconditionally here — before awaiting `settled` — was a
    // real bug: a rejected onComplete would still have already been
    // reflected as complete (nothing in the pending list to revert), so the
    // row silently landed in the Completed accountability section for
    // something that was never actually saved. ActiveRow's own local
    // `justCompleted` state already gives the instant checkbox+strikethrough
    // response; this only governs when the row actually leaves the active
    // list.
    const settled = onComplete(item);
    await sleep(COMPLETE_ANIMATION_MS);
    await settled;
    applyOptimistic({ type: "complete", id: item.id, completedAtIso: new Date().toISOString() });
  }

  async function handleLogSubmit(item: TaskRowItem, value: TaskLogValue) {
    if (!onLog) return;
    const result = await onLog(item, value);
    if (result.completed) {
      await sleep(COMPLETE_ANIMATION_MS);
      applyOptimistic({ type: "complete", id: item.id, completedAtIso: new Date().toISOString() });
    } else if (typeof result.current === "number") {
      applyOptimistic({ type: "progress", id: item.id, current: result.current });
    }
    setLogItem(null);
  }

  async function handleRemove(item: TaskRowItem) {
    if (!onRemove) return;
    // Same ordering fix as handleComplete: only remove the row from view
    // once the delete is actually confirmed, not before.
    await onRemove(item);
    applyOptimistic({ type: "remove", id: item.id });
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Whenever nothing is PENDING, show emptyState — regardless of
          whether anything is completed. The previous condition
          (`pending.length === 0 && completed.length === 0`) suppressed
          emptyState the moment anything was completed, rendering a bare
          empty <ul> with no "all clear" message above a populated
          Completed section — the exact state a user lands in every time
          they finish everything for the day (Lead review, 2026-08-25: "a
          reason to show more, not to suppress the message"). The Completed
          section below is unconditional on its own `completed.length > 0`
          check either way, so this only changes what fills the gap above
          it. */}
      {pending.length === 0 ? (
        emptyState
      ) : (
        <ul className="flex flex-col gap-1">
          {pending.map((item) => (
            <ActiveRow
              key={item.id}
              item={item}
              onComplete={handleComplete}
              onOpenLog={onLog ? setLogItem : undefined}
              onRemove={onRemove ? handleRemove : undefined}
              renderExpanded={renderExpanded}
            />
          ))}
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
              {completed.map((item) => (
                <CompletedRow key={item.id} item={item} onRemove={onRemove ? handleRemove : undefined} />
              ))}
            </ul>
          )}
        </div>
      )}

      <LogDialog item={logItem} onOpenChange={(open) => !open && setLogItem(null)} onSubmit={handleLogSubmit} />
    </div>
  );
}
