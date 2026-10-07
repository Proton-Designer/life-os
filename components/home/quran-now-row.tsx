"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logQuranReading } from "@/app/(app)/deen/quran-plan-actions";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import type { HomeNowItem } from "@/lib/quran/surfaces";

/**
 * QURAN-02: Home -> Today's "Right now" strip, "Quran · pages a–b": the khatm portion with a one-tap "Read". Optimistic
 * (the row ticks at once; a failed write un-ticks it and says why). The action revalidates "/" so the server view catches up.
 *
 * `forDate` "yesterday" is the post-midnight part of the reminder window: the row shows the PREVIOUS local date's portion,
 * and "Read" must credit exactly what is displayed. The core's `{ todaysPortion: true }` computes the portion from TODAY's
 * date even with forDate "yesterday" (it would credit up to a day more than shown), so after midnight this logs
 * `{ toPage: item.to }` filed under yesterday instead: the bookmark moves to exactly the displayed page. If the core refuses
 * (the bookmark already moved past it: a stale row) the core's message is shown and `onStale` refreshes Home; nothing
 * different is ever logged silently.
 */
export function QuranNowRow({ item, forDate = "today", onStale }: { item: HomeNowItem; forDate?: "today" | "yesterday"; onStale?: () => void }) {
  const [done, setDone] = useState(item.done);
  const [error, setError] = useState<string | null>(null);

  function read() {
    setError(null);
    setDone(true);
    enqueueByKey("quran:plan", () => (forDate === "yesterday" ? logQuranReading({ toPage: item.to }, { forDate: "yesterday" }) : logQuranReading({ todaysPortion: true })))
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
      })
      .catch((e: unknown) => {
        setDone(false);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
        onStale?.();
      });
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/40 p-3" data-testid="quran-now-row">
      <div className="flex items-center justify-between gap-3">
        <Link href="/deen" className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <BookOpen className="size-4 shrink-0 text-accent-deen" aria-hidden />
            <span className={done ? "text-muted-foreground line-through" : undefined}>{item.title}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {forDate === "yesterday" ? "Last night's portion · " : ""}
            {item.surahLabel} · {item.juzFrom !== undefined && item.juzTo !== undefined && item.juzFrom !== item.juzTo ? `Juz ${item.juzFrom}–${item.juzTo}` : `Juz ${item.juzFrom ?? item.juz}`}
          </p>
        </Link>
        {done ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-accent-deen" role="status" data-testid="quran-now-done">
            <Check className="size-4" aria-hidden />
            Read
          </span>
        ) : (
          <Button type="button" size="sm" onClick={read} data-testid="quran-now-read">
            ✓ Read
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive" data-testid="quran-now-error">
          Couldn&apos;t save: {error}
        </p>
      ) : null}
    </div>
  );
}
