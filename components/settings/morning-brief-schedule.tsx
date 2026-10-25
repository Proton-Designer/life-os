"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MORNING_BRIEF_SCHEDULE_PROMPT } from "@/lib/morning-brief/schedule-prompt";

/** Connector settings: a copyable prompt for a Claude / ChatGPT scheduled task that writes the Morning Brief. */
export function MorningBriefSchedule() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(MORNING_BRIEF_SCHEDULE_PROMPT);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the prompt stays selectable as plain text either way.
      setCopied(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border/40 p-4" aria-labelledby="morning-brief-schedule-heading">
      <h3 id="morning-brief-schedule-heading" className="text-sm font-medium">
        Schedule your Morning Brief
      </h3>
      <p className="text-sm text-muted-foreground">
        Have Claude or ChatGPT write your Morning Brief for you each morning, replacing the built-in one on Home. Connect it above with
        read and write access, create a scheduled task there (for example every day at 6:00 AM), and paste this as the task&apos;s prompt.
        Delete today&apos;s agent brief any time with the connector (<span className="font-mono text-xs">clear</span>) to go back to the built-in one.
      </p>
      <pre
        data-testid="morning-brief-prompt"
        className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap select-all"
      >
        {MORNING_BRIEF_SCHEDULE_PROMPT}
      </pre>
      <div>
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          {copied ? "Copied" : "Copy prompt"}
        </Button>
      </div>
    </section>
  );
}
