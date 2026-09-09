"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { FEATURE_IDS, FEATURES, type FeatureId } from "@/lib/features";

/**
 * L10 (docs/ai-connector/PROGRAM-PLAN.md) — the Lead's ruling on the narrow
 * reading of "remove unwanted features / add features they don't have yet":
 * toggling visibility of already-built nav destinations. Same
 * server-action-imported-directly idiom as components/settings/
 * connector-settings.tsx, per AGENTS.md's Server->Client rule.
 *
 * Home and Settings never appear here at all — FEATURE_IDS (lib/features.ts)
 * structurally excludes both, so there is no checkbox that could lock a
 * user out of turning a hidden module back on.
 */
export function FeatureVisibilitySettings({ initialHidden }: { initialHidden: FeatureId[] }) {
  const [hidden, setHidden] = useState<Set<FeatureId>>(new Set(initialHidden));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: FeatureId, visible: boolean) {
    setError(null);
    const previous = new Set(hidden);
    const next = new Set(hidden);
    if (visible) next.delete(id);
    else next.add(id);
    setHidden(next); // optimistic

    startTransition(async () => {
      try {
        await updateProfile({ hidden_features: [...next] });
      } catch (e) {
        setHidden(previous);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Turn off a domain you're not using right now — it disappears from navigation everywhere. Nothing is deleted;
        turn it back on here any time. Home and Settings can't be hidden.
      </p>
      <div className="flex flex-col gap-2">
        {FEATURE_IDS.map((id) => {
          const visible = !hidden.has(id);
          return (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={visible}
                disabled={isPending}
                onChange={(e) => toggle(id, e.target.checked)}
              />
              {FEATURES[id].label}
            </label>
          );
        })}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
