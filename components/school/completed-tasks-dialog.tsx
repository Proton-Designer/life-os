"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CompletedWeekGroup } from "@/lib/tasks/completed-by-week";

export type { CompletedWeekGroup };

function WeekSection({ group }: { group: CompletedWeekGroup }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left transition-colors hover:bg-accent/40"
      >
        <span className="text-sm font-medium">
          {group.weekLabel}{" "}
          <span className="font-mono text-xs font-normal text-muted-foreground">· {group.items.length} completed</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
      </button>
      {expanded && (
        <ul className="flex flex-col gap-1">
          {group.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-muted-foreground line-through decoration-accent-business">
                {item.title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * School's "Completed" popup (2026-08-26 night batch, item B2e): grouped by
 * week (most recent first, per `groups`' own ordering — computed server-side
 * since it needs the account's timezone, AGENTS.md), every section collapsed
 * by default (Ayman: "defaulted to collapsed view" — unlike QadaBacklogCard's
 * first-section-expanded pattern, this one is uniform). Purely a browsing
 * history view — completing happens via the three KPI cards' own dialogs
 * (KpiTaskDialog), which is what actually moves a task in here.
 */
export function CompletedTasksDialog({ groups }: { groups: CompletedWeekGroup[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Completed
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Completed tasks</DialogTitle>
        </DialogHeader>
        <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1">
          {groups.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nothing completed yet</p>
          ) : (
            groups.map((g) => <WeekSection key={g.weekStart} group={g} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
