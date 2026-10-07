"use client";

import { useState, useTransition } from "react";
import { saveQuranReminderWindow } from "@/app/(app)/settings/quran-reminder-actions";
import { DEFAULT_QURAN_REMINDER_END, DEFAULT_QURAN_REMINDER_START, validateQuranReminderWindow } from "@/lib/home/quran-reminder";
import { formatHHMM12 } from "@/lib/date-utils";
import { TimeField12 } from "@/components/ui/time-field-12";

/**
 * "Quran reminder" (Deen Mode only): the hours in which today's Quran portion shows on Home. Outside them it stays on the
 * Faith page. Two 12-hour pickers; stored as local "HH:MM". Unset = the default 10 PM -> 1 AM (crosses midnight).
 */
export function QuranReminderSettings({ initialStart, initialEnd }: { initialStart: string | null; initialEnd: string | null }) {
  const [start, setStart] = useState(initialStart ?? DEFAULT_QURAN_REMINDER_START);
  const [end, setEnd] = useState(initialEnd ?? DEFAULT_QURAN_REMINDER_END);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const invalid = validateQuranReminderWindow(start, end);
    if (invalid) {
      setMessage({ ok: false, text: invalid });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await saveQuranReminderWindow({ start, end });
      setMessage(res.ok ? { ok: true, text: `Saved. Today's Quran portion shows on Home from ${formatHHMM12(start)} to ${formatHHMM12(end)}.` } : { ok: false, text: res.message });
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="quran-reminder-settings">
      <div>
        <h3 className="text-sm font-medium">Quran reminder</h3>
        <p className="text-xs text-muted-foreground">When today&apos;s Quran portion shows on Home. Outside these hours it stays on the Faith page.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Starts</span>
          <TimeField12 value={start} onChange={setStart} aria-label="Quran reminder starts" defaultOpenValue={DEFAULT_QURAN_REMINDER_START} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Ends</span>
          <TimeField12 value={end} onChange={setEnd} aria-label="Quran reminder ends" defaultOpenValue={DEFAULT_QURAN_REMINDER_END} />
        </div>
        <button type="button" onClick={save} disabled={pending} className="h-9 rounded-md border px-3 disabled:opacity-50">
          Save
        </button>
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
