"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveMyAiPreference } from "@/app/(app)/settings/ai-preference-actions";

export interface AiProviderCatalogInfo {
  id: string;
  label: string;
  /** Whether this user has a usable key for this provider — deepseek may still work with no key if the operator-funded fallback allows this account (see lib/ai/resolve-key.ts's allowlist), every other provider needs a stored key. */
  hasKey: boolean;
  cheap: { id: string; inputUsdPer1M: number; outputUsdPer1M: number };
  capable: { id: string; inputUsdPer1M: number; outputUsdPer1M: number };
}

function priceHint(model: { inputUsdPer1M: number; outputUsdPer1M: number }): string {
  return `$${model.inputUsdPer1M}/$${model.outputUsdPer1M} per 1M tokens`;
}

/**
 * Which provider + tier your AI-backed features actually use. Separate
 * from key management just below it (ApiKeySettings) — a user can hold
 * several keys but has exactly one active choice, same reasoning
 * migration 173's own header gives for keeping the two tables apart.
 *
 * BOOK PROCESSING ALWAYS USES THE BUDGET MODEL, regardless of this
 * picker's tier choice (the Lead's Addition A) — stated here explicitly so
 * choosing "flagship" doesn't read as "book processing gets smarter too."
 */
export function AiPreferenceSettings({
  catalog,
  initialProvider,
  initialModelTier,
}: {
  catalog: AiProviderCatalogInfo[];
  initialProvider: string;
  initialModelTier: "cheap" | "capable";
}) {
  const [provider, setProvider] = useState(initialProvider);
  const [modelTier, setModelTier] = useState<"cheap" | "capable">(initialModelTier);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const selected = catalog.find((c) => c.id === provider);
  const dirty = provider !== initialProvider || modelTier !== initialModelTier;

  function handleSave() {
    startTransition(async () => {
      const res = await saveMyAiPreference(provider, modelTier);
      setResult(res);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/40 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Which AI provider to use</span>
        <p className="text-xs text-muted-foreground">
          Interactive features (like feedback on your typed answers) use this choice. Book processing always uses
          the budget model to keep costs low, no matter what you pick here.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {catalog.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={isPending}
              onClick={() => setProvider(c.id)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                provider === c.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {c.label}
              {!c.hasKey ? <span className="ml-1 opacity-60">(no key)</span> : null}
            </button>
          ))}
        </div>

        {selected && !selected.hasKey ? (
          <p className="text-xs text-muted-foreground">
            You haven&apos;t connected a {selected.label} key yet — add one below before switching to it, or this
            provider&apos;s features will simply be unavailable.
          </p>
        ) : null}

        {selected ? (
          <div className="flex flex-col gap-1.5">
            {(["cheap", "capable"] as const).map((tier) => {
              const model = selected[tier];
              return (
                <label key={tier} className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="model-tier"
                    checked={modelTier === tier}
                    disabled={isPending}
                    onChange={() => setModelTier(tier)}
                  />
                  <span className="font-medium">{tier === "cheap" ? "Budget" : "Flagship"}</span>
                  <span className="text-muted-foreground">
                    {model.id} · {priceHint(model)}
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={isPending || !dirty} onClick={handleSave}>
          {isPending ? "Saving…" : "Save preference"}
        </Button>
        {result ? (
          <p className={`text-xs ${result.ok ? "text-muted-foreground" : "text-destructive"}`}>{result.message}</p>
        ) : null}
      </div>
    </div>
  );
}
