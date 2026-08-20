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
  /**
   * When this item is a WINDOW (currently only prayers — dueAt is the
   * window's start, not a hard deadline), the moment that window closes.
   * Null for anything else. Lets a display like next-actions.tsx tell "2h
   * until this opens" (now < dueAt) apart from "2h left before this
   * closes" (dueAt has passed but the window is still open) — without it,
   * an open prayer window reads as "2h overdue," which is backwards: the
   * prayer isn't late, it just has 2 hours left to pray it.
   */
  windowEndAt: Date | null;
  /** YYYY-MM-DD this item was computed for (user's local day, per spec's midnight-local boundary) */
  date: string;
  urgencyBucket: UrgencyBucket;
  completed: boolean;
  actionType: ActionType;
  actionRefId: string;
};
