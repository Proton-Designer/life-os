"use client";

import { ErrorState } from "@/components/shell/error-state";

// NAV-01c: a page (or a streamed module that has no inline boundary) failed after the shell was
// already on screen. `retry` (Next 16.3: re-fetches and re-renders the segment; `reset` would only
// clear the boundary and re-render the same failed payload) is the right "Try again".
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-10">
      <ErrorState error={error} retry={retry} />
    </div>
  );
}
