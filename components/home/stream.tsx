import { Suspense } from "react";

/**
 * Streams one slow Home module (NAV-01b). `promise` is started at the top of the page (so all the
 * slow reads run in parallel from the first moment) but NOT awaited there: the page shell and the
 * fast modules render and flush first, and this block fills in when its data resolves, in place of
 * `fallback` (a card-shaped skeleton, or null for a module that is often absent so nothing flashes).
 * A rejection still reaches the route's error boundary, exactly as a failed top-level await did.
 * Server Component to Server Component only: `children` is a render callback and never crosses to a
 * Client Component.
 */
export function Stream<T>({ promise, fallback, children }: { promise: Promise<T>; fallback: React.ReactNode; children: (value: T) => React.ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Resolved promise={promise}>{children}</Resolved>
    </Suspense>
  );
}

async function Resolved<T>({ promise, children }: { promise: Promise<T>; children: (value: T) => React.ReactNode }) {
  return <>{children(await promise)}</>;
}
