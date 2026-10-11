"use client";

import { useState } from "react";
import { BookOpen, Check, History, Pause, Play, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuranDailyChart } from "@/components/deen/quran-daily-chart";
import { QuranHistory } from "@/components/deen/quran-history";
import { QuranLogForm } from "@/components/deen/quran-log-form";
import { KHATM_DUA } from "@/components/deen/khatm-dua";
import { QURAN_TOTAL_PAGES, type QuranActionResult, type QuranLogInput, type QuranPlanActions, type QuranPlanView, type QuranStartInput } from "@/components/deen/quran-plan-types";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { addDaysToDateString, formatShortDate } from "@/lib/date-utils";
import { ayahLabel, firstAyahOfPage } from "@/lib/quran/ayah-map";
import { juzForPage } from "@/lib/quran/page-map";
import { ledgerBookmark, resolveLog, type EntryPatch, type ResolvedLog } from "@/lib/quran/ledger";
import { ramadanWindow } from "@/lib/quran/ramadan";
import { cn } from "@/lib/utils";

type PlanView = Extract<QuranPlanView, { kind: "plan" }>;

const PRESETS: { key: "30d" | "60d" | "6m" | "ramadan"; label: string; days: number; note: string }[] = [
  { key: "30d", label: "30 days", days: 30, note: "about 20 pages a day" },
  { key: "60d", label: "60 days", days: 60, note: "about 10 pages a day" },
  { key: "6m", label: "6 months", days: 182, note: "3–4 pages a day" },
  { key: "ramadan", label: "Ramadan", days: 30, note: "1 juz a day, about 20 pages" },
];

const percentOf = (nextPage: number) => Math.max(0, Math.min(100, Math.floor(((nextPage - 1) / QURAN_TOTAL_PAGES) * 100)));

/**
 * QURAN-02: the Deen Quran card for a khatm plan. One bookmark (the next page to read) is the only thing tracked;
 * everything else is derived by the server and arrives in `view`. Four states: no plan (setup, "60 days"
 * pre-selected), active (today's portion, one-tap log, status with Keep / Move date), paused, and completed (the khatm
 * screen with the dua and "Start Khatm N+1"). Writes are OPTIMISTIC and queued under one key so they run in tap
 * order; a failed write puts the previous view back and says why. No streaks and no guilt copy: "5 of the last 7 days".
 */
export function QuranPlanCard({ view, actions, todayStr }: { view: QuranPlanView; actions: QuranPlanActions; todayStr: string }) {
  const [local, setLocal] = useState<QuranPlanView>(view);
  const [seen, setSeen] = useState<QuranPlanView>(view);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A server refresh (after the queued writes settle) re-seeds the card from the source of truth.
  if (seen !== view) {
    setSeen(view);
    setLocal(view);
  }

  /** Apply `next` now (when given); on a failed write put the previous view back and say why. */
  function run(write: () => Promise<QuranActionResult>, next?: (v: QuranPlanView) => QuranPlanView) {
    setError(null);
    const previous = local;
    if (next) setLocal(next(previous));
    else setBusy(true);
    enqueueByKey("quran:plan", write)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
      })
      .catch((e: unknown) => {
        setLocal(previous);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      })
      .finally(() => setBusy(false)); // no extra refresh: each action revalidates its pages and the new view re-seeds the card
  }

  const asPlan = (v: QuranPlanView): PlanView | null => (v.kind === "plan" ? v : null);
  const patchPlan = (patch: (p: PlanView) => Partial<PlanView>) => (v: QuranPlanView): QuranPlanView => {
    const p = asPlan(v);
    return p ? { ...p, ...patch(p) } : v;
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/40 p-4" data-testid="quran-plan-card">
      {local.kind === "none" ? (
        <Setup todayStr={todayStr} busy={busy} onStart={(input, startPage) => run(() => actions.start(input, startPage))} />
      ) : local.state === "completed" ? (
        <Khatm plan={local} busy={busy} onNext={() => run(() => actions.startNext())} />
      ) : (
        <ActivePlan
          plan={local}
          busy={busy}
          error={error}
          onLogPortion={() =>
            run(
              () => actions.logPortion("today"),
              patchPlan((p) => {
                const next = p.portion ? p.portion.toPage + 1 : p.currentPage;
                return { currentPage: next, currentAyah: null, percent: percentOf(next), portionDone: true, state: next > QURAN_TOTAL_PAGES ? "completed" : p.state, last7Days: Math.min(7, p.last7Days + (p.portionDone ? 0 : 1)) };
              })
            )
          }
          onLog={(input, date, resolved) =>
            run(
              () => actions.log(input, date),
              patchPlan((p) => {
                const { from, to } = resolved.entry;
                const ledger = resolved.positionOnly ? p.ledger : [...p.ledger, { id: `pending-${p.ledger.length}`, date, from, to, seq: Number.MAX_SAFE_INTEGER }];
                const next = ledgerBookmark(ledger, p.startPage);
                const pages = resolved.positionOnly ? 0 : to - from + 1;
                return {
                  ledger,
                  currentPage: next,
                  currentAyah: next > QURAN_TOTAL_PAGES ? null : resolved.restAyah,
                  percent: percentOf(next),
                  state: next > QURAN_TOTAL_PAGES ? "completed" : p.state,
                  daily: p.daily.map((d) => (d.date === date ? { ...d, pages: d.pages + pages } : d)),
                };
              })
            )
          }
          onEditEntry={(id, patch) => run(() => actions.editEntry(id, patch))}
          onDeleteEntry={(id) => run(() => actions.deleteEntry(id))}
          onUndo={() => run(() => actions.undoLast())}
          onKeep={() => run(() => actions.keepDate())}
          onMove={(date) => run(() => actions.moveDate(date))}
          onPause={() => run(() => actions.pause(), patchPlan(() => ({ state: "paused" as const })))}
          onResume={() => run(() => actions.resume(), patchPlan(() => ({ state: "active" as const })))}
          todayStr={todayStr}
        />
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive" data-testid="quran-plan-error">
          Couldn&apos;t save: {error}
        </p>
      ) : null}
    </div>
  );
}

