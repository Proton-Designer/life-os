"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { QuranLogInput } from "@/components/deen/quran-plan-types";
import { addDaysToDateString, formatShortDate } from "@/lib/date-utils";
import { ayahLabel, globalAyah, pageSpanAyahLabel } from "@/lib/quran/ayah-map";
import { logPageRange, resolveLog, type LedgerEntry, type LogMethod, type ResolvedLog } from "@/lib/quran/ledger";
import { SURAHS } from "@/lib/quran/page-map";
import { cn } from "@/lib/utils";

export type LogMode = "pages" | "onPage" | "onAyah";

export type LogFormPlan = { ledger: LedgerEntry[]; startPage: number; startDate: string; currentPage: number; currentAyah: number | null };

export type LogFormInitial = { date?: string; mode?: LogMode; pages?: number };

const MODES: { key: LogMode; label: string }[] = [
  { key: "pages", label: "Pages read" },
  { key: "onPage", label: "Page I'm on" },
  { key: "onAyah", label: "Ayah I'm on" },
];

/**
 * QURAN-03: the one way to log reading. Say it however you think of it (a number of pages, the page you're on, or the exact
 * ayah you're on), for today, yesterday or any earlier day. Every choice is previewed with the same ledger code the server
 * uses, so the button only enables when the log fits in page order with the days around it, and the line under the form says
 * exactly what will be saved (or why it can't be).
 */
