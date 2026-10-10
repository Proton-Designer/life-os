"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DurationField } from "@/components/plan/duration-field";
import { QuickTimeField } from "@/components/plan/quick-time-field";
import { MAX_CRITERIA_LENGTH } from "@/lib/night-plan/plan-details";
import { formatHHMM12 } from "@/lib/date-utils";
import { PLAN_AREA_LABEL, formatDuration, type PlanArea } from "@/lib/plan/plan-behavior";
import { cn } from "@/lib/utils";

/**
 * What the person can attach to one plan line -- all of it optional:
 *   - a domain (their own, from Settings), so the day can be read back by domain;
 *   - Business: "Add to Kill List" (preselected the moment Business is chosen; untick it to keep the line a plain
 *     Business task);
 *   - Work: when the person has Work tabs, picking Work asks WHICH tab (a popup). A Business tab makes the line a
 *     Business line that reaches that tab's Kill List; a job tab adds it to the Backlog. With no tabs it goes to the Backlog; School: it is added to today's School tasks (and shows in Today);
 *   - a start time and/or a timer, on ANY line, with or without a domain.
 * The editor is controlled: the plan stage owns the draft and writes it on Finish.
 */

export type PlanLineDraft = {
  area: PlanArea | null;
  addToKillList: boolean;
  /** "HH:MM" 24-hour, "" for none. */
  startTime: string;
  durationMinutes: number | null;
  /** Free text; "" for none. Details kept off the title so the title stays short on Home. */
  criteria: string;
  /** The Work tab (user_subdomains.key) chosen in the Work popup, or null. area is "business" for a Business tab, "work" for a job tab. */
  subdomain: string | null;
};

export const EMPTY_PLAN_DRAFT: PlanLineDraft = { area: null, addToKillList: false, startTime: "", durationMinutes: null, criteria: "", subdomain: null };

/** The short chips a collapsed row shows: "Business", "Kill List", "5:00 AM", "3h". Pure. */
export function planDraftSummary(draft: PlanLineDraft, workTabs: readonly PlanWorkTabOption[] = []): string[] {
  const out: string[] = [];
  const tab = draft.subdomain ? workTabs.find((t) => t.key === draft.subdomain) : undefined;
  if (tab) out.push(`Work · ${tab.label}`);
  else if (draft.area) out.push(PLAN_AREA_LABEL[draft.area]);
  if (draft.area === "business" && draft.addToKillList) out.push("Kill List");
  if (draft.startTime) out.push(formatHHMM12(draft.startTime));
  if (draft.durationMinutes !== null) out.push(formatDuration(draft.durationMinutes));
  if (draft.criteria.trim().length > 0) out.push("Criteria");
  return out;
}

/** One of the person's Work tabs (lib/night-plan/plan-areas.ts PlanWorkTab, restated so this client file stays free of server code). */
export type PlanWorkTabOption = { key: string; label: string; kind: "job" | "business" | null };

const CHIP = "min-h-8 rounded-md border px-2.5 text-xs transition-colors hover:bg-accent/60 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:hover:bg-primary/20";

