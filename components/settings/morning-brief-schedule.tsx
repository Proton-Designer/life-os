"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MORNING_BRIEF_SCHEDULE_PROMPT, WEEKLY_REVIEW_SCHEDULE_PROMPT, DAY_CONNECTION_SCHEDULE_PROMPT } from "@/lib/morning-brief/schedule-prompt";

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

/** Copyable prompts for the other agent-writable outputs: the weekly review and the session closer's day-connection lines. */
export function AgentOutputsSchedule() {
  const [copied, setCopied] = useState<string | null>(null);
  const items = [
    { id: "weekly", title: "Schedule your weekly review", when: "every Sunday at 7:00 AM", blurb: "Writes the \"Your week\" narrative on the Weekly Review screen.", prompt: WEEKLY_REVIEW_SCHEDULE_PROMPT },
    { id: "lessons", title: "Schedule lesson links to your day", when: "every day at 6:00 AM", blurb: "Writes the \"Today\" line that ties a lesson to your plan when you finish a study session.", prompt: DAY_CONNECTION_SCHEDULE_PROMPT },
  ];
  async function copy(id: string, prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(id);
    } catch {
      setCopied(null);
    }
  }
  return (
    <>
      {items.map((it) => (
        <section key={it.id} className="flex flex-col gap-2 rounded-xl border border-border/40 p-4" aria-labelledby={`schedule-${it.id}-heading`}>
          <h3 id={`schedule-${it.id}-heading`} className="text-sm font-medium">
            {it.title}
          </h3>
          <p className="text-sm text-muted-foreground">
            {it.blurb} Create a scheduled task in Claude or ChatGPT ({it.when}) and paste this as its prompt. Needs read and write access. Without an AI key of your own, this is how it gets filled.
          </p>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap select-all">{it.prompt}</pre>
          <div>
            <Button type="button" size="sm" variant="outline" onClick={() => copy(it.id, it.prompt)}>
              {copied === it.id ? "Copied" : `Copy ${it.id === "weekly" ? "weekly review" : "lesson link"} prompt`}
            </Button>
          </div>
        </section>
      ))}
    </>
  );
}