function Setup({ todayStr, busy, onStart }: { todayStr: string; busy: boolean; onStart: (input: QuranStartInput, startPage: number) => void }) {
  const [choice, setChoice] = useState<"30d" | "60d" | "6m" | "ramadan" | "date" | "pace">("60d");
  const [date, setDate] = useState("");
  const [pace, setPace] = useState("");
  const [startAt, setStartAt] = useState("");
  const paceNum = Number(pace);
  // Ramadan is only offered in Sha'ban/Ramadan, and its finish is the real end of Ramadan (never "30 days from today" in October).
  const ramadan = ramadanWindow(todayStr);
  const presets = PRESETS.filter((p) => p.key !== "ramadan" || ramadan.offer).map((p) => ({
    ...p,
    doneBy: p.key === "ramadan" && ramadan.ramadanEnd ? ramadan.ramadanEnd : addDaysToDateString(todayStr, p.days - 1),
  }));
  const startAtNum = startAt === "" ? 1 : Number(startAt);
  const startOk = Number.isInteger(startAtNum) && startAtNum >= 1 && startAtNum <= QURAN_TOTAL_PAGES;
  const valid = startOk && (choice === "date" ? date > todayStr : choice === "pace" ? Number.isFinite(paceNum) && paceNum >= 1 && paceNum <= QURAN_TOTAL_PAGES : true);

  function submit() {
    const input: QuranStartInput = choice === "date" ? { targetDate: date } : choice === "pace" ? { pagesPerDay: paceNum } : { preset: choice };
    onStart(input, startAtNum);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="quran-setup">
      <div>
        <h3 className="text-sm font-medium">Read the whole Quran</h3>
        <p className="text-xs text-muted-foreground">Pick a pace. Each day shows the pages to read, and the plan follows you if a day is missed.</p>
      </div>
      <div role="radiogroup" aria-label="Plan length" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={choice === p.key}
            data-testid={`quran-preset-${p.key}`}
            onClick={() => setChoice(p.key)}
            className={cn("rounded-lg border p-3 text-left", choice === p.key ? "border-accent-deen bg-accent-deen/10" : "border-border/40 hover:bg-accent/40")}
          >
            <span className="block text-sm font-medium">{p.label}</span>
            <span className="block text-xs text-muted-foreground">
              {p.note} · done by {formatShortDate(p.doneBy)}
            </span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={choice === "date"}
          data-testid="quran-preset-date"
          onClick={() => setChoice("date")}
          className={cn("rounded-lg border p-3 text-left", choice === "date" ? "border-accent-deen bg-accent-deen/10" : "border-border/40 hover:bg-accent/40")}
        >
          <span className="block text-sm font-medium">Finish by a date</span>
          {choice === "date" ? (
            <Input type="date" min={addDaysToDateString(todayStr, 1)} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Finish date" className="mt-1 h-8" onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className="block text-xs text-muted-foreground">Choose your own end date</span>
          )}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={choice === "pace"}
          data-testid="quran-preset-pace"
          onClick={() => setChoice("pace")}
          className={cn("rounded-lg border p-3 text-left", choice === "pace" ? "border-accent-deen bg-accent-deen/10" : "border-border/40 hover:bg-accent/40")}
        >
          <span className="block text-sm font-medium">Pages a day</span>
          {choice === "pace" ? (
            <Input type="number" min={1} value={pace} onChange={(e) => setPace(e.target.value)} aria-label="Pages a day" className="mt-1 h-8 w-24" onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className="block text-xs text-muted-foreground">Set a daily pace; the date follows</span>
          )}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="quran-start-at" className="text-xs text-muted-foreground">
          Already reading? I&apos;m on page
        </label>
        <Input id="quran-start-at" type="number" min={1} max={QURAN_TOTAL_PAGES} placeholder="1" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="h-8 w-20" />
      </div>
      <Button type="button" className="w-full sm:w-auto sm:self-start" disabled={!valid || busy} onClick={submit} data-testid="quran-start">
        Start plan
      </Button>
    </div>
  );
}

