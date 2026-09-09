"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { THEME_PRESET_IDS, THEME_PRESETS, type ThemePresetId } from "@/lib/theme-presets";
import { cn } from "@/lib/utils";

/**
 * L10 (docs/ai-connector/PROGRAM-PLAN.md): picks which of app/globals.css's
 * `[data-theme-preset]` accent-override blocks applies. Same idiom as
 * components/settings/connector-settings.tsx — the server action
 * (updateProfile) is imported directly, never passed as a prop, per
 * AGENTS.md's Server->Client rule.
 *
 * Each swatch previews its OWN preset's actual --accent-* hex values as
 * literal inline colors (not `var(--accent-*)`, which would just show
 * whatever preset is CURRENTLY active) — the whole point of the picker is
 * to compare presets you're not on yet.
 */
export function ThemeSettings({ initial }: { initial: ThemePresetId }) {
  const [selected, setSelected] = useState<ThemePresetId>(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(preset: ThemePresetId) {
    if (preset === selected) return;
    setError(null);
    const previous = selected;
    setSelected(preset); // optimistic — app-shell.tsx re-derives this from the DB on next navigation regardless
    startTransition(async () => {
      try {
        await updateProfile({ theme_preset: preset });
      } catch (e) {
        setSelected(previous);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Dark-first stays the same for every preset — this only changes the domain accent colors (badges, nav, icon
        chips). Takes effect on your next page load.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {THEME_PRESET_IDS.map((id) => {
          const preset = THEME_PRESETS[id];
          const active = id === selected;
          return (
            <button
              key={id}
              type="button"
              disabled={isPending}
              onClick={() => choose(id)}
              aria-pressed={active}
              className={cn(
                "flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
                active ? "border-foreground/60 bg-accent/50" : "border-border/40 hover:border-border"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{preset.label}</span>
                {active && <span className="text-xs text-muted-foreground">Current</span>}
              </div>
              <PresetSwatches preset={id} />
              <p className="text-xs text-muted-foreground">{preset.description}</p>
            </button>
          );
        })}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

// Literal hex values per preset, matching app/globals.css's own
// [data-theme-preset] blocks exactly — kept in sync by hand, same as that
// file's own comment requires ("re-step together... on any change"). Not
// derived from a live DOM read of the CSS vars, since a swatch needs to
// show a preset that ISN'T the one currently applied to the page.
const PRESET_HEX: Record<ThemePresetId, { deen: string; fitness: string; business: string; school: string; coop: string; info: string }> = {
  oxblood: { deen: "#e0a030", fitness: "#9085e9", business: "#4caf7d", school: "#6aa9ff", coop: "#d55181", info: "#5b8fd9" },
  ocean: { deen: "#3ba7a0", fitness: "#5b8fd9", business: "#2ecc9c", school: "#4fc3d9", coop: "#6c7ee1", info: "#38b6cc" },
  forest: { deen: "#d4a04a", fitness: "#5fae7a", business: "#7fae4a", school: "#3f9e7a", coop: "#b06b4a", info: "#6fae5a" },
  sunset: { deen: "#f0a050", fitness: "#e06590", business: "#f2c14e", school: "#c76bd9", coop: "#ef7d5c", info: "#e88a5c" },
  mono: { deen: "#c9c2b8", fitness: "#a8a4c9", business: "#a8c2ae", school: "#a8b8c9", coop: "#c9a8b8", info: "#b0b0b8" },
};

function PresetSwatches({ preset }: { preset: ThemePresetId }) {
  const hex = PRESET_HEX[preset];
  return (
    <div className="flex gap-1" aria-hidden>
      {Object.values(hex).map((color, i) => (
        <span key={i} className="size-4 rounded-full" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}
