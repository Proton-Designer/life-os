"use client";

import { useState } from "react";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { useScheduleRefresh } from "@/components/deen/use-optimistic-item";
import { logQuranSession } from "@/app/(app)/deen/actions";
import { computeQuranStreak } from "@/lib/deen/streak";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function QuranCard({
  currentSurah,
  currentJuz,
  sessionDates,
  todayStr,
}: {
  currentSurah: string | null;
  currentJuz: number | null;
  sessionDates: string[];
  todayStr: string;
}) {
  const scheduleRefresh = useScheduleRefresh();
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState("");
  const [surah, setSurah] = useState("");
  const [juz, setJuz] = useState("");

  const streak = computeQuranStreak(sessionDates, todayStr);

  // PERF-1: the form clears at once; the write runs queued in the background (a
  // second session can be entered right away) and a failure restores what was typed.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pagesNum = Number(pages);
    if (!pagesNum || pagesNum <= 0) return;
    const typed = { pages, surah, juz };
    setError(null);
    setPages("");
    setSurah("");
    setJuz("");
    enqueueByKey("quran:log", () => logQuranSession(pagesNum, typed.surah || undefined, typed.juz ? Number(typed.juz) : undefined))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Couldn't save that. Try again.");
        setPages(typed.pages);
        setSurah(typed.surah);
        setJuz(typed.juz);
      })
      .finally(scheduleRefresh);
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/40 p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {currentSurah ? `${currentSurah}${currentJuz ? ` · Juz ${currentJuz}` : ""}` : "No sessions logged yet"}
        </span>
        <span>{streak > 0 ? `${streak} day streak` : "No streak yet"}</span>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="quran-pages">
            Pages
          </label>
          <Input
            id="quran-pages"
            type="number"
            min={1}
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            className="w-20"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="quran-surah">
            Surah
          </label>
          <Input
            id="quran-surah"
            value={surah}
            onChange={(e) => setSurah(e.target.value)}
            className="w-32"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="quran-juz">
            Juz
          </label>
          <Input
            id="quran-juz"
            type="number"
            min={1}
            max={30}
            value={juz}
            onChange={(e) => setJuz(e.target.value)}
            className="w-16"
          />
        </div>
        <Button type="submit">Log session</Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Couldn&apos;t save: {error}
        </p>
      )}
    </div>
  );
}
