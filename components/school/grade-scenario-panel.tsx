"use client";

import { useMemo, useState } from "react";
import { buildCategoriesAndItems, type GradeCategoryDefinition, type AssessmentGradeRow } from "@/lib/school/grades/grade-ledger";
import { computeCourseGrade } from "@/lib/school/grades/courseGrade";
import { computeScenario } from "@/lib/school/grades/scenario";
import { solveRequiredScore } from "@/lib/school/grades/requiredScore";
import { Input } from "@/components/ui/input";

/**
 * Phase 1 #13 — the grade scenario "what-if" planner, wired into the Grade
 * Ledger. `computeScenario` (lib/school/grades/scenario.ts) was fully
 * built, tested, and had zero production callers before this (verified by
 * grep — only its own test file imported it). `solveRequiredScore` was in
 * the same state until `required-score-verdict.ts` wired it (see that
 * file's own header for why it doesn't use `solveRequiredScore` directly —
 * this panel is the first caller that does).
 *
 * Deliberately reuses `buildCategoriesAndItems` (grade-ledger.ts) rather
 * than re-deriving the assessment→category mapping: two implementations of
 * "which category does this row belong to" is the exact class of drift the
 * app's own conventions exist to prevent (see that function's own header).
 *
 * A "category" here is real (`grade_categories`, Phase 1 #11) OR synthetic
 * (one per un-graded, weighted assessment when the class has none) — the
 * same uniform treatment `ClassGradeLedger` already gives them, so this
 * panel works identically for a class that has never created a category.
 */
export function GradeScenarioPanel({
  assessments,
  categories,
  targetGradePct,
}: {
  assessments: AssessmentGradeRow[];
  categories: GradeCategoryDefinition[];
  targetGradePct: number | null;
}) {
  const [hypotheticals, setHypotheticals] = useState<Record<string, string>>({});

  const { categories: engineCategories, items } = useMemo(
    () => buildCategoriesAndItems(assessments, categories),
    [assessments, categories]
  );

  // Categories with real, human-readable names for the input rows — a synthetic
  // per-assessment category's `name` is the assessment row's own id (see
  // buildCategoriesAndItems), unreadable as a label, so this looks the actual
  // assessment name up instead. A real grade_categories row's name is already
  // the right label.
  const assessmentNameById = useMemo(() => new Map(assessments.map((a) => [a.id, a])), [assessments]);
  function labelFor(categoryId: string, fallbackName: string): string {
    const asAssessment = assessmentNameById.get(categoryId);
    return asAssessment ? `${fallbackName} (single assessment)` : fallbackName;
  }

  const baseline = computeCourseGrade(engineCategories, items);
  const unresolved = baseline.categoryResults.filter((c) => !c.resolved);

  if (unresolved.length === 0) {
    // Nothing left to hypothesize about — either nothing is gradable yet (zero
    // categories) or everything already has a real score. Same "no fabricated
    // number" posture as ClassGradeLedger's own empty states.
    return null;
  }

  const activeHypotheticals = unresolved
    .map((c) => {
      const raw = hypotheticals[c.categoryId];
      const pct = raw === undefined || raw.trim() === "" ? null : Number(raw);
      return pct !== null && Number.isFinite(pct) ? { categoryId: c.categoryId, assumedPct: pct } : null;
    })
    .filter((h): h is { categoryId: string; assumedPct: number } => h !== null);

  const scenario = activeHypotheticals.length > 0 ? computeScenario(engineCategories, items, activeHypotheticals) : null;

  let verdictText: string | null = null;
  if (scenario && targetGradePct != null) {
    const solved = solveRequiredScore(scenario, targetGradePct);
    if (solved.verdict === "final") {
      verdictText = solved.metTarget
        ? `Final grade would be ${solved.finalGrade!.toFixed(1)}% — target met.`
        : `Final grade would be ${solved.finalGrade!.toFixed(1)}% — target missed.`;
    } else if (solved.verdict === "impossible") {
      verdictText = `Not reachable even at 100% on what's left — caps out at ${solved.maxAchievableGrade!.toFixed(1)}%.`;
    } else if (solved.verdict === "secured") {
      verdictText = `Already secured at ${targetGradePct}% no matter what's left.`;
    } else {
      // onTrack — one line per still-unhypothesized category, since they can carry
      // different weights and "the rest" isn't one number worth collapsing to.
      const lines = solved.perRemainingCategory.map((r) => {
        const cat = engineCategories.find((c) => c.id === r.categoryId);
        const name = cat ? labelFor(cat.id, cat.name) : r.categoryId;
        return `${name}: ${r.requiredPct.toFixed(1)}%`;
      });
      verdictText = `Need — ${lines.join(", ")}.`;
    }
  } else if (scenario) {
    verdictText =
      scenario.currentGrade != null ? `Scenario grade so far: ${scenario.currentGrade.toFixed(1)}%.` : null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
      <h3 className="text-sm font-medium">What-if</h3>
      <div className="flex flex-col gap-1.5">
        {unresolved.map((c) => {
          const cat = engineCategories.find((e) => e.id === c.categoryId)!;
          return (
            <div key={c.categoryId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {labelFor(cat.id, cat.name)} ({cat.weightPct}%)
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                value={hypotheticals[c.categoryId] ?? ""}
                onChange={(e) => setHypotheticals((prev) => ({ ...prev, [c.categoryId]: e.target.value }))}
                placeholder="If I get %"
                aria-label={`Hypothetical score for ${labelFor(cat.id, cat.name)}`}
                className="h-8 w-24 text-xs"
              />
            </div>
          );
        })}
      </div>
      {targetGradePct == null && (
        <p className="text-xs text-muted-foreground">Set a target grade to see whether a scenario meets it.</p>
      )}
      {verdictText && <p className="text-xs text-muted-foreground">{verdictText}</p>}
    </div>
  );
}
