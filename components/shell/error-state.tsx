"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * NAV-01c: the calm "this didn't load" card shared by app/(app)/error.tsx (whole page) and
 * InlineErrorBoundary (one module). It never shows the message or a stack: those can carry
 * internals. The error goes to the console (and Next's digest, a short opaque id, is shown as a
 * reference so a report can be matched to the server log).
 */
export function ErrorState({
  error,
  retry,
  title = "Something went wrong",
  body = "This didn't load. Your data is safe. Try again, or head back Home.",
  showHomeLink = true,
  className,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  body?: string;
  showHomeLink?: boolean;
  className?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" data-testid="error-state" className={cn("flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4", className)}>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
        {error.digest ? <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => retry()}>
          Try again
        </Button>
        {showHomeLink ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/">Go to Home</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
