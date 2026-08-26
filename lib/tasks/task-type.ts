export type TaskType =
  | "homework_assignment"
  | "quiz"
  | "exam"
  | "final_midterm"
  | "project_paper"
  | "reminder"
  | "other";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  homework_assignment: "Homework/Assignment",
  quiz: "Quiz",
  exam: "Exam",
  final_midterm: "Final/Midterm",
  project_paper: "Project/Paper",
  reminder: "Reminder",
  other: "Other",
};

export const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = (
  Object.keys(TASK_TYPE_LABEL) as TaskType[]
).map((value) => ({ value, label: TASK_TYPE_LABEL[value] }));

/**
 * "Due Date" for handed-in work with a deadline, "Date" for everything that
 * just happens on a date — Ayman's own two contrasting examples (Homework/
 * Assignment and Project/Paper vs quizzes and exams), extended to the rest
 * of the taxonomy on the same logic.
 */
export function dateFieldLabel(type: TaskType): string {
  return type === "homework_assignment" || type === "project_paper" ? "Due Date" : "Date";
}

/**
 * R6 (Opus Lead ruling, 2026-08-26 night batch 2) — ONE shared color map:
 * item 5's Task list and item 6c's per-class task list both need "each
 * task type should be a different text color," and this is the single
 * definition both read from. Text color only, applied alongside the type's
 * own label text (never hue as the sole differentiator, so this still
 * reads correctly for colorblind users). Reuses this app's existing accent
 * design tokens rather than inventing new hex values — same tokens already
 * used for domain identity elsewhere (IconChip, KpiCard, StatCard).
 */
export const TASK_TYPE_COLOR: Record<TaskType, string> = {
  homework_assignment: "text-accent-school",
  quiz: "text-accent-warning",
  exam: "text-destructive",
  final_midterm: "text-accent-coop",
  project_paper: "text-accent-business",
  reminder: "text-accent-fitness",
  other: "text-muted-foreground",
};
