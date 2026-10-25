"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { retryBookIngestion } from "@/app/(app)/personal/self-mastery-actions";
import { isRetryableBookError } from "@/lib/self-mastery/ingestion/failure-messages";
import { Button } from "@/components/ui/button";

/**
 * "Try again" for a book that failed while it was being processed. Not offered when the failure is about the file
 * itself (scanned, password-protected, damaged, too long): running it again fails the same way, so the message already
 * on the card says what to change instead. The server refuses the same cases; this only keeps the button honest.
 */
export function RetryBookButton({ bookId, title, errorMessage }: { bookId: string; title: string; errorMessage: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isRetryableBookError(errorMessage)) return null;

  function retry() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await retryBookIngestion(bookId);
        if (result.ok) router.refresh();
        else setError(result.message);
      } catch {
        setError("Couldn't restart this book. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size="sm" onClick={retry} disabled={pending} aria-label={`Try again: ${title}`} data-testid="retry-book" data-book-id={bookId}>
        <RotateCw className="size-3.5" aria-hidden />
        {pending ? "Restarting…" : "Try again"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
