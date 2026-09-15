"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";

/**
 * P2-05's 9:30 PM reminder toggle -- a plain on/off, no per-user timing
 * setting (the exact minute is a fixed window in lib/notifications/
 * sleep-reminder.ts; see that file's own header and OPEN_QUESTIONS.md for
 * the logged assumption). Requires an existing push subscription to
 * actually deliver anything -- see NotificationSettings just above this in
 * the Notifications panel for enabling that; this toggle doesn't duplicate
 * that flow.
 */
export function SleepReminderSettings({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const next = !enabled;
    setEnabled(next); // optimistic
    setError(null);
    startTransition(async () => {
      try {
        await updateProfile({ sleep_reminder_enabled: next });
      } catch {
        setEnabled(!next); // revert
        setError("Couldn't save that. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} disabled={isPending} onChange={handleToggle} />
        <span>9:30 PM wind-down reminder</span>
      </label>
      <p className="text-xs text-muted-foreground">
        A push reminding you it&apos;s a good time to plan tomorrow and get some rest.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
