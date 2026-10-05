"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logQuranReading } from "@/app/(app)/deen/quran-plan-actions";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import type { HomeNowItem } from "@/lib/quran/surfaces";

/**
 * QURAN-02: Home -> Now, "Quran · pages a–b": today's khatm portion with a one-tap "Read". Optimistic (the row ticks at
 * once; a failed write un-ticks it and says why). The action revalidates "/" so the server view catches up.
 */
export function QuranNowRow({ item }: { item: HomeNowItem }) {
  const [done, setDone] = useState(item.done);
  const [error, setError] = useState<string | null>(null);

  function read() {
    setError(null);
    setDone(true);
    enqueueByKey("quran:plan", () => logQuranReading({ todaysPortion: true }))
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
      })
      .catch((e: unknown) => {
        setDone(false);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
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
