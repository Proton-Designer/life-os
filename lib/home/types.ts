export type Domain = "deen" | "business" | "fitness" | "school" | "co_op";

export type UrgencyBucket = "right_now" | "later_today";

export type ActionType =
  | "toggle_prayer"
  | "toggle_kill_list"
  | "toggle_task"
  | "toggle_habit"
  | "toggle_adhkar";

export type PriorityItem = {
  id: string;
  domain: Domain;
  title: string;
  dueAt: Date | null;
  urgencyBucket: UrgencyBucket;
  completed: boolean;
  actionType: ActionType;
  actionRefId: string;
};
