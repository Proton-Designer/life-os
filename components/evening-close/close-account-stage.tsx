import type { CloseBlocker } from "@/lib/evening-close/evening-close";
import type { ReviewItem } from "@/lib/distractions/types";
import { CloseBlockerRewrite } from "./close-blocker-rewrite";

/**
 * Stage (a) of the evening close: account.
 *
 * A SERVER COMPONENT ON PURPOSE. It has no state and no handlers, so making it
 * a client component would only widen the bundle and open a boundary that
 * doesn't need to exist. The one interactive affordance is a same-page `#anchor`
 * jump (GAP-02), which is a URL — not a callback passed across the boundary.
 * AGENTS.md's rule bit this project twice: a function prop from a Server
 * Component survives `tsc` and `vitest` and fails only in the browser.
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

      {/* Absent, not disabled, while blocked — see the note above.
          GAP-02 (ENG3's DAYCLOSE-DFT2 pass): this used to link to
          `/close?stage=reflect`, but EveningClosePage takes no
          searchParams at all — that query string could never affect
          anything, and Reflect/Plan already render together with Account
          the moment this becomes unblocked, so it was a permanent no-op
          that read as a broken multi-stage wizard. Retargeted as an
          honest same-page jump to Reflect's own heading (already has
          `id="close-reflect-heading"`, close-reflect-stage.tsx) — same
          "guide the eye downward" intent, but a real one. Plain `<a>`,
          not next/link's `Link`, matching this app's other same-page
          #anchor jumps (e.g. Settings' sticky section nav). */}
      {blocked ? null : (
        <a
          href="#close-reflect-heading"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Continue
        </a>
      )}
    </section>
  );
}
