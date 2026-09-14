"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatShortDate } from "@/lib/date-utils";
import type { CompletedBusinessGoal } from "@/lib/business/completed-goals";

/**
 * Business's completed-goals archive (#53) — the same collapsible pattern
 * as `components/co-op/targets-strip.tsx:107-134`'s "Completed goals (N)"
 * section, ported rather than reinvented: collapsed by default, a flat
 * read-only history (title + date, no rank/edit/complete/remove — a done
 * goal isn't something still being worked), rendered even at zero rows so
 * the section never reads as broken.
 *
 * Data source is `goals` (migration 165) where `domain='business'` and
 * `status='done'` — see `lib/business/completed-goals.ts`'s header for why
 * this is not `weekly_goals`.
 */
export function CompletedGoalsArchive({ goals, todayStr }: { goals: CompletedBusinessGoal[]; todayStr: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        Completed goals ({goals.length})
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 pl-2">
          {goals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed goals yet</p>
          ) : (
            goals.map((goal) => (
              <div key={goal.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 p-3">
                <span className="truncate text-sm text-muted-foreground">{goal.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatShortDate(goal.completedDateStr, todayStr)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
