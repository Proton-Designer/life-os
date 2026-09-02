export interface GradeCategory {
  id: string;
  name: string;
  /** Share of the course grade, as a percentage (e.g. 20 for 20%). */
  weightPct: number;
  dropLowestN: number;
  /** Total items expected in the category once the course finishes. */
  expectedItemCount: number;
}

export interface GradeItem {
  id: string;
  categoryId: string;
  name: string;
  pointsEarned: number | null;
  pointsPossible: number;
  isExcused: boolean;
}

export type GradeIssueKind =
  | "invalidPointsPossible"
  | "negativePoints"
  | "earnedExceedsPossible"
  | "weightSumWarning"
  | "missingTargetAssumption";

export interface GradeIssue {
  kind: GradeIssueKind;
  itemId?: string;
  categoryId?: string;
  message: string;
}

export interface CategoryResult {
  categoryId: string;
  weightPct: number;
  /** null when the category is unresolved (no graded items survive). */
  categoryPct: number | null;
  resolved: boolean;
  /** true when dropLowestN already dropped an item but the category isn't complete yet. */
  provisional: boolean;
  droppedItemIds: string[];
  gradedItemCount: number;
}

export type GradeAssumption = "current" | "target" | number;

export interface CourseGradeResult {
  /** Performance so far. null if nothing is graded — never report 0%. */
  currentGrade: number | null;
  projectedGrade: number | null;
  assumptionUsed: GradeAssumption;
  categoryResults: CategoryResult[];
  issues: GradeIssue[];
  /** Sum of all category weightPct — flagged, never silently normalized. */
  weightSum: number;
}