function ActivePlan({
  plan,
  busy,
  error,
  todayStr,
  onLogPortion,
  onLog,
  onEditEntry,
  onDeleteEntry,
  onUndo,
  onKeep,
  onMove,
  onPause,
  onResume,
}: {
  plan: PlanView;
  busy: boolean;
  error: string | null;
  todayStr: string;
  onLogPortion: () => void;
  onLog: (input: QuranLogInput, date: string, resolved: ResolvedLog & { ok: true }) => void;
  onEditEntry: (id: string, patch: EntryPatch) => void;
  onDeleteEntry: (id: string) => void;
  onUndo: () => void;
  onKeep: () => void;
  onMove: (date: string | null) => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState(plan.status?.suggestedDate ?? "");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const paused = plan.state === "paused";
  const s = plan.status;
  const logged = plan.currentPage - 1;
  const here = Math.min(plan.currentPage, QURAN_TOTAL_PAGES);
  const hereAyah = plan.currentAyah ?? firstAyahOfPage(here);
  const openHistory = (date: string | null) => {
    setFocusDate(date);
    setHistoryOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className="text-sm font-medium" data-testid="quran-heading">
            Khatm {plan.khatmNumber} · {plan.percent}% · page {plan.currentPage} of {QURAN_TOTAL_PAGES}
          </h3>
          <span className="text-xs text-muted-foreground">Finish {formatShortDate(plan.targetDate)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={plan.percent} aria-label="Khatm progress">
          <div className="h-full rounded-full bg-accent-deen" style={{ width: `${plan.percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground" data-testid="quran-position">
          You&apos;re on <span className="font-medium text-foreground">page {here}</span> · {ayahLabel(hereAyah)} · Juz {juzForPage(here)}
          {logged >= plan.startPage ? ` · finished through page ${logged}` : ""}
        </p>
      </div>

      {plan.juzComplete ? (
        <p className="text-xs text-accent-deen" role="status" data-testid="quran-juz-note">
          Juz {plan.juzComplete.juz} complete · {plan.juzComplete.juz} of 30
        </p>
      ) : null}

      {paused ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3" data-testid="quran-paused">
          <p className="text-sm">Plan paused. Paused days don&apos;t count against you.</p>
          <Button type="button" size="sm" className="self-start" onClick={onResume} disabled={busy} data-testid="quran-resume">
            <Play className="size-3.5" aria-hidden />
            Resume
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border/40 p-3" data-testid="quran-today">
          {plan.portion && !plan.portionDone ? (
            <p className="text-sm" data-testid="quran-portion">
              <span className="text-muted-foreground">Today: </span>
              <span className="font-medium">
                {plan.portion.fromPage === plan.portion.toPage ? `page ${plan.portion.fromPage}` : `pages ${plan.portion.fromPage}–${plan.portion.toPage}`}
              </span>
              <span className="text-muted-foreground"> · {plan.portion.label}</span>
            </p>
          ) : null}
          {plan.portionDone ? (
            <p className="flex items-center gap-1.5 text-sm text-accent-deen" role="status" data-testid="quran-done">
              <Check className="size-4" aria-hidden />
              Today&apos;s portion is read
            </p>
          ) : (
            <Button type="button" className="w-full sm:w-auto sm:self-start" onClick={onLogPortion} disabled={busy || !plan.portion} data-testid="quran-log-portion">
              <BookOpen className="size-4" aria-hidden />✓ Read today&apos;s portion
            </Button>
          )}
          <div className="border-t border-border/40 pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Or log it your way</p>
            <QuranLogForm plan={plan} todayStr={todayStr} busy={busy} onSubmit={(input, date, resolved) => onLog(input, date, resolved)} />
          </div>
        </div>
      )}

      {s && !paused ? (
        <div className="flex flex-col gap-1.5 text-sm" data-testid="quran-status" data-kind={s.kind}>
          <p>
            {s.kind === "on_track" ? "On track" : s.kind === "behind" ? `${s.pages} page${s.pages === 1 ? "" : "s"} behind${s.days ? ` (about ${s.days} day${s.days === 1 ? "" : "s"})` : ""}` : `${s.pages} page${s.pages === 1 ? "" : "s"} ahead`}
          </p>
          {s.kind === "behind" ? (
            <p className="text-xs text-muted-foreground">
              To still finish {formatShortDate(plan.targetDate)}: {s.neededPerDay} a day.
              {s.projectedFinish ? ` At your recent pace you'd finish ${formatShortDate(s.projectedFinish)}.` : ""}
            </p>
          ) : null}
          {s.kind === "behind" && s.suggestMove ? (
            <p className="text-xs text-muted-foreground" data-testid="quran-suggest-move">
              That is a lot more than your plan. Moving the date may be kinder.
            </p>
          ) : null}
          {s.kind === "behind" ? (
            moving ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="quran-move-form">
                <Input type="date" value={moveDate} min={addDaysToDateString(todayStr, 1)} onChange={(e) => setMoveDate(e.target.value)} aria-label="New finish date" className="h-8 w-40" />
                <Button type="button" size="sm" disabled={busy || moveDate <= todayStr} onClick={() => (setMoving(false), onMove(moveDate))} data-testid="quran-move-confirm">
                  Move date
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setMoving(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={s.suggestMove ? "outline" : "default"} onClick={onKeep} disabled={busy} data-testid="quran-keep">
                  Keep {formatShortDate(plan.targetDate)}
                </Button>
                <Button type="button" size="sm" variant={s.suggestMove ? "default" : "outline"} onClick={() => setMoving(true)} disabled={busy} data-testid="quran-move">
                  Move date
                </Button>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      <QuranDailyChart days={plan.daily} goal={plan.pagesPerDay > 0 && !paused ? plan.pagesPerDay : null} todayStr={todayStr} onSelectDay={(d) => openHistory(d)} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid="quran-last7">{plan.last7Days} of last 7 days</span>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="inline-flex items-center gap-1 underline underline-offset-2" onClick={() => openHistory(null)} data-testid="quran-history-open">
            <History className="size-3" aria-hidden />
            History
          </button>
          <button type="button" className="inline-flex items-center gap-1 underline underline-offset-2 disabled:opacity-50" onClick={onUndo} disabled={busy} data-testid="quran-undo">
            <Undo2 className="size-3" aria-hidden />
            Undo last log
          </button>
          {!paused ? (
            <button type="button" className="inline-flex items-center gap-1 underline underline-offset-2 disabled:opacity-50" onClick={onPause} disabled={busy} data-testid="quran-pause">
              <Pause className="size-3" aria-hidden />
              Pause plan
            </button>
          ) : null}
        </div>
      </div>

      <QuranHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        plan={plan}
        todayStr={todayStr}
        busy={busy}
        error={error}
        focusDate={focusDate}
        onAdd={(input, date) => onLogViaHistory(input, date)}
        onEdit={onEditEntry}
        onDelete={onDeleteEntry}
      />
    </div>
  );

  function onLogViaHistory(input: QuranLogInput, date: string) {
    // History adds are checked by the form with the same ledger code; the server re-checks and reports anything stale.
    const method = "pages" in input ? ({ kind: "pages", count: input.pages } as const) : "nextPage" in input ? ({ kind: "onPage", page: input.nextPage } as const) : "toPage" in input ? ({ kind: "throughPage", page: input.toPage } as const) : ({ kind: "onAyah", ayah: input.ayah } as const);
    const resolved = resolveLog(plan.ledger, date, method, { startPage: plan.startPage, startDate: plan.startDate, today: todayStr });
    if (resolved.ok) onLog(input, date, resolved);
  }
}

function Khatm({ plan, busy, onNext }: { plan: PlanView; busy: boolean; onNext: () => void }) {
  return (
    <div className="flex flex-col gap-4 text-center" data-testid="quran-khatm">
      <h3 className="text-lg font-semibold">Khatm {plan.khatmNumber} complete</h3>
      <p className="text-sm text-muted-foreground">You have read the whole Quran.</p>
      <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-4">
        <p className="text-xs font-medium text-muted-foreground" data-testid="khatm-dua-label">
          {KHATM_DUA.label}
        </p>
        <p lang="ar" dir="rtl" className="text-xl leading-loose" data-testid="khatm-dua-arabic">
          {KHATM_DUA.arabic}
        </p>
        <p className="text-xs text-muted-foreground italic">{KHATM_DUA.transliteration}</p>
        <p className="text-xs text-muted-foreground">{KHATM_DUA.translation}</p>
      </div>
      <Button type="button" className="w-full sm:w-auto sm:self-center" onClick={onNext} disabled={busy} data-testid="quran-start-next">
        Start Khatm {plan.khatmNumber + 1} at the same pace
      </Button>
    </div>
  );
}
