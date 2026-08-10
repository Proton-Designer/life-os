"use client";

import { useState, useTransition } from "react";
import { saveBusinessWeeklyGoal } from "@/app/(app)/business/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function WeeklyGoalCard({
  weekStartDate,
  headline: initialHeadline,
  milestones: initialMilestones,
}: {
  weekStartDate: string;
  headline: string;
  milestones: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [headline, setHeadline] = useState(initialHeadline);
  const [milestonesText, setMilestonesText] = useState(initialMilestones.join("\n"));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const milestones = milestonesText
      .split("\n")
      .map((m) => m.trim())
      .filter(Boolean);
    startTransition(() => saveBusinessWeeklyGoal(weekStartDate, headline, milestones));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border/40 p-4">
      <Input
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        placeholder="This week's headline goal"
        className="font-medium"
      />
      <textarea
        value={milestonesText}
        onChange={(e) => setMilestonesText(e.target.value)}
        placeholder="Milestones (one per line)"
        rows={3}
        className="rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button type="submit" disabled={isPending} className="self-start">
        Save goal
      </Button>
    </form>
  );
}