export function PlanLineDetails({
  id,
  title,
  draft,
  onChange,
  areas,
  killListAvailable,
  workTabs = [],
  timezone,
  relativeToNow,
}: {
  id: string;
  title: string;
  draft: PlanLineDraft;
  onChange: (next: PlanLineDraft) => void;
  /** The domains this account has (plan-areas.ts). Empty = hide the domain picker; timing still works. */
  areas: PlanArea[];
  /** The account has a Business Kill List to add to. */
  killListAvailable: boolean;
  /** The person's Work tabs. Non-empty: picking Work opens a popup to choose one. Empty: Work is a plain domain. */
  workTabs?: PlanWorkTabOption[];
  timezone: string;
  /** Planning today: the time wheel opens on the current time. */
  relativeToNow: boolean;
}) {
  const [workPickerOpen, setWorkPickerOpen] = useState(false);
  const chosenTab = draft.subdomain ? workTabs.find((t) => t.key === draft.subdomain) ?? null : null;

  function pickArea(area: PlanArea | null) {
    // Business preselects the Kill List (the owner's rule); any other choice clears it (and any Work tab).
    onChange({ ...draft, area, subdomain: null, addToKillList: area === "business" && killListAvailable && draft.area !== "business" ? true : area === "business" ? draft.addToKillList : false });
  }

  function pickWorkTab(tab: PlanWorkTabOption) {
    // A Business tab is a Business line (Kill List, Deep Work); a job tab is a Work line (Backlog).
    const area: PlanArea = tab.kind === "business" ? "business" : "work";
    onChange({ ...draft, area, subdomain: tab.key, addToKillList: area === "business" && killListAvailable ? (draft.area === "business" ? draft.addToKillList : true) : false });
    setWorkPickerOpen(false);
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
              <button
                key={a}
                type="button"
                aria-pressed={a === "work" && workTabs.length > 0 ? draft.subdomain !== null || draft.area === "work" : a === "business" ? draft.area === "business" && draft.subdomain === null : draft.area === a}
                className={cn(CHIP)}
                onClick={() => (a === "work" && workTabs.length > 0 ? setWorkPickerOpen(true) : pickArea(a))}
              >
                {a === "work" && chosenTab ? `Work · ${chosenTab.label}` : PLAN_AREA_LABEL[a]}
              </button>
            ))}
          </div>
          {chosenTab ? (
            <p className="text-xs text-muted-foreground">
              Work area: {chosenTab.label}.{" "}
              <button type="button" className="underline underline-offset-4" onClick={() => setWorkPickerOpen(true)}>
                Change
              </button>
            </p>
          ) : null}
          {draft.area === "business" && killListAvailable ? (
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.addToKillList} onChange={(e) => onChange({ ...draft, addToKillList: e.target.checked })} data-testid="plan-add-to-kill-list" className="size-4" />
              Add to Kill List
            </label>
          ) : null}
          {draft.area === "business" && !killListAvailable ? <p className="text-xs text-muted-foreground">Kept as a Business task. Your account has no Kill List to add it to.</p> : null}
          {draft.area === "work" ? <p className="text-xs text-muted-foreground">Added to your Work Backlog.</p> : null}
          {draft.area === "school" ? <p className="text-xs text-muted-foreground">Added to your School tasks for the day, and shown in Today.</p> : null}
        </div>
      ) : null}

      <Dialog open={workPickerOpen} onOpenChange={setWorkPickerOpen}>
        <DialogContent className="max-w-sm" data-testid="plan-work-picker">
          <DialogHeader>
            <DialogTitle>Which Work area?</DialogTitle>
            <DialogDescription>Pick where this task belongs. It connects to that area&apos;s own widgets.</DialogDescription>
          </DialogHeader>
          <div role="group" aria-label="Work area" className="flex flex-col gap-2">
            {workTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={draft.subdomain === t.key}
                onClick={() => pickWorkTab(t)}
                className="flex min-h-12 flex-col items-start rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent/60 aria-pressed:border-primary aria-pressed:bg-primary/10"
              >
                <span className="text-sm font-medium">{t.label}</span>
                <span className="text-xs text-muted-foreground">{t.kind === "business" ? "Goes to its Kill List" : "Goes to its Backlog"}</span>
              </button>
            ))}
            <button type="button" className="min-h-10 text-xs text-muted-foreground underline underline-offset-4" onClick={() => { pickArea("work"); setWorkPickerOpen(false); }}>
              Just Work, no specific area
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Start time (optional)</p>
        <QuickTimeField value={draft.startTime} onChange={(startTime) => onChange({ ...draft, startTime })} timezone={timezone} relativeToNow={relativeToNow} />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Timer (optional)</p>
        <DurationField value={draft.durationMinutes} onChange={(durationMinutes) => onChange({ ...draft, durationMinutes })} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`plan-criteria-${id}`} className="text-xs font-medium text-muted-foreground">
          Criteria (optional)
        </label>
        <textarea
          id={`plan-criteria-${id}`}
          value={draft.criteria}
          onChange={(e) => onChange({ ...draft, criteria: e.target.value })}
          maxLength={MAX_CRITERIA_LENGTH}
          rows={3}
          placeholder="What has to be true for this to count as done? Keep the title short and put the detail here."
          data-testid="plan-criteria"
          className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