export function QuranLogForm({
  plan,
  todayStr,
  busy,
  initial,
  submitLabel = "Log reading",
  onSubmit,
  onCancel,
}: {
  plan: LogFormPlan;
  todayStr: string;
  busy: boolean;
  initial?: LogFormInitial;
  submitLabel?: string;
  onSubmit: (input: QuranLogInput, date: string, resolved: ResolvedLog) => void;
  onCancel?: () => void;
}) {
  const yesterday = addDaysToDateString(todayStr, -1);
  const startDay: "today" | "yesterday" | "other" = !initial?.date || initial.date === todayStr ? "today" : initial.date === yesterday ? "yesterday" : "other";
  const [mode, setMode] = useState<LogMode>(initial?.mode ?? "pages");
  const [day, setDay] = useState<"today" | "yesterday" | "other">(startDay);
  const [otherDate, setOtherDate] = useState(initial?.date && startDay === "other" ? initial.date : yesterday);
  const [count, setCount] = useState(initial?.pages ? String(initial.pages) : "");
  const [page, setPage] = useState("");
  const [surah, setSurah] = useState("2");
  const [ayahNum, setAyahNum] = useState("");

  const date = day === "today" ? todayStr : day === "yesterday" ? yesterday : otherDate;
  const ctx = { startPage: plan.startPage, startDate: plan.startDate, today: todayStr };

  let method: LogMethod | null = null;
  let input: QuranLogInput | null = null;
  if (mode === "pages" && /^\d+$/.test(count)) {
    method = { kind: "pages", count: Number(count) };
    input = { pages: Number(count) };
  } else if (mode === "onPage" && /^\d+$/.test(page)) {
    method = { kind: "onPage", page: Number(page) };
    input = { nextPage: Number(page) };
  } else if (mode === "onAyah" && /^\d+$/.test(ayahNum)) {
    const g = globalAyah(Number(surah), Number(ayahNum));
    if (g !== null) {
      method = { kind: "onAyah", ayah: g };
      input = { ayah: g };
    }
  }
  // "I'm on page N" can't go below the page after what's already logged before this day (nor past the next logged day): the stepper stops there.
  const range = /^\d{4}-\d{2}-\d{2}$/.test(date) ? logPageRange(plan.ledger, date, ctx) : { from: plan.currentPage, limit: 604 };
  const onPageMin = Math.min(604, range.from + 1);
  const onPageMax = Math.min(604, range.limit + 1);
  const ayahMissing = mode === "onAyah" && /^\d+$/.test(ayahNum) && globalAyah(Number(surah), Number(ayahNum)) === null;
  const surahInfo = SURAHS[Number(surah) - 1];
  const resolved = method && /^\d{4}-\d{2}-\d{2}$/.test(date) ? resolveLog(plan.ledger, date, method, ctx) : null;

  let preview: { tone: "ok" | "bad"; text: string } | null = null;
  if (ayahMissing) preview = { tone: "bad", text: `${surahInfo.transliteration} has ${surahInfo.ayahs} ayahs.` };
  else if (resolved && !resolved.ok) preview = { tone: "bad", text: resolved.message };
  else if (resolved?.ok) {
    const { from, to } = resolved.entry;
    if (resolved.positionOnly && resolved.restAyah) {
      preview = { tone: "ok", text: `Saves your place at ${ayahLabel(resolved.restAyah)}. No whole page is added yet.` };
    } else {
      const n = to - from + 1;
      const next = to + 1;
      const where = next > 604 ? "That completes the khatm." : resolved.restAyah ? `You'll be at ${ayahLabel(resolved.restAyah)}.` : `Next: page ${next}.`;
      preview = { tone: "ok", text: `Adds ${from === to ? `page ${from}` : `pages ${from}–${to}`} (${n} page${n === 1 ? "" : "s"}) · ${pageSpanAyahLabel(from, to)}. ${where}` };
    }
  }

  const canSubmit = !busy && resolved?.ok === true && input !== null;

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="quran-log-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && resolved?.ok && input) onSubmit(input, date, resolved);
      }}
    >
      <div role="tablist" aria-label="How do you want to log it?" className="flex flex-wrap gap-1.5">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            data-testid={`quran-mode-${m.key}`}
            onClick={() => setMode(m.key)}
            className={cn("rounded-full border px-3 py-1 text-xs transition-colors", mode === m.key ? "border-accent-deen bg-accent-deen/10 text-foreground" : "border-border/40 text-muted-foreground hover:text-foreground")}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {mode === "pages" ? (
          <>
            <label htmlFor="quran-count" className="text-xs text-muted-foreground">
              I read
            </label>
            <Input id="quran-count" type="number" inputMode="numeric" min={1} max={604} value={count} onChange={(e) => setCount(e.target.value)} className="h-8 w-20" placeholder="3" />
            <span className="text-xs text-muted-foreground">pages</span>
          </>
        ) : null}
        {mode === "onPage" ? (
          <>
            <label htmlFor="quran-on-page" className="text-xs text-muted-foreground">
              I&apos;m on page
            </label>
            <Input id="quran-on-page" type="number" inputMode="numeric" min={onPageMin} max={Math.max(onPageMin, onPageMax)} value={page} onChange={(e) => setPage(e.target.value)} className="h-8 w-20" placeholder={String(onPageMin)} />
            <span className="text-xs text-muted-foreground">(finished through the page before)</span>
          </>
        ) : null}
        {mode === "onAyah" ? (
          <>
            <label htmlFor="quran-surah" className="text-xs text-muted-foreground">
              I&apos;m on
            </label>
            <select
              id="quran-surah"
              value={surah}
              onChange={(e) => setSurah(e.target.value)}
              className="h-8 max-w-[11rem] rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
              data-testid="quran-surah"
            >
              {SURAHS.map((s) => (
                <option key={s.number} value={s.number} className="bg-background">
                  {s.number}. {s.transliteration}
                </option>
              ))}
            </select>
            <label htmlFor="quran-ayah" className="sr-only">
              Ayah number
            </label>
            <Input id="quran-ayah" type="number" inputMode="numeric" min={1} max={surahInfo.ayahs} value={ayahNum} onChange={(e) => setAyahNum(e.target.value)} className="h-8 w-20" placeholder={`1–${surahInfo.ayahs}`} />
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">For</span>
        {(["today", "yesterday", "other"] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={day === d}
            data-testid={`quran-day-${d}`}
            onClick={() => setDay(d)}
            className={cn("rounded-full border px-2.5 py-0.5 transition-colors", day === d ? "border-accent-deen bg-accent-deen/10 text-foreground" : "border-border/40 text-muted-foreground hover:text-foreground")}
          >
            {d === "today" ? "Today" : d === "yesterday" ? "Yesterday" : "Another day"}
          </button>
        ))}
        {day === "other" ? (
          <Input type="date" value={otherDate} min={plan.startDate} max={todayStr} onChange={(e) => setOtherDate(e.target.value)} aria-label="Day" className="h-8 w-40" data-testid="quran-other-date" />
        ) : (
          <span className="text-muted-foreground">· {formatShortDate(date)}</span>
        )}
      </div>

      <p
        className={cn("min-h-[1.25rem] text-xs", preview?.tone === "bad" ? "text-destructive" : "text-muted-foreground")}
        role="status"
        aria-live="polite"
        data-testid="quran-log-preview"
        data-tone={preview?.tone ?? "idle"}
      >
        {preview?.text ?? (mode === "onAyah" ? "Pick the surah and ayah you're on. Pages count once you finish them; your place inside the page is remembered." : "Type a number to see what will be saved.")}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!canSubmit} data-testid="quran-log-submit">
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
