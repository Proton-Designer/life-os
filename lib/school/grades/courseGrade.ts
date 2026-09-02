import type {
  CategoryResult,
  CourseGradeResult,
  GradeAssumption,
  GradeCategory,
  GradeIssue,
  GradeItem,
} from "./types";

function resolveCategory(
  category: GradeCategory,
  items: GradeItem[],
): { result: CategoryResult; issues: GradeIssue[] } {
  const issues: GradeIssue[] = [];
  const categoryItems = items.filter((i) => i.categoryId === category.id);

  const gradable: Array<{ id: string; pointsEarned: number; pointsPossible: number; pct: number }> = [];
  for (const item of categoryItems) {
    if (item.pointsPossible <= 0) {
      issues.push({
        kind: "invalidPointsPossible",
        itemId: item.id,
        categoryId: category.id,
        message: `${item.id}: pointsPossible must be > 0`,
      });
      continue;
    }
    if (item.pointsEarned != null && item.pointsEarned < 0) {
      issues.push({
        kind: "negativePoints",
        itemId: item.id,
        categoryId: category.id,
        message: `${item.id}: negative pointsEarned`,
      });
    }
    if (item.pointsEarned != null && item.pointsEarned > item.pointsPossible) {
      // Extra credit is legitimate — allow it in the calculation, just surface it.
      issues.push({
        kind: "earnedExceedsPossible",
        itemId: item.id,
        categoryId: category.id,
        message: `${item.id}: pointsEarned exceeds pointsPossible (extra credit)`,
      });
    }
    if (item.pointsEarned == null || item.isExcused) continue;
    gradable.push({
      id: item.id,
      pointsEarned: item.pointsEarned,
      pointsPossible: item.pointsPossible,
      pct: item.pointsEarned / item.pointsPossible,
    });
  }

  const sorted = [...gradable].sort((a, b) => a.pct - b.pct);
  const dropCount = Math.min(Math.max(category.dropLowestN, 0), sorted.length);
  const dropped = sorted.slice(0, dropCount);
  const survivors = sorted.slice(dropCount);
  const droppedItemIds = dropped.map((i) => i.id);

  if (survivors.length === 0) {
    return {
      result: {
        categoryId: category.id,
        weightPct: category.weightPct,
        categoryPct: null,
        resolved: false,
        provisional: false,
        droppedItemIds,
        gradedItemCount: gradable.length,
      },
      issues,
    };
  }

  const earned = survivors.reduce((s, i) => s + i.pointsEarned, 0);
  const possible = survivors.reduce((s, i) => s + i.pointsPossible, 0);
  const categoryPct = (earned / possible) * 100;

  // Dropping the currently-lowest score before the category is complete is provisional:
  // that item may not remain the lowest once the rest of the category is graded.
  const provisional = category.dropLowestN > 0 && dropCount > 0 && gradable.length < category.expectedItemCount;

  return {
    result: {
      categoryId: category.id,
      weightPct: category.weightPct,
      categoryPct,
      resolved: true,
      provisional,
      droppedItemIds,
      gradedItemCount: gradable.length,
    },
    issues,
  };
}

export interface ComputeCourseGradeOptions {
  assumption?: GradeAssumption;
  targetPct?: number;
  /** Scenario-mode overrides: category -> assumed resolved percentage. */
  overrides?: Map<string, number>;
}

export function computeCourseGrade(
  categories: GradeCategory[],
  items: GradeItem[],
  options: ComputeCourseGradeOptions = {},
): CourseGradeResult {
  const issues: GradeIssue[] = [];
  const categoryResults: CategoryResult[] = [];

  for (const category of categories) {
    const { result, issues: catIssues } = resolveCategory(category, items);
    issues.push(...catIssues);
    const override = options.overrides?.get(category.id);
    categoryResults.push(
      override != null
        ? { ...result, categoryPct: override, resolved: true, provisional: false }
        : result,
    );
  }

  const weightSum = categories.reduce((s, c) => s + c.weightPct, 0);
  if (Math.round(weightSum * 1e6) / 1e6 !== 100) {
    issues.push({ kind: "weightSumWarning", message: `Category weights sum to ${weightSum}, not 100` });
  }

  const resolved = categoryResults.filter((c) => c.resolved);
  const resolvedWeight = resolved.reduce((s, c) => s + c.weightPct, 0);
  const currentGrade =
    resolved.length === 0
      ? null
      : resolved.reduce((s, c) => s + (c.categoryPct as number) * c.weightPct, 0) / resolvedWeight;

  const remaining = categoryResults.filter((c) => !c.resolved);
  const remainingWeight = remaining.reduce((s, c) => s + c.weightPct, 0);

  const assumption: GradeAssumption = options.assumption ?? "current";
  let assumptionPct: number | null;
  if (assumption === "current") {
    assumptionPct = currentGrade;
  } else if (assumption === "target") {
    assumptionPct = options.targetPct ?? null;
    if (assumptionPct == null) {
      issues.push({
        kind: "missingTargetAssumption",
        message: 'assumption "target" requested with no targetPct provided',
      });
    }
  } else {
    assumptionPct = assumption;
  }

  const earnedPoints =
    resolved.reduce((s, c) => s + (c.categoryPct as number) * c.weightPct, 0) / 100;
  const projectedGrade =
    assumptionPct == null ? null : earnedPoints + (assumptionPct * remainingWeight) / 100;

  return {
    currentGrade,
    projectedGrade,
    assumptionUsed: assumption,
    categoryResults,
    issues,
    weightSum,
  };
}
