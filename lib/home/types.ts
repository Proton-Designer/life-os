export type Domain = "deen" | "business" | "fitness" | "school" | "co_op";

export type UrgencyBucket = "right_now" | "later_today";

export type ActionType =
  | "toggle_prayer"
  | "toggle_kill_list"
  | "toggle_task"
  | "toggle_habit"
  | "toggle_adhkar"
  | "toggle_workout";

export type PriorityItem = {
  id: string;
  domain: Domain;
  title: string;
  dueAt: Date | null;
  /** YYYY-MM-DD this item was computed for (user's local day, per spec's midnight-local boundary) */
  date: string;
  urgencyBucket: UrgencyBucket;
  completed: boolean;
  actionType: ActionType;
  actionRefId: string;
};
