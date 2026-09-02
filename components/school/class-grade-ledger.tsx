import { computeClassGrade } from "@/lib/school/grades/grade-ledger";
import type { ClassCardData } from "@/lib/school/get-class-cards";

export type GradeLedgerAssessment = ClassCardData["assessments"][number];

/**
 * The grade half of the expanded class view — a new mount alongside
 * `<ClassAssessments>`, not a replacement for it (that list is about
 * upcoming work; this one is about the number it adds up to).
 *
 * Pure presentational: `assessments` already carries weightPct/pointsEarned/
 * pointsPossible/isExcused straight from `getClassCards` (widened for this),
 * so this component only calls the already-tested `computeClassGrade` and
 * renders its result — no useEffect fetch, no loading state, consistent
 * with class-detail-dialog.tsx's B3 "instant load" contract.
 *
 * Production's real starting shape — four accounts, zero graded
 * assessments — is the FIRST branch below, not an afterthought: a class can
 * have assessments and still show nothing but "Not graded yet" for its
 * entire first week. That is rendered explicitly, never as a blank panel
 * and never as "0%": `computeClassGrade` returns `currentGrade: null` for
 * exactly this shape, and `null` is the signal this component renders off
 * — never assessments.length, which can't tell "nothing to grade" apart
 * from "nothing graded yet."
 */
export function ClassGradeLedger({ assessments }: { assessments: GradeLedgerAssessment[] }) {
  if (assessments.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Grade</h3>
        <p className="text-xs text-muted-foreground">No assessments yet — a grade appears once one exists.</p>
      </div>
    );
  }

  const result = computeClassGrade(assessments);
  const byAssessmentId = new Map(result.categoryResults.map((c) => [c.categoryId, c]));

  function statusFor(a: GradeLedgerAssessment): string {
    if (a.isExcused) return "Excused";
    if (a.weightPct == null) return "No weight set";
    if (a.pointsPossible == null) return "Not graded yet";
    const pct = byAssessmentId.get(a.id)?.categoryPct;
    // pct is only null here if this assessment's own item somehow failed to
    // resolve despite pointsPossible being present (e.g. pointsPossible <= 0)
    // — computeCourseGrade's own validation path, not a state this component
    // invents a number for.
    return pct == null ? "Ungradable — check points" : `${pct.toFixed(1)}%`;
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Grade</h3>

      {result.currentGrade == null ? (
        <p className="text-xs text-muted-foreground">No grade yet — nothing has been scored.</p>
      ) : (
        <p className="text-sm">
          <span className="font-medium">{result.currentGrade.toFixed(1)}%</span>
          <span className="text-muted-foreground"> current</span>
          {result.projectedGrade != null && Math.abs(result.projectedGrade - result.currentGrade) > 0.05 && (
            <span className="text-muted-foreground"> · {result.projectedGrade.toFixed(1)}% projected</span>
          )}
        </p>
      )}

      <div className="flex flex-col gap-1">
        {assessments.map((a) => (
          <div
            key={a.id}
            data-testid={`grade-row-${a.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-2 py-1.5"
          >
            <span className="truncate text-sm">{a.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{statusFor(a)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
