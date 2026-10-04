"use client";

import { setThemePreset, refreshThemeViews } from "@/app/(app)/settings/theme-actions";
import { THEME_PRESET_IDS, THEME_PRESETS, PRESET_PREVIEW, type ThemePresetId } from "@/lib/theme-presets";
import { applyThemePreset } from "@/lib/client/theme-root";
import { useOptimisticItem } from "@/lib/client/use-optimistic-item";
import { cn } from "@/lib/utils";

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshTheme = () => refreshThemeViews();

/**
 * Picks which of app/globals.css's `:root[data-theme-preset]` schemes applies.
 *
 * Instant: a click sets <html data-theme-preset> synchronously (lib/client/
 * theme-root.ts), so the whole app restyles in that frame. Saving happens in the
 * background through the shared optimistic hook: writes for the picker run in click
 * order with the ABSOLUTE preset (last click wins, rapid clicks across presets end
 * on the last one), nothing is disabled while one saves, and a failed save puts the
 * app back on the last saved preset with an inline error.
 *
 * Each swatch previews its OWN preset's literal colours (not var(--...), which
 * would show whatever is active now), since the point is comparing presets you are
 * not on yet.
 */
export function ThemeSettings({ initial }: { initial: ThemePresetId }) {
  const item = useOptimisticItem<ThemePresetId>({
    serverValue: initial,
    queueKey: "theme-preset",
    write: (next) => setThemePreset(next),
    onRevert: (confirmed) => applyThemePreset(confirmed),
    refresh: refreshTheme,
  });
  const selected = item.value;

  function choose(preset: ThemePresetId) {
    if (preset === selected) return;
    applyThemePreset(preset);
    void item.set(preset);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Each preset changes the whole app: background, surfaces, text and accent colors. Changes apply instantly.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {THEME_PRESET_IDS.map((id) => {
          const preset = THEME_PRESETS[id];
          const active = id === selected;
          return (
            <button
              key={id}
              type="button"
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
      {item.error ? (
        <p role="alert" className="text-xs text-destructive">
          Couldn&apos;t save that preset: {item.error}
        </p>
      ) : null}
    </div>
  );
}

function PresetSwatches({ preset }: { preset: ThemePresetId }) {
  const { bg, card, accents } = PRESET_PREVIEW[preset];
  return (
    <div className="flex items-center gap-1" aria-hidden>
      <span className="flex h-6 w-10 overflow-hidden rounded-md border border-white/15">
        <span className="w-1/2" style={{ backgroundColor: bg }} />
        <span className="w-1/2" style={{ backgroundColor: card }} />
      </span>
      {Object.values(accents).map((color, i) => (
        <span key={i} className="size-4 rounded-full" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}
