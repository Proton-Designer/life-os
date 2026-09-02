import type { CloseBlocker } from "@/lib/evening-close/evening-close";
import type { ReviewItem } from "@/lib/distractions/types";
import { CloseBlockerRewrite } from "./close-blocker-rewrite";
import Link from "next/link";

/**
 * Stage (a) of the evening close: account.
 *
 * A SERVER COMPONENT ON PURPOSE. It has no state and no handlers, so making it
 * a client component would only widen the bundle and open a boundary that
 * doesn't need to exist. The one interactive affordance is a `Link`, which is
 * a URL — not a callback passed across the boundary. AGENTS.md's rule bit this
 * project twice: a function prop from a Server Component survives `tsc` and
 * `vitest` and fails only in the browser.
 *
 * WHAT THIS SCREEN REFUSES. BOSS-VISION §6: the three-strikes forced rewrite
 * "blocks re-confirming a plan that has never worked… If the close makes that
 * optional the feature is gone though the screen remains." So the continue
 * affordance is ABSENT while a blocker stands, rather than present-and-
 * disabled. A disabled button still says "there is a way past this"; nothing
 * says there isn't.
 */
export function CloseAccountStage({
  blockers,
  blockingItems,
  unplannedTodayCount,
}: {
  blockers: CloseBlocker[];
  blockingItems: ReviewItem[];
  unplannedTodayCount: number;
}) {
  const blocked = blockers.length > 0;

  return (
    <section aria-labelledby="close-account-heading" className="space-y-4">
      <h2 id="close-account-heading" className="text-sm font-medium text-muted-foreground">
        Account
      </h2>

      {blocked ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium">
            {blockers.length === 1
              ? "One plan hasn't worked yet. Rewrite it before closing."
              : `${blockers.length} plans haven't worked yet. Rewrite them before closing.`}
          </p>
          <p className="text-xs text-muted-foreground">
            Skipped three times without once being followed. Re-confirming it would just book the same
            night again.
          </p>
          {/* The rewrite happens HERE. These used to be links to /review; once
              /review redirects to /close that link is a loop with no rewrite
              surface behind it, and the close becomes permanently
              uncompletable. Absorbing the UI is what makes the redirect safe. */}
          <CloseBlockerRewrite items={blockingItems} />
        </div>
      ) : (
        <div className="rounded-lg border p-4">
          <p className="text-sm">Nothing is blocking tonight&apos;s close.</p>
          {unplannedTodayCount > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {unplannedTodayCount} distraction{unplannedTodayCount === 1 ? "" : "s"} captured today without a
              plan — worth a look, but not required.
            </p>
          ) : null}
        </div>
      )}

      {/* Absent, not disabled, while blocked — see the note above. */}
      {blocked ? null : (
        <Link
          href="/close?stage=reflect"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Continue
        </Link>
      )}
    </section>
  );
}
