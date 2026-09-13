import type { GradeBoundary } from "@/lib/school/grades/letterGrade";

/**
 * Turns `classes.grade_boundaries` jsonb into the `GradeBoundary[]` shape
 * `letterGradeForPct` (letterGrade.ts) already consumes. Migration 152's own
 * CHECK constraint only guarantees "null or a jsonb array" -- it says
 * nothing about what's inside each element, so this parser is the actual
 * shape guarantee for {letter, minPct} and must not throw on the malformed
 * or partially-written rows a hand-edited jsonb column will eventually
 * contain (a bad row should drop that one entry, not crash the class's
 * whole grade view).
 *
 * Pure and side-effect free: no DB access, no Date, nothing but jsonb in,
 * GradeBoundary[] out -- unit-testable without a mock Supabase client.
 */
export function parseGradeBoundaries(raw: unknown): GradeBoundary[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];

  const boundaries: GradeBoundary[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const { letter, minPct } = entry as Record<string, unknown>;
    if (typeof letter !== "string" || letter.trim().length === 0) continue;
    if (typeof minPct !== "number" || !Number.isFinite(minPct)) continue;
    boundaries.push({ letter: letter.trim(), minPct });
  }
  return boundaries;
}
