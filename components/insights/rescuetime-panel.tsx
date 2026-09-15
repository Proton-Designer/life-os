"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { syncRescueTimeSummaries } from "@/app/(app)/settings/rescuetime-actions";
import { Button } from "@/components/ui/button";
import type { RescueTimeInsightsData } from "@/lib/insights/get-rescuetime-summary";

function formatSyncedAt(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

function formatPct(pct: number | null): string {
  return pct === null ? "—" : `${pct.toFixed(0)}%`;
}

function formatHours(hours: number | null): string {
  return hours === null ? "—" : `${hours.toFixed(1)}h`;
}

/**
 * P3-19 -- daily productive-vs-distracting breakdown, read-only cache
 * display (lib/insights/get-rescuetime-summary.ts) plus a manual Sync
 * button. Lives in Insights (not Distractions, which has no dedicated
 * route to mount into) -- matches this app's own "analytics/history is
 * isolated to Insights" stance (PRODUCT_CONTEXT.md).
 *
 * A real table, not a chart (a9's own wording: "a readable table") -- this
 * is a glance-and-compare-rows surface, not a trend the eye needs to sweep.
 */
export function RescueTimePanel({ initialData }: { initialData: RescueTimeInsightsData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (!initialData.connected) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect RescueTime in{" "}
        <Link href="/settings#rescuetime" className="underline">
          Settings
        </Link>{" "}
        to see your productive-vs-distracting breakdown here.
      </p>
    );
  }

  function handleSync() {
    startTransition(async () => {
      try {
        await syncRescueTimeSummaries();
      } finally {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {initialData.lastSyncedAt ? `Last synced ${formatSyncedAt(initialData.lastSyncedAt)}` : "Never synced yet."}
        </p>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleSync}>
          {isPending ? "Syncing…" : "Sync"}
        </Button>
      </div>
      {initialData.lastSyncError ? <p className="text-xs text-destructive">{initialData.lastSyncError}</p> : null}

      {initialData.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data yet — click Sync to pull your first days.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Pulse</th>
                <th className="py-1 pr-2 font-medium">Productive</th>
                <th className="py-1 pr-2 font-medium">Distracting</th>
                <th className="py-1 font-medium">Tracked</th>
              </tr>
            </thead>
            <tbody>
              {initialData.rows.map((r) => (
                <tr key={r.date} className="border-t border-border/30">
                  <td className="py-1 pr-2">{r.date}</td>
                  <td className="py-1 pr-2">{r.productivityPulse ?? "—"}</td>
                  <td className="py-1 pr-2">{formatPct(r.productivePct)}</td>
                  <td className="py-1 pr-2">{formatPct(r.distractingPct)}</td>
                  <td className="py-1">{formatHours(r.totalHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
