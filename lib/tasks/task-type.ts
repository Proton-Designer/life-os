import type { TaskType } from "./actions-core";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  assignment: "Assignment",
  project: "Project",
  test: "Test",
  quiz: "Quiz",
  reading: "Reading",
  other: "Other",
};

export const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = (
  Object.keys(TASK_TYPE_LABEL) as TaskType[]
).map((value) => ({ value, label: TASK_TYPE_LABEL[value] }));
