import Link from "next/link";

/**
 * The honest empty state for an AI-written panel when nothing has been written AND the account has no AI key: a scheduled agent
 * (Claude / ChatGPT through the connector) can fill it, or the person can add their own key for instant results. Not an error.
 */
export function ConnectAgentHint({ what }: { what: string }) {
  return (
    <p data-testid="connect-agent-hint" className="text-sm text-muted-foreground">
      No {what} yet.{" "}
      <Link href="/settings#connectors" className="underline">
        Connect an agent
      </Link>{" "}
      to write it on a schedule, or{" "}
      <Link href="/settings#ai" className="underline">
        add a key
      </Link>{" "}
      for instant results.
    </p>
  );
}
