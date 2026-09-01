// 'learn' is ULM's daily FSRS retrieval session (077_ulm_work_sessions_widen_kind.sql).
// It does NOT count toward focus hours (work_sessions.counts_toward_hours is a
// generated column, deep_work/deep_study/exam_prep only) and does not render on the
// day ribbon (lib/home/get-day-shape.ts filters on counts_toward_hours) — both
// deliberate, not gaps to close by widening this type further.
export type WorkSessionKind = "deep_work" | "deep_study" | "learn";

export const KIND_LABEL: Record<WorkSessionKind, string> = {
  deep_work: "Deep Work",
  deep_study: "Deep Study",
  learn: "Review",
};
