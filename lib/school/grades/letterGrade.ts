export interface GradeBoundary {
  letter: string;
  minPct: number;
}

/** Inclusive lower bounds, highest match wins. */
export function letterGradeForPct(pct: number, boundaries: GradeBoundary[]): string {
  if (boundaries.length === 0) {
    throw new Error("letterGradeForPct requires at least one grade boundary");
  }
  const sorted = [...boundaries].sort((a, b) => b.minPct - a.minPct);
  const match = sorted.find((b) => pct >= b.minPct);
  return (match ?? sorted[sorted.length - 1]!).letter;
}
