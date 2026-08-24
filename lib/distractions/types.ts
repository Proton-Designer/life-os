export type DistractionDomain = "deen" | "business" | "school" | "fitness" | "co_op";

export type ActionPlan = {
  id: string;
  body: string;
  version: number;
  createdAtIso: string;
  /** Outcomes recorded against THIS plan version only. */
  followedCount: number;
  skippedCount: number;
  /** skippedCount >= 3 && followedCount === 0 — the review must force a rewrite. */
  mustRewrite: boolean;
};

export type TriggerSummary = {
  id: string;
  domain: DistractionDomain;
  name: string;
  description: string | null;
  /** All-time event count — this is the capture list's sort key. */
  totalCount: number;
  todayCount: number;
  lastOccurredAtIso: string | null;
  createdDate: string; // local YYYY-MM-DD
  currentPlan: ActionPlan | null;
};

export type ReviewItem = {
  trigger: TriggerSummary;
  todayCount: number;
  /** No current plan → the review demands one, with no follow/skip question. */
  isNew: boolean;
};
