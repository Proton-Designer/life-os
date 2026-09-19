"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { OPT_IN_FEATURE_IDS, OPT_IN_FEATURES, type OptInFeatureId } from "@/lib/opt-in-features";

/**
 * P3-05/P3-11 — the mirror-image of FeatureVisibilitySettings: turns ON a
 * new, default-OFF feature rather than hiding an existing one. Same
 * optimistic-toggle-with-rollback shape, same server-action-imported-
 * directly idiom (AGENTS.md's Server->Client rule).
 */
// P3-11 (estimate_vs_actual) has zero domain logic behind it --
// app/(app)/settings/actions.ts:57's own comment: "not yet built". Building
// that feature reverses a deliberate earlier product stance and is the
// user's call, not something to ship half-finished as a side effect of
// wiring up P3-05's cards library. Suppressed HERE, at the render layer
// only: it stays in OPT_IN_FEATURE_IDS (lib/opt-in-features.ts) because
// profiles.enabled_features has a DB CHECK constraint validating stored
// values against that exact TS enum -- removing the id there would break
// that constraint for any row that already has it stored, and would also
// resurface as an "Unknown feature id" throw in updateProfile's own
// validation (app/(app)/settings/actions.ts) for such a row. A user who
// already had it on before this change keeps that stored value (silently,
// harmlessly inert -- nothing reads it) rather than having it stripped out
// from under them.
const RENDERED_FEATURE_IDS = OPT_IN_FEATURE_IDS.filter((id) => id !== "estimate_vs_actual");

export function OptInFeaturesSettings({ initialEnabled }: { initialEnabled: OptInFeatureId[] }) {
  const [enabled, setEnabled] = useState<Set<OptInFeatureId>>(new Set(initialEnabled));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: OptInFeatureId, on: boolean) {
    setError(null);
    const previous = new Set(enabled);
    const next = new Set(enabled);
    if (on) next.add(id);
    else next.delete(id);
    setEnabled(next); // optimistic

    startTransition(async () => {
      try {
        await updateProfile({ enabled_features: [...next] });
      } catch (e) {
        setEnabled(previous);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Optional features, off by default. Turn one on to try it; turn it back off any time.
      </p>
      <div className="flex flex-col gap-2">
        {RENDERED_FEATURE_IDS.map((id) => {
          const on = enabled.has(id);
          return (
            <label key={id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={on}
                disabled={isPending}
                onChange={(e) => toggle(id, e.target.checked)}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span>{OPT_IN_FEATURES[id].label}</span>
                <span className="text-xs text-muted-foreground">{OPT_IN_FEATURES[id].description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
