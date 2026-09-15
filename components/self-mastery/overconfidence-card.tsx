import type { OverconfidenceVerdict } from "@/lib/self-mastery/overconfidence";

/**
 * Phase 2 #P2-08 — overconfidence / illusion-of-competence detector.
 * Three real states, never blended: not enough data yet (a legible
 * progress count toward the threshold, not a vague "check back later"),
 * calibrated (quietly reassuring, no alarm styling for a non-finding),
 * and overconfident (the one state that earns a warning color).
 */
export function OverconfidenceCard({ verdict }: { verdict: OverconfidenceVerdict }) {
  if (verdict.status === "insufficient_data") {
    return (
      <div data-testid="overconfidence-card" className="flex flex-col gap-1 rounded-xl border border-border/40 p-4">
        <span className="text-sm font-medium">Confidence calibration</span>
        <p className="text-xs text-muted-foreground">
          Not enough confidence-rated reviews yet ({verdict.sampleSize} of {verdict.minimumRequired}) to say anything true about your calibration.
        </p>
      </div>
    );
  }

  if (verdict.status === "overconfident") {
    return (
      <div data-testid="overconfidence-card" className="flex flex-col gap-1 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        <span className="text-sm font-medium text-destructive">Confidence calibration</span>
        <p className="text-xs text-muted-foreground">
          When you're sure of an answer, you're actually right {Math.round(verdict.sureActualCorrectRate * 100)}% of the time — worth
          double-checking answers you feel certain about before moving on.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="overconfidence-card" className="flex flex-col gap-1 rounded-xl border border-border/40 p-4">
      <span className="text-sm font-medium">Confidence calibration</span>
      <p className="text-xs text-muted-foreground">Your confidence tracks your actual recall well — no illusion-of-competence pattern detected.</p>
    </div>
  );
}
