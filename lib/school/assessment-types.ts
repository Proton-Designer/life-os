// Deliberately has NO `import "server-only"` — this is the one piece of
// actions-core.ts's surface a Client Component is allowed to touch. Production
// build break, found live 2026-09-15 (Opus Lead, Vercel/Turbopack build, not
// tsc/vitest — neither can see a "server-only cannot be imported from a Client
// Component" violation): syllabus-review-panel.tsx ("use client") imported
// ASSESSMENT_TYPES as a runtime value straight from actions-core.ts, which
// carries `import "server-only"` at its top. A type-only import (`import type`)
// erases at compile time and was always safe (see class-assessments.tsx's own
// `import type { AssessmentType } from ".../class-actions"`); a RUNTIME value
// from a server-only module is not, and only a real Next build catches it.
//
// Split out here so client and server code share the exact same array rather
// than each defining its own — a second, independently-typed vocabulary is
// exactly the drift migration 151 (Phase 1 #12) already fixed once.

// Migration 151 (2026-09-13, Phase 1 item #12): widened beyond the original
// quiz/exam/midterm_final, AND converged onto tasks.task_type's own spelling
// for every concept the two vocabularies share. This type used to spell the
// exam/midterm concept "midterm_final" while tasks.task_type (B's 050)
// spelled the identical concept "final_midterm" -- "same concept,
// independently named in two different check constraints added by two
// different engineers the same night," per this file's own prior comment --
// and every assessment->task write had to translate between them (the
// ASSESSMENT_TYPE_TO_TASK_TYPE map this replaces). scripts/check-vocabulary-
// drift.sh could not have caught this: its pairwise heuristic only compares
// two value sets of the SAME size, and this pair was 3 values against 8 --
// a same-word-different-order collision between differently-sized sets is
// structurally below its floor. Converging the spelling removes the
// translation layer rather than adding a second one; see migration 151's
// own header for why the two sets deliberately still differ in SIZE
// (reminder/reading_review/other are never graded, so they stay out of this
// narrower vocabulary -- this is a subset reusing shared spelling, not the
// same vocabulary copied).
export const ASSESSMENT_TYPES = ["quiz", "exam", "final_midterm", "homework_assignment", "project_paper"] as const;

/** Derived from ASSESSMENT_TYPES so the list and the type can never drift apart. */
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

/**
 * SCHOOL-01 (migration 257): "Exam" absorbs "Final/Midterm" -- the name says which ("Midterm 1", "Final
 * exam"). 'final_midterm' stays in ASSESSMENT_TYPES/the DB CHECK on purpose (an old client, a Canvas or
 * syllabus extraction or an MCP write that still sends it must not fail), but every write core runs the
 * value through this, so nothing new is ever stored as 'final_midterm' and pickers never offer it.
 */
export function normalizeAssessmentType(type: AssessmentType): AssessmentType {
  return type === "final_midterm" ? "exam" : type;
}

/** What a type picker offers: ASSESSMENT_TYPES without the legacy 'final_midterm'. */
export const PICKABLE_ASSESSMENT_TYPES = ASSESSMENT_TYPES.filter((t) => t !== "final_midterm") as readonly Exclude<AssessmentType, "final_midterm">[];

export function isAssessmentType(value: unknown): value is AssessmentType {
  return typeof value === "string" && (ASSESSMENT_TYPES as readonly string[]).includes(value);
}

/** Pages that show an assessment (directly, or through its paired task) and must be revalidated after ANY write to one. */
export const ASSESSMENT_VIEW_PATHS = ["/school", "/", "/calendar", "/close"] as const;
