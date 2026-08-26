export type Domain = "deen" | "business" | "fitness" | "school" | "co_op";

export type UrgencyBucket = "right_now" | "later_today";

export type ActionType =
  | "toggle_prayer"
  | "toggle_kill_list"
  | "toggle_task"
  | "toggle_habit"
  | "toggle_adhkar"
  /** Navigates to /fitness — never toggles. See toggleItem, which throws rather than no-ops for this type. */
  | "open_fitness";

/**
 * An item completed TODAY (local day), for the Completed section beneath
 * Home's Now module — 2026-08-25 tap-to-complete redesign. Not a
 * PriorityItem: those are strictly the pending/actionable set, and mixing
 * "still due" and "already done" into one shape/list invited exactly the
 * kind of bug where a completed row silently reappears as pending.
 */
export type CompletedItem = {
  id: string;
  domain: Domain;
  title: string;
  actionType: ActionType;
  actionRefId: string;
  /** Real completion instant where the source records one (tasks.completed_at, prayers.logged_at, kill_list_items.completed_at) — every current source does. */
  completedAtIso: string;
};

export type PriorityItem = {
  id: string;
  domain: Domain;
  title: string;
  /**
   * Populated only for `actionType: "toggle_prayer"` items — the rawatib
   * slots ("before"/"after"/"witr", per lib/deen/sunnah.ts) already logged
   * for this prayer today. Lets Home's Now module render the same sunnah
   * disclosure Deen's own PrayerRow does (2026-08-25/26). Undefined for
   * every other actionType.
   */
  sunnahCompletions?: ("before" | "after" | "witr")[];
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
