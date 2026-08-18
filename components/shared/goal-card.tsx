"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { DOMAIN_ACCENT } from "@/lib/accent-tokens";
import type { Domain } from "@/lib/home/types";

export function GoalCard({
  title,
  domain,
  headline: initialHeadline,
  milestones: initialMilestones,
  quranPageTarget: initialQuranPageTarget,
  showQuranTarget,
  locked,
  onSave,
  emptyStateFraming,
}: {
  title: string;
  domain: Domain;
  headline: string;
  milestones: string[];
  quranPageTarget?: number | null;
  showQuranTarget?: boolean;
  locked: boolean;
  onSave: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
  /** Optional, caller-owned empty-state copy (R1, 2026-08-18 synthesis) —
   * shown only while this goal has never been saved, so a domain that
   * hasn't opted in (or already has real data) never sees it. GoalCard
   * stays domain-agnostic; the wording itself belongs to the page. */
  emptyStateFraming?: React.ReactNode;
}) {
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
    startTransition(() =>
      onSave(headline, milestones, quranPageTarget ? Number(quranPageTarget) : undefined)
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
      <h3 className="flex items-center gap-2.5 text-sm font-semibold text-muted-foreground">
        <IconChip icon={DOMAIN_ICON[domain]} accent={DOMAIN_ACCENT[domain]} size="sm" />
        {title}
      </h3>
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
