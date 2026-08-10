"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function GoalCard({
  title,
  headline: initialHeadline,
  milestones: initialMilestones,
  quranPageTarget: initialQuranPageTarget,
  showQuranTarget,
  locked,
  onSave,
}: {
  title: string;
  headline: string;
  milestones: string[];
  quranPageTarget?: number | null;
  showQuranTarget?: boolean;
  locked: boolean;
  onSave: (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border/40 p-4">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
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
