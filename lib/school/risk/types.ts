// Shared value shapes for the risk engine ported from CollegeOS
// (packages/core/src/risk) — College-app@8d77e73 and DOMAIN_ENGINE_SPEC.md §0/§1 are
// the source of record. Kept schema-agnostic: nothing here references a `class` or
// `class_assessment` row, so this file has no reason to change if School's schema does.

/** A `YYYY-MM-DD` date string in the user's local timezone. Never derived from a raw
 * `Date`/UTC instant (AGENTS.md's timezone rule) — resolved once by the caller before
 * it reaches this engine, which never reads a clock. */
export type LocalDate = string;

export type Confidence = "high" | "moderate" | "low" | "insufficient";

/** One factor's contribution to a score. Mandatory on every risk result — DOMAIN_ENGINE_SPEC.md
 * §0: "a score without a trace is a bug." This is what lets the assessment list eventually say
 * *why* something is ranked where it is, instead of just showing a number. */
export interface TraceEntry {
  key: string;
  rawInput: unknown;
  normalized: number;
  weight: number;
  contribution: number;
}
