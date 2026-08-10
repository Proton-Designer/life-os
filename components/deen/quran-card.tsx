"use client";

import { useState, useTransition } from "react";
import { logQuranSession } from "@/app/(app)/deen/actions";
import { computeQuranStreak } from "@/lib/deen/streak";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function QuranCard({
  currentSurah,
  currentJuz,
  weekPagesRead,
  weeklyTarget,
  sessionDates,
  todayStr,
}: {
  currentSurah: string | null;
  currentJuz: number | null;
  weekPagesRead: number;
  weeklyTarget: number | null;
  sessionDates: string[];
  todayStr: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [pages, setPages] = useState("");
  const [surah, setSurah] = useState("");
  const [juz, setJuz] = useState("");

  const streak = computeQuranStreak(sessionDates, todayStr);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pagesNum = Number(pages);
    if (!pagesNum || pagesNum <= 0) return;
    startTransition(async () => {
      await logQuranSession(pagesNum, surah || undefined, juz ? Number(juz) : undefined);
      setPages("");
      setSurah("");
      setJuz("");
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/40 p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {currentSurah ? `${currentSurah}${currentJuz ? ` · Juz ${currentJuz}` : ""}` : "No sessions logged yet"}
        </span>
        <span>{streak > 0 ? `${streak} day streak` : "No streak yet"}</span>
      </div>
      <p className="text-sm">
        <span className="font-semibold">{weekPagesRead}</span>
        {weeklyTarget ? ` / ${weeklyTarget}` : ""} pages this week
      </p>
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
        <Button type="submit" disabled={isPending}>
          Log session
        </Button>
      </form>
    </div>
  );
}
