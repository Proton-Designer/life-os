import { Suspense } from "react";
import { InlineErrorBoundary } from "@/components/shell/inline-error-boundary";

/**
 * Streams one slow Home module (NAV-01b). `promise` is started at the top of the page (so all the
 * slow reads run in parallel from the first moment) but NOT awaited there: the page shell and the
 * fast modules render and flush first, and this block fills in when its data resolves, in place of
 * `fallback` (a card-shaped skeleton, or null for a module that is often absent so nothing flashes).
 * A rejection is caught by an InlineErrorBoundary around the module (NAV-01c): ONE small "<label>
 * didn't load" card with Try again, not the whole page falling to app/(app)/error.tsx.
 * Server Component to Server Component only: `children` is a render callback and never crosses to a
 * Client Component.
 */
export function Stream<T>({
  promise,
  fallback,
  label = "This section",
  children,
}: {
  promise: Promise<T>;
  fallback: React.ReactNode;
  /** Names the module in its inline error card ("<label> didn't load"). A plain string. */
  label?: string;
  children: (value: T) => React.ReactNode;
}) {
  return (
    <InlineErrorBoundary label={label}>
      <Suspense fallback={fallback}>
        <Resolved promise={promise}>{children}</Resolved>
      </Suspense>
    </InlineErrorBoundary>
  );
}

async function Resolved<T>({ promise, children }: { promise: Promise<T>; children: (value: T) => React.ReactNode }) {
  return <>{children(await promise)}</>;
}
