"use client";

import { DurationField } from "@/components/plan/duration-field";
import { QuickTimeField } from "@/components/plan/quick-time-field";
import { formatHHMM12 } from "@/lib/date-utils";
import { PLAN_AREA_LABEL, formatDuration, type PlanArea } from "@/lib/plan/plan-behavior";
import { cn } from "@/lib/utils";

/**
 * What the person can attach to one plan line -- all of it optional:
 *   - a domain (their own, from Settings), so the day can be read back by domain;
 *   - Business: "Add to Kill List" (preselected the moment Business is chosen; untick it to keep the line a plain
 *     Business task);
 *   - Work: it is added to the Backlog; School: it is added to today's School tasks (and shows in Now);
 *   - a start time and/or a timer, on ANY line, with or without a domain.
 * The editor is controlled: the plan stage owns the draft and writes it on Finish.
 */

export type PlanLineDraft = {
  area: PlanArea | null;
  addToKillList: boolean;
  /** "HH:MM" 24-hour, "" for none. */
  startTime: string;
  durationMinutes: number | null;
};

export const EMPTY_PLAN_DRAFT: PlanLineDraft = { area: null, addToKillList: false, startTime: "", durationMinutes: null };

/** The short chips a collapsed row shows: "Business", "Kill List", "5:00 AM", "3h". Pure. */
export function planDraftSummary(draft: PlanLineDraft): string[] {
  const out: string[] = [];
  if (draft.area) out.push(PLAN_AREA_LABEL[draft.area]);
  if (draft.area === "business" && draft.addToKillList) out.push("Kill List");
  if (draft.startTime) out.push(formatHHMM12(draft.startTime));
  if (draft.durationMinutes !== null) out.push(formatDuration(draft.durationMinutes));
  return out;
}

const CHIP = "min-h-8 rounded-md border px-2.5 text-xs transition-colors aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary";

export function PlanLineDetails({
  title,
  draft,
  onChange,
  areas,
  killListAvailable,
  timezone,
  relativeToNow,
}: {
  title: string;
  draft: PlanLineDraft;
  onChange: (next: PlanLineDraft) => void;
  /** The domains this account has (plan-areas.ts). Empty = hide the domain picker; timing still works. */
  areas: PlanArea[];
  /** The account has a Business Kill List to add to. */
  killListAvailable: boolean;
  timezone: string;
  /** Planning today: the time wheel opens on the current time. */
  relativeToNow: boolean;
}) {
  function pickArea(area: PlanArea | null) {
    // Business preselects the Kill List (the owner's rule); any other choice clears it.
    onChange({ ...draft, area, addToKillList: area === "business" && killListAvailable && draft.area !== "business" ? true : area === "business" ? draft.addToKillList : false });
  }

  return (
    <div className="space-y-3 rounded-md bg-muted/40 p-3" data-testid="plan-line-details" aria-label={`Details for ${title}`} role="group">
      {areas.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Domain (optional)</p>
          <div role="group" aria-label="Domain" className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={draft.area === null} className={cn(CHIP)} onClick={() => pickArea(null)}>
              None
            </button>
            {areas.map((a) => (
              <button key={a} type="button" aria-pressed={draft.area === a} className={cn(CHIP)} onClick={() => pickArea(a)}>
                {PLAN_AREA_LABEL[a]}
              </button>
            ))}
          </div>
          {draft.area === "business" && killListAvailable ? (
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.addToKillList} onChange={(e) => onChange({ ...draft, addToKillList: e.target.checked })} data-testid="plan-add-to-kill-list" className="size-4" />
              Add to Kill List
            </label>
          ) : null}
          {draft.area === "business" && !killListAvailable ? <p className="text-xs text-muted-foreground">Kept as a Business task. Your account has no Kill List to add it to.</p> : null}
          {draft.area === "work" ? <p className="text-xs text-muted-foreground">Added to your Work Backlog.</p> : null}
          {draft.area === "school" ? <p className="text-xs text-muted-foreground">Added to your School tasks for the day, and shown in Now.</p> : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Start time (optional)</p>
        <QuickTimeField value={draft.startTime} onChange={(startTime) => onChange({ ...draft, startTime })} timezone={timezone} relativeToNow={relativeToNow} />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Timer (optional)</p>
        <DurationField value={draft.durationMinutes} onChange={(durationMinutes) => onChange({ ...draft, durationMinutes })} />
      </div>
    </div>
  );
}
