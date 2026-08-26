"use client";

import { useEffect, useState } from "react";
import { getKillListHistory, getKillListDayDetail, type KillListGroup, type KillListItemRow } from "@/app/(app)/business/kill-list-history-actions";
import { ProgressRing } from "@/components/charts/progress-ring";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KillListItemsDialog } from "@/components/business/kill-list-items-dialog";

/**
 * "View More" popup for the kill list module (item B3-3, verbatim spec):
 * past items grouped This week / This month / Past 3 months, each day
 * showing a date, a completed/set count, and a progress ring; tapping a
 * day opens its actual items in a popup where they can be edited.
 *
 * Empty history is the launch state, not an edge case (Opus Lead, after
 * tonight's wipe): every group can legitimately render with nothing in
 * it, and that must read as calm and deliberate, same discipline as the
 * Salah calendar.
 */
export function KillListHistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [groups, setGroups] = useState<KillListGroup[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayItems, setDayItems] = useState<KillListItemRow[]>([]);

  useEffect(() => {
    if (!open) return;
    setGroups(null);
    getKillListHistory().then(setGroups);
  }, [open]);

  function openDay(date: string) {
    setSelectedDate(date);
    getKillListDayDetail(date).then(setDayItems);
  }

  const totalDays = groups?.reduce((sum, g) => sum + g.days.length, 0) ?? 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Kill list history</DialogTitle>
          </DialogHeader>
          {groups === null ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : totalDays === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No past kill list history yet.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map((group) => (
                <div key={group.label} className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground">{group.label}</h3>
                  {group.days.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nothing here.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {group.days.map((d) => (
                        <li key={d.date}>
                          <button
                            type="button"
                            onClick={() => openDay(d.date)}
                            className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
                          >
                            <span className="font-mono text-xs tabular-nums">{d.date}</span>
                            <ProgressRing
                              pct={(d.completed / d.total) * 100}
                              colorVar="--accent-business"
                              centerLabel={`${d.completed}/${d.total}`}
                              size={32}
                              strokeWidth={3}
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <KillListItemsDialog
        open={selectedDate !== null}
        onOpenChange={(next) => !next && setSelectedDate(null)}
        title={selectedDate ?? ""}
        items={dayItems}
        onItemsChange={setDayItems}
      />
    </>
  );
}
