"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { getDomainIcon } from "@/lib/domain-icons";
import { getDomainAccent } from "@/lib/accent-tokens";
import type { DisplayDomain } from "@/lib/home/types";

// The one place "is this headline actually set" gets decided — a
// whitespace-only headline counts as unset, same as empty. Exported so
// callers (weekly-goals-header.tsx's read-view prompt) share this exact
// definition instead of inventing their own notion of blank (Opus Lead,
// 2026-08-24: two different definitions of "blank" in one feature is how
// this class of bug gets reintroduced).
export function isGoalHeadlineSet(headline: string): boolean {
  return headline.trim().length > 0;
}

/**
 * Read view by default, an editable form only while `editing` — a goal
 * that's never been set opens straight into the form (nothing to read yet).
 * Saving returns to the read view (2026-08-21: previously the form was the
 * only view this component had, on both Home and Business; the toggle
 * behavior built for Home's "This week's focus" is now the one and only
 * behavior, so every caller gets it for free instead of Home re-implementing
 * it as its own wrapper around a form-only GoalCard).
 */
export function GoalCard({
  title,
  domain,
  headline: initialHeadline,
  milestones: initialMilestones,
  quranPageTarget: initialQuranPageTarget,
  quranPagesRead,
  showQuranTarget,
  locked,
  onSave,
  emptyStateFraming,
  defaultEditing,
}: {
  title: string;
  /** Widened to DisplayDomain (D-037) so this drops in for a user-created Work subdomain, not just the 5 fixed domains. */
  domain: DisplayDomain;
  headline: string;
  milestones: string[];
  quranPageTarget?: number | null;
  /** Current progress against quranPageTarget, shown in the read view only ("Qur'an X/Y pages"). */
  quranPagesRead?: number;
  showQuranTarget?: boolean;
  locked: boolean;
  onSave: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
  /** Optional, caller-owned empty-state copy (R1, 2026-08-18 synthesis) —
   * shown only while this goal has never been saved, so a domain that
   * hasn't opted in (or already has real data) never sees it. GoalCard
   * stays domain-agnostic; the wording itself belongs to the page. */
  emptyStateFraming?: React.ReactNode;
  /** Overrides the initial editing state — e.g. a caller that opens this
   * card straight into a dialog from an explicit "edit" affordance wants
   * the form immediately, not a redundant extra click into edit mode
   * (components/shared/weekly-goals-header.tsx). Omitted, behavior is
   * unchanged: edit mode only when there's nothing to read yet. */
  defaultEditing?: boolean;
}) {
  const [editing, setEditing] = useState(
    defaultEditing ?? (!isGoalHeadlineSet(initialHeadline) && initialMilestones.length === 0)
  );
  const [isPending, startTransition] = useTransition();
  const [headline, setHeadline] = useState(initialHeadline);
  const [milestonesText, setMilestonesText] = useState(initialMilestones.join("\n"));
  const [quranPageTarget, setQuranPageTarget] = useState(
    initialQuranPageTarget != null ? String(initialQuranPageTarget) : ""
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
    const milestones = milestonesText
      .split("\n")
      .map((m) => m.trim())
      .filter(Boolean);
    startTransition(async () => {
      await onSave(headline, milestones, quranPageTarget ? Number(quranPageTarget) : undefined);
      setEditing(false);
    });
  }

  const header = (
    <h3 className="flex items-center justify-between gap-2.5 text-sm font-semibold text-muted-foreground">
      <span className="flex items-center gap-2.5">
        <IconChip icon={getDomainIcon(domain)} accent={getDomainAccent(domain)} size="sm" />
        {title}
      </span>
      {!editing && !locked && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${title}`}
        >
          <Pencil />
        </Button>
      )}
    </h3>
  );

  if (!editing) {
    return (
      <div className="flex flex-col gap-1.5 rounded-2xl border border-border/40 bg-card p-4">
        {header}
        <p className="font-medium">{initialHeadline}</p>
        {initialMilestones.length > 0 && (
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {initialMilestones.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
        {showQuranTarget && initialQuranPageTarget != null && (
          <p className="text-sm text-muted-foreground">
            Qur&apos;an {quranPagesRead ?? 0}/{initialQuranPageTarget} pages
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
      {header}
      {emptyStateFraming && !initialHeadline && initialMilestones.length === 0 && (
        <p className="text-xs text-muted-foreground">{emptyStateFraming}</p>
      )}
      <Input
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        placeholder="This week's headline goal"
        disabled={locked}
        className="font-medium"
      />
      <textarea
        value={milestonesText}
        onChange={(e) => setMilestonesText(e.target.value)}
        placeholder="Milestones (one per line)"
        rows={3}
        disabled={locked}
        className="rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      />
      {showQuranTarget && (
        <Input
          type="number"
          min={1}
          value={quranPageTarget}
          onChange={(e) => setQuranPageTarget(e.target.value)}
          placeholder="Weekly page goal"
          disabled={locked}
          className="w-40"
        />
      )}
      {locked ? (
        <p className="text-xs text-muted-foreground">This week is locked — read-only.</p>
      ) : (
        <Button type="submit" disabled={isPending} className="self-start">
          Save goal
        </Button>
      )}
    </form>
  );
}
