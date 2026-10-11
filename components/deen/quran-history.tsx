"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { QuranLogForm, type LogFormInitial, type LogFormPlan } from "@/components/deen/quran-log-form";
import type { QuranLogInput } from "@/components/deen/quran-plan-types";
import { addDaysToDateString, formatShortDate } from "@/lib/date-utils";
import { pageSpanAyahLabel } from "@/lib/quran/ayah-map";
import { editEntry, ledgerGaps, resolveLog, sortLedger, type EntryPatch, type LedgerEntry, type PageGap } from "@/lib/quran/ledger";
import { cn } from "@/lib/utils";

const pagesText = (from: number, to: number) => (from === to ? `page ${from}` : `pages ${from}–${to}`);

/**
 * QURAN-03: every day you logged, newest first, with the pages each covered and what is still unlogged. Any day can be
 * changed or removed, a missed day can be added, and a gap can be filled. Each change is checked against the days around it
 * as you type (same ledger code as the server): a day that wouldn't line up in page order is refused with the reason, never saved.
 */
export function QuranHistory({
  open,
  onOpenChange,
  plan,
  todayStr,
  busy,
  error,
  focusDate,
  onAdd,
  onEdit,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: LogFormPlan;
  todayStr: string;
  busy: boolean;
  error: string | null;
  /** A day to jump to (from tapping its bar in the chart): its entry is highlighted, or the add form opens for it. */
  focusDate: string | null;
  onAdd: (input: QuranLogInput, date: string) => void;
  onEdit: (id: string, patch: EntryPatch) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState<LogFormInitial | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [seenFocus, setSeenFocus] = useState<string | null>(null);

  // Tapping a bar opens the dialog on that day: edit it if it has reading, otherwise offer to add it.
  if (open && focusDate !== seenFocus) {
    setSeenFocus(focusDate);
    if (focusDate) {
      const hit = plan.ledger.find((e) => e.date === focusDate);
      if (hit) setEditing(hit.id);
      else setAdding({ date: focusDate });
    }
  }
  if (!open && seenFocus !== null) setSeenFocus(null);

  const ctx = { startPage: plan.startPage, startDate: plan.startDate, today: todayStr };
  const rows = sortLedger(plan.ledger).reverse();
  const gaps = ledgerGaps(plan.ledger, plan.startPage);
  const totalPages = plan.ledger.reduce((n, e) => n + (e.to - e.from + 1), 0);

  const gapInitial = (gap: PageGap): LogFormInitial | null => {
    const before = plan.ledger.find((e) => e.to === gap.from - 1);
    const next = plan.ledger.find((e) => e.from === gap.to + 1);
    const candidates: string[] = before ? [before.date] : [];
    if (!before && next) {
      // A gap at the very start: the new day has to come before the first logged day.
      const d = addDaysToDateString(next.date, -1);
      if (d >= plan.startDate) candidates.push(d);
    }
    for (const d of candidates) {
      const probe = resolveLog(plan.ledger, d, { kind: "pages", count: 1 }, ctx);
      if (probe.ok && probe.entry.from === gap.from) return { date: d, mode: "pages", pages: gap.to - gap.from + 1 };
    }
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="quran-history">
        <DialogHeader>
          <DialogTitle>Reading history</DialogTitle>
          <DialogDescription>
            {rows.length === 0 ? "Nothing logged yet." : `${rows.length} day${rows.length === 1 ? "" : "s"} · ${totalPages} pages logged.`} Days have to follow each other in page order with no overlap; a change that doesn&apos;t line up is refused.
          </DialogDescription>
        </DialogHeader>

        {adding ? (
          <div className="rounded-lg border border-border/40 p-3" data-testid="quran-history-add">
            <p className="mb-2 text-sm font-medium">Add a day</p>
            <QuranLogForm
              plan={plan}
              todayStr={todayStr}
              busy={busy}
              initial={adding}
              submitLabel="Add this day"
              onSubmit={(input, date) => {
                onAdd(input, date);
                setAdding(null);
              }}
              onCancel={() => setAdding(null)}
            />
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setAdding({ date: focusDate ?? undefined })} data-testid="quran-history-add-open">
            <Plus className="size-3.5" aria-hidden />
            Add a day
          </Button>
        )}

        {error ? (
          <p role="alert" className="text-xs text-destructive" data-testid="quran-history-error">
            Couldn&apos;t save: {error}
          </p>
        ) : null}

        <ul className="flex flex-col gap-2" data-testid="quran-history-list">
          {gaps.map((gap) => {
            const fill = gapInitial(gap);
            return (
              <li key={`gap-${gap.from}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border/60 p-2.5 text-sm" data-testid="quran-history-gap">
                <span>
                  <span className="font-medium">{pagesText(gap.from, gap.to)}</span>
                  <span className="text-muted-foreground"> · not logged on any day</span>
                </span>
                {fill ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(fill)} data-testid="quran-history-fill">
                    Fill in
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Change the days around it to fill it</span>
                )}
              </li>
            );
          })}
          {rows.map((e) =>
            editing === e.id ? (
              <EditRow key={e.id} entry={e} plan={plan} todayStr={todayStr} busy={busy} onCancel={() => setEditing(null)} onSave={(patch) => (onEdit(e.id, patch), setEditing(null))} />
            ) : (
              <li key={e.id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm", focusDate === e.date ? "border-accent-deen" : "border-border/40")} data-testid="quran-history-row" data-date={e.date}>
                <div className="min-w-0">
                  <p>
                    <span className="font-medium">{formatShortDate(e.date, todayStr)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {pagesText(e.from, e.to)} · {e.to - e.from + 1} page{e.to === e.from ? "" : "s"}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{pageSpanAyahLabel(e.from, e.to)}</p>
                </div>
                {confirmDelete === e.id ? (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Remove this day?</span>
                    <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => (onDelete(e.id), setConfirmDelete(null))} data-testid="quran-history-delete-confirm">
                      Remove
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(e.id)} aria-label={`Edit ${formatShortDate(e.date)}`} data-testid="quran-history-edit">
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(e.id)} aria-label={`Remove ${formatShortDate(e.date)}`} data-testid="quran-history-delete">
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            )
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function EditRow({ entry, plan, todayStr, busy, onCancel, onSave }: { entry: LedgerEntry; plan: LogFormPlan; todayStr: string; busy: boolean; onCancel: () => void; onSave: (patch: EntryPatch) => void }) {
  const [date, setDate] = useState(entry.date);
  const [from, setFrom] = useState(String(entry.from));
  const [to, setTo] = useState(String(entry.to));
  const ctx = { startPage: plan.startPage, startDate: plan.startDate, today: todayStr };
  const f = Number(from);
  const t = Number(to);
  const numeric = /^\d+$/.test(from) && /^\d+$/.test(to) && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const patch: EntryPatch = { ...(date !== entry.date ? { date } : {}), ...(f !== entry.from ? { from: f } : {}), ...(t !== entry.to ? { to: t } : {}) };
  const changed = Object.keys(patch).length > 0;
  const check = numeric && changed ? editEntry(plan.ledger, entry.id, patch, ctx) : null;
  const bad = check && !check.ok ? check.message : null;
  const valid = numeric && changed && check?.ok === true;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-accent-deen p-2.5 text-sm" data-testid="quran-history-edit-row">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          Day
          <Input type="date" value={date} min={plan.startDate} max={todayStr} onChange={(e) => setDate(e.target.value)} className="h-8 w-40" data-testid="quran-edit-date" />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          From page
          <Input type="number" inputMode="numeric" min={plan.startPage} max={604} value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-20" data-testid="quran-edit-from" />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          To page
          <Input type="number" inputMode="numeric" min={1} max={604} value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-20" data-testid="quran-edit-to" />
        </label>
      </div>
      <p className={cn("min-h-[1.25rem] text-xs", bad ? "text-destructive" : "text-muted-foreground")} role="status" aria-live="polite" data-testid="quran-edit-preview">
        {bad ?? (numeric && t >= f && f >= 1 && t <= 604 ? `${t - f + 1} page${t === f ? "" : "s"} · ${pageSpanAyahLabel(f, t)}` : "Enter a first and last page.")}
      </p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!valid || busy} onClick={() => onSave(patch)} data-testid="quran-edit-save">
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </li>
  );
}
