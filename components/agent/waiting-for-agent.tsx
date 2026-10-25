import { Button } from "@/components/ui/button";
import { formatClock12 } from "@/lib/date-utils";

/**
 * The card for a request that was queued for the person's agent (no AI key in the app). Presentational: states are
 * waiting (queued, no agent has picked it up), working (an agent has claimed it), and failed (the agent gave up, or it expired).
 * Times are 12-hour. Not an error state: waiting is the normal path for someone who relies on a connected agent.
 */
export function WaitingForAgent({
  what,
  state,
  createdAt,
  timezone,
  error,
  onCancel,
  onDismiss,
}: {
  what: string;
  state: "waiting" | "working" | "failed";
  createdAt: string;
  timezone: string;
  error?: string | null;
  onCancel?: () => void;
  onDismiss?: () => void;
}) {
  const queuedAt = formatClock12(new Date(createdAt), timezone);
  return (
    <div data-testid="waiting-for-agent" data-state={state} className="flex flex-col gap-1 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs">
      {state === "waiting" ? (
        <>
          <p className="font-medium">Waiting for your agent</p>
          <p className="text-muted-foreground">
            {what} was queued at {queuedAt}. Your connected agent picks it up on its next run. Add an AI key in Settings for instant results.
          </p>
        </>
      ) : state === "working" ? (
        <>
          <p className="font-medium">Your agent is working on this</p>
          <p className="text-muted-foreground">{what}, queued at {queuedAt}. It will appear here when it is done.</p>
        </>
      ) : (
        <>
          <p className="font-medium">Your agent couldn&apos;t finish this</p>
          <p className="text-muted-foreground">
            {what}, queued at {queuedAt}. {error ?? ""} Try again, or add an AI key in Settings.
          </p>
        </>
      )}
      <div className="flex gap-2 pt-1">
        {state !== "failed" && onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {state === "failed" && onDismiss ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : null}
      </div>
    </div>
  );
}
