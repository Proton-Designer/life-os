"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { updateTrigger, saveActionPlan } from "@/app/(app)/distractions/actions";
import { useDistractionRefresh } from "@/components/distractions/use-distraction-refresh";
import type { TriggerSummary } from "@/lib/distractions/types";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconChip } from "@/components/ui/icon-chip";

const TEXTAREA_CLASS =
  "rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export function TriggerPlanCard({
  trigger,
  onUpdated,
}: {
  trigger: TriggerSummary;
  onUpdated: (updated: TriggerSummary) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trigger.name);
  const [description, setDescription] = useState(trigger.description ?? "");
  const [planBody, setPlanBody] = useState(trigger.currentPlan?.body ?? "");
  const [isPending, startTransition] = useTransition();
  const scheduleRefresh = useDistractionRefresh();

  function handleCancel() {
    setName(trigger.name);
    setDescription(trigger.description ?? "");
    setPlanBody(trigger.currentPlan?.body ?? "");
    setEditing(false);
  }

  function handleSave() {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const trimmedPlan = planBody.trim();
    if (!trimmedName || !trimmedPlan) return;

    startTransition(async () => {
      const patch: { name?: string; description?: string } = {};
      if (trimmedName !== trigger.name) patch.name = trimmedName;
      if (trimmedDescription !== (trigger.description ?? "")) patch.description = trimmedDescription;
      if (Object.keys(patch).length > 0) await updateTrigger(trigger.id, patch);
      if (trigger.currentPlan && trimmedPlan !== trigger.currentPlan.body) {
        await saveActionPlan(trigger.id, trimmedPlan);
      }
      // saveActionPlan no longer revalidates inline (PERF-4): one deferred refresh re-syncs Home + /review.
      scheduleRefresh();

      onUpdated({
        ...trigger,
        name: trimmedName,
        description: trimmedDescription || null,
        currentPlan: trigger.currentPlan ? { ...trigger.currentPlan, body: trimmedPlan } : trigger.currentPlan,
      });
      setEditing(false);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconChip icon={DOMAIN_ICON[trigger.domain]} accent={DOMAIN_ACCENT[trigger.domain]} size="sm" />
          {editing ? (
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" autoFocus />
          ) : (
            <span className="truncate font-medium">{trigger.name}</span>
          )}
        </div>
        {!editing && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${trigger.name}`}
          >
            <Pencil />
          </Button>
        )}
      </div>

      {editing ? (
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
        />
      ) : (
        trigger.description && <p className="text-xs text-muted-foreground">{trigger.description}</p>
      )}

      {editing ? (
        <textarea
          value={planBody}
          onChange={(e) => setPlanBody(e.target.value)}
          placeholder="Plan of action"
          rows={3}
          className={TEXTAREA_CLASS}
        />
      ) : (
        <p className="text-sm">{trigger.currentPlan?.body}</p>
      )}

      {editing && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isPending || !name.trim() || !planBody.trim()}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
