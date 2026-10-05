"use client";

import { useEffect, useState } from "react";
import { Check, Circle, Pencil, Plus, X } from "lucide-react";
import {
  archiveMorningRoutineItem,
  createMorningRoutineItem,
  refreshLaunchViews,
  setLaunchStepDone,
  updateLaunchStep,
} from "@/app/(app)/morning-routine/actions";
import { useOptimisticItem } from "@/lib/client/use-optimistic-item";
import { MAX_ROUTINE_ITEMS } from "@/lib/morning-routine/constants";
import { stepSentence } from "@/lib/rhythm/launch";
import type { MorningRoutineChecklistItem } from "@/lib/morning-routine/actions-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { StartDayButton } from "@/components/home/rhythm/start-day-button";
import { cn } from "@/lib/utils";

export type LaunchHabitOption = { id: string; identityStatement: string };

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshLaunch = () => refreshLaunchViews();

function StepRow({ item, today, editing, habits, onEdit, onRemove, onTicked }: {
  item: MorningRoutineChecklistItem;
  today: string;
  editing: boolean;
  habits: LaunchHabitOption[];
  onEdit: (item: MorningRoutineChecklistItem) => void;
  onRemove: (item: MorningRoutineChecklistItem) => void;
  /** Fired when the user ticks (not un-ticks) the step: the card uses it to offer starting the day. */
  onTicked: () => void;
}) {
  // ABSOLUTE tick (setLaunchStepDone = tick + the linked habit's vote, rolled back together on the
  // server). Keyed by step AND local date, so a tab left open past midnight starts the new day
  // un-ticked once the page re-renders with the new `today`; nothing is disabled while one saves.
  const tick = useOptimisticItem<boolean>({
    serverValue: item.checkedToday,
    queueKey: `launch:${item.id}:${today}`,
    write: async (next) => {
      const res = await setLaunchStepDone(item.id, next);
      if (!res.ok) throw new Error(res.message);
    },
    refresh: refreshLaunch,
  });
  const done = tick.value;
  const linked = item.habitId ? habits.find((h) => h.id === item.habitId) : undefined;

  return (
    <li className="flex flex-col gap-1" data-testid="launch-step">
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          onClick={() => {
            void tick.set(!done);
            if (!done) onTicked();
          }}
          className="flex min-h-10 flex-1 items-start gap-2 rounded-md px-1 text-left text-sm"
        >
          {done ? <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className={cn(done && "text-muted-foreground line-through")}>{stepSentence(item)}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span data-testid="last-seven">{item.doneLast7} of last 7</span>
              {item.fallbackText ? <span className="rounded-full bg-muted px-2 py-0.5" data-testid="fallback-chip">2-min version: {item.fallbackText}</span> : null}
              {linked ? <span>counts for “{linked.identityStatement}”</span> : null}
            </span>
          </span>
        </button>
        {editing ? (
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Edit ${item.label}`} onClick={() => onEdit(item)}>
              <Pencil className="size-3.5" aria-hidden />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${item.label}`} onClick={() => onRemove(item)}>
              <X className="size-3.5" aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>
      {tick.error ? (
        <p role="alert" className="pl-7 text-xs text-destructive">
          {tick.error}
        </p>
      ) : null}
    </li>
  );
}

type Draft = { id: string | null; label: string; ifCue: string; fallbackText: string; habitId: string };
const EMPTY_DRAFT: Draft = { id: null, label: "", ifCue: "", fallbackText: "", habitId: "" };

/**
 * Home's Launch sequence (IA-P4b, opt-in "Morning routine"): up to 5 if-then steps for the start of
 * the day -- "When <cue>, I <step>", an optional 2-minute fallback, an optional identity habit the
 * step counts as a vote for, and "x of the last 7" (a count, never a streak). The list is DERIVED
 * from server props: local overlays (an added / edited / removed step) hold only until the next
 * server render hands in new items (or a new local day), which fixes the old card's
 * never-resyncs / midnight bugs.
 */
export function LaunchSequenceCard({ items, today, habits, dayStarted = true }: { items: MorningRoutineChecklistItem[]; today: string; habits: LaunchHabitOption[]; /** false = the Start Day mark doesn't exist yet today (Home's "morning" state). Default true so every other caller is unchanged. */ dayStarted?: boolean }) {
  const [added, setAdded] = useState<MorningRoutineChecklistItem[]>([]);
  const [edited, setEdited] = useState<Record<string, Partial<MorningRoutineChecklistItem>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Ticking a step while the day isn't started offers (never forces) starting it. Not auto-started on purpose: a late
  // catch-up tick would otherwise record the wrong wake time, and the wake mark can't be corrected afterwards.
  const [ticked, setTicked] = useState(false);
  const offerStart = !dayStarted && ticked;

  // A new server render (new items array, or a new local day) replaces the overlays: props win.
  useEffect(() => {
    setAdded([]);
    setEdited({});
    setRemoved(new Set());
  }, [items, today]);

  const serverIds = new Set(items.map((i) => i.id));
  const list = [
    ...items.filter((i) => !removed.has(i.id)).map((i) => ({ ...i, ...(edited[i.id] ?? {}) })),
    ...added.filter((a) => !serverIds.has(a.id) && !removed.has(a.id)),
  ];
  const atCap = list.length >= MAX_ROUTINE_ITEMS;

  function startEdit(item: MorningRoutineChecklistItem) {
    setError(null);
    setDraft({ id: item.id, label: item.label, ifCue: item.ifCue ?? "", fallbackText: item.fallbackText ?? "", habitId: item.habitId ?? "" });
  }

  async function remove(item: MorningRoutineChecklistItem) {
    setError(null);
    setRemoved((prev) => new Set(prev).add(item.id));
    const res = await archiveMorningRoutineItem(item.id).catch(() => ({ ok: false as const, message: "Couldn't remove that step." }));
    if (!res.ok) {
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setError(res.message);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const label = draft.label.trim();
    if (!label) {
      setError("Write the step first.");
      return;
    }
    setError(null);
    setSaving(true);
    const options = { ifCue: draft.ifCue.trim() || null, fallbackText: draft.fallbackText.trim() || null, habitId: draft.habitId || null };
    try {
      if (draft.id === null) {
        const res = await createMorningRoutineItem(label, options);
        if (!res.ok) return setError(res.message);
        setAdded((prev) => [...prev, { ...res.item, checkedToday: false, doneLast7: 0 }]);
      } else {
        const res = await updateLaunchStep(draft.id, { label, ...options });
        if (!res.ok) return setError(res.message);
        setEdited((prev) => ({ ...prev, [draft.id as string]: { label, ...options } }));
      }
      setDraft(null);
    } catch {
      setError("Couldn't save that step. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Launch sequence"
      data-testid="launch-sequence"
      controls={
        <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing((e) => !e); setDraft(null); setError(null); }} data-testid="launch-edit-toggle">
          {editing ? "Done" : "Edit steps"}
        </Button>
      }
    >
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">No steps yet. Pick 3 to 5 things that start your day, each tied to a moment: “When I pour my coffee, I stretch.”</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((item) => (
            <StepRow key={`${item.id}:${today}`} item={item} today={today} editing={editing} habits={habits} onEdit={startEdit} onRemove={remove} onTicked={() => setTicked(true)} />
          ))}
        </ul>
      )}

      {editing && draft === null && !atCap ? (
        <Button type="button" size="sm" variant="outline" className="mt-3 gap-1.5" onClick={() => setDraft({ ...EMPTY_DRAFT })} data-testid="launch-add">
          <Plus className="size-3.5" aria-hidden /> Add a step
        </Button>
      ) : null}
      {editing && atCap && draft === null ? <p className="mt-3 text-xs text-muted-foreground">That’s {MAX_ROUTINE_ITEMS} steps, the most a sequence can hold. Remove one to add another.</p> : null}

      {draft ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border p-3" data-testid="launch-draft">
          <Input value={draft.ifCue} maxLength={80} placeholder="When… (the moment, e.g. I pour my coffee)" aria-label="When" onChange={(e) => setDraft({ ...draft, ifCue: e.target.value })} />
          <Input value={draft.label} maxLength={120} placeholder="I… (the step, e.g. stretch for five minutes)" aria-label="I will" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <Input value={draft.fallbackText} maxLength={80} placeholder="2-minute version (optional)" aria-label="2-minute version" onChange={(e) => setDraft({ ...draft, fallbackText: e.target.value })} />
          {habits.length > 0 ? (
            <select value={draft.habitId} onChange={(e) => setDraft({ ...draft, habitId: e.target.value })} aria-label="Counts toward habit" className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Doesn’t count toward a habit</option>
              {habits.map((h) => (
                <option key={h.id} value={h.id}>
                  Counts toward: {h.identityStatement}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(null); setError(null); }}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={() => void saveDraft()} data-testid="launch-save">
              Save step
            </Button>
          </div>
        </div>
      ) : null}
      {offerStart ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border/60 p-3" data-testid="launch-start-offer">
          <p className="text-xs text-muted-foreground">Up already? Start your day too.</p>
          <StartDayButton />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
