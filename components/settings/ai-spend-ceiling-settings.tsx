"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveMyMonthlySpendCapUsd } from "@/app/(app)/settings/ai-spend-actions";

/**
 * Month-to-date spend + a personal monthly ceiling (P2-01) -- separate from
 * `AiPreferenceSettings` just above it: that one picks WHICH provider/tier
 * your calls use, this one caps HOW MUCH they can cost you in a month,
 * across every provider and key source (including your own key). See
 * lib/ai/monthly-spend-cap.ts's own header for why this is independent of
 * the operator's own shared-key cap.
 */
export function AiSpendCeilingSettings({
  initialSpentUsd,
  initialCapUsd,
  monthKey,
}: {
  initialSpentUsd: number | null;
  initialCapUsd: number;
  monthKey: string;
}) {
  const [capInput, setCapInput] = useState(initialCapUsd.toFixed(2));
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsedCap = Number(capInput);
  const validCap = Number.isFinite(parsedCap) && parsedCap > 0;
  const dirty = capInput !== initialCapUsd.toFixed(2);
  const spentPct = initialSpentUsd !== null && initialCapUsd > 0 ? Math.min(100, (initialSpentUsd / initialCapUsd) * 100) : null;

  function handleSave() {
    if (!validCap) {
      setResult({ ok: false, message: "Enter a positive dollar amount." });
      return;
    }
    startTransition(async () => {
      const res = await saveMyMonthlySpendCapUsd(parsedCap);
      setResult(res);
    });
  }

  function handleReset() {
    startTransition(async () => {
      const res = await saveMyMonthlySpendCapUsd(null);
      setResult(res);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/40 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Monthly AI budget</span>
        <p className="text-xs text-muted-foreground">
          A personal ceiling on what your AI-backed features can cost in a month, on any provider or key. Resets at
          the start of each month in your own timezone.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">{monthKey} so far</span>
          <span className="font-medium">
            {initialSpentUsd === null ? "Unavailable right now" : `$${initialSpentUsd.toFixed(2)} of $${initialCapUsd.toFixed(2)}`}
          </span>
        </div>
        {spentPct !== null ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
            <div
              className={`h-full rounded-full ${spentPct >= 100 ? "bg-destructive" : "bg-foreground"}`}
              style={{ width: `${spentPct}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Ceiling ($)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={capInput}
            disabled={isPending}
            onChange={(e) => setCapInput(e.target.value)}
            className="w-24 rounded-md border border-border/50 bg-transparent px-2 py-1 text-xs"
          />
        </label>
        <Button size="sm" disabled={isPending || !dirty || !validCap} onClick={handleSave}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={isPending} onClick={handleReset}>
          Use default
        </Button>
        {result ? (
          <p className={`w-full text-xs ${result.ok ? "text-muted-foreground" : "text-destructive"}`}>{result.message}</p>
        ) : null}
      </div>
    </div>
  );
}
