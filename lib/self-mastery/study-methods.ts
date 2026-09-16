// P3-03: canonical, single-source-of-truth taxonomy for the study
// techniques this app actually applies to a self-mastery session. Four of
// the six were already real, working mechanisms scattered across the
// codebase with no shared name a user could see (docs/audits/
// 2026-09-10-school-manager-feature-audit.md line 68's own honest gap
// callout is the reason this task exists at all). The other two are named
// here, not built here: "compose" has no implementation anywhere in this
// app; "cards" is reserved for P3-05 (Goal/Motivation/Thought-Habit/Trait
// reflection cards, flagged off) so it has a stable id to build against.
//
// Every label here is the ONLY vocabulary the UI is allowed to use for
// these ideas (Opus Lead ruling) — a chip, a settings row, or any future
// surface must read `label` from this file, never invent its own wording.

export type StudyMethodId = "retrieval" | "interleave" | "draft" | "recite" | "compose" | "cards";

export interface StudyMethodDef {
  id: StudyMethodId;
  label: string;
  description: string;
  status: "active" | "planned";
  /** file:function citation for an active method's real implementation. Absent for a planned one — there is nothing to point at yet. */
  implementedAt?: string;
}

export const STUDY_METHODS: readonly StudyMethodDef[] = [
  {
    id: "retrieval",
    label: "Retrieval",
    description: "Answering a due or new card from memory before seeing the answer.",
    status: "active",
    implementedAt: "lib/self-mastery/session/build-session.ts:buildTodaysSession",
  },
  {
    id: "interleave",
    label: "Interleave",
    description: "Mixing cards and questions across different books, courses, and sources instead of blocking by one.",
    status: "active",
    implementedAt: "components/self-mastery/session/build-card-sequence.ts:buildInterleavedSequence",
  },
  {
    id: "draft",
    label: "Draft",
    description: "Writing your own explanation of a lesson in the self-explanation interstitial.",
    status: "active",
    implementedAt: "lib/self-mastery/session/build-session.ts:submitSelfExplanation",
  },
  {
    id: "recite",
    label: "Recite",
    description: "Teaching a lesson back in your own words and getting gap feedback.",
    status: "active",
    implementedAt: "lib/self-mastery/teach-back.ts:evaluateTeachBack",
  },
  {
    id: "compose",
    label: "Compose",
    description: "Writing a longer synthesis across multiple lessons.",
    status: "planned",
  },
  {
    id: "cards",
    label: "Cards",
    description: "Goal, Motivation, Thought-Habit, and Trait reflection card rotation (P3-05).",
    status: "planned",
  },
] as const;

const STUDY_METHOD_LABELS: Readonly<Record<string, string>> = Object.fromEntries(STUDY_METHODS.map((m) => [m.id, m.label]));

/** Falls back to the raw id for anything not in the taxonomy — never throws on stale/unknown data. */
export function studyMethodLabel(id: string): string {
  return STUDY_METHOD_LABELS[id] ?? id;
}
