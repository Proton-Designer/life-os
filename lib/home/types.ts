export type Domain = "deen" | "business" | "fitness" | "school" | "co_op";

/**
 * Domain, widened for components meant to be reused across arbitrary
 * user-created Work subdomains (D-037/D-010: GoalCard and TaskRowList,
 * specifically — components explicitly designed to accept "some domain"
 * without knowing its full set ahead of time). `Domain` itself deliberately
 * stays closed: Home's priority-item system (PriorityItem/CompletedItem
 * below), get-priority-items.ts, next-actions.ts, and get-notifications.ts
 * only ever handle the 5 real, DB-frozen domain values (D-005 — never
 * renamed, never widened) and keeping `Domain` exhaustive there is a real
 * safety property, not incidental strictness: it's what makes TypeScript
 * flag a forgotten branch if a 6th real domain value is ever added to those
 * tables. Widening `Domain` itself instead of introducing this second type
 * would have silently defeated that guarantee everywhere, for a need that
 * only actually exists in two components.
 *
 * `(string & {})` rather than plain `string` — same value at the type level
 * (both accept an arbitrary string), but this form keeps the 5 literal
 * members as autocomplete suggestions in editors instead of widening them
 * away to a bare `string` the moment they're unioned with one.
 *
 * The trap this exists to close: a plain `Record<Domain, X>` lookup keyed
 * by a `DisplayDomain` value type-checks fine even after this widening
 * (TypeScript can't tell a `(string & {})` apart from a literal at the call
 * site) but returns `undefined` at runtime for anything outside the
 * original 5 — silent, not a compile error. See lib/domain-icons.ts and
 * lib/accent-tokens.ts's `getDomainIcon`/`getDomainAccent`, which exist
 * specifically so no caller does that lookup directly.
 */
export type DisplayDomain = Domain | (string & {});

/**
 * Widened to three states (A2 wiring, R18(4)): a candidate with no real
 * due-time signal is "absent," never defaulted to "later_today" -- "a
 * defaulting ranker input is the null-is-zero bug wearing a string" (Boss
 * ruling). Same name kept so every existing `UrgencyBucket` import stays
 * valid; only the underlying value set widened. See lib/home/urgency.ts's
 * classifyUrgency, the sole classifier now that the old two-state
 * urgencyBucket function is retired.
 */
export type UrgencyBucket = "right_now" | "later_today" | "absent";

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
  /**
   * Estimated minutes to complete -- the arbiter's "cost" signal (R18(5)/
   * R19). LIVE FOR EXACTLY ONE OF FIVE DOMAINS TODAY: a scheduled Fitness
   * session's own `durationMinutes` (already computed internally in
   * get-priority-items.ts's fitness section, just not surfaced before
   * this). `null` on Deen/Business/School/co_op is not a gap to close by
   * inventing an estimate -- R18(5) is explicit that a domain with no real
   * cost source stays absent, permanently, not approximated. Null also on
   * a micro-goal-only fitness row itself -- no fixed duration exists for
   * an open-ended set of exercise targets either, per R18(5)'s explicit
   * "tasks get no invented effort."
   */
  cost: number | null;
};
