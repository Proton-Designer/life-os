import type { Confidence, LocalDate, TraceEntry } from "./types";

// Ported from CollegeOS packages/core/src/risk/assignmentRisk.ts. Logic, weights and
// bands are unchanged — DOMAIN_ENGINE_SPEC.md §1 is the algorithmic contract and this
// file is not the place to relitigate it. Pure: no I/O, no clock (`today`/`dueDate` are
// arguments), no randomness.

export type RiskBand = "low" | "moderate" | "high" | "critical";

const PROXIMITY_HORIZON_DAYS = 21;
const WEIGHT_SATURATION_PCT = 25;
const PROCRASTINATION_SATURATION_DAYS = 2;
const GRADE_HEADROOM_SATURATION_PCT = 5;
const MIN_PERSONAL_START_DELAY_SAMPLE = 5;
const CONGESTION_EPSILON_HOURS = 1e-6;

/** Sum to 1.0 — DOMAIN_ENGINE_SPEC.md §1. */
const WEIGHTS = {
  proximity: 0.22,
  weight: 0.18,
  knowledgeGap: 0.15,
  unfinished: 0.14,
  gradeHeadroom: 0.12,
  difficulty: 0.08,
  congestion: 0.06,
  procrastination: 0.05,
} as const;

type FactorKey = keyof typeof WEIGHTS;

const CONFIDENCE_LEVELS: Confidence[] = ["high", "moderate", "low", "insufficient"];

function downgradeOneLevel(confidence: Confidence): Confidence {
  const idx = CONFIDENCE_LEVELS.indexOf(confidence);
  return CONFIDENCE_LEVELS[Math.min(idx + 1, CONFIDENCE_LEVELS.length - 1)]!;
}

function confidenceForMissingMass(missingMass: number): Confidence {
  if (missingMass <= 0) return "high";
  if (missingMass <= 0.15) return "moderate";
  if (missingMass <= 0.35) return "low";
  return "insufficient";
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

// Parsed as UTC-epoch-ms purely as a calendar-arithmetic device (not a real instant),
// exactly like CollegeOS's packages/core/src/util/date.ts, so month/year rollovers are
// correct with no timezone involved. `today`/`dueDate` are already-resolved LocalDates —
// this is day-count arithmetic between two calendar dates, not deriving a date from an
// instant, so it does not fall under AGENTS.md's "never derive a date from raw UTC" rule.
function daysBetween(from: LocalDate, to: LocalDate): number {
  const parse = (date: LocalDate): number => {
    const match = LOCAL_DATE_RE.exec(date);
    if (!match) throw new Error(`Invalid LocalDate: ${date}`);
    const [, y, m, d] = match as unknown as [string, string, string, string];
    return Date.UTC(Number(y), Number(m) - 1, Number(d)) / MS_PER_DAY;
  };
  return parse(to) - parse(from);
}

export interface AssignmentRiskInput {
  today: LocalDate;
  dueDate: LocalDate;
  /** Share of the class grade, 0-100. */
  weightPct: number;
  /** 1-5 estimated difficulty. Missing -> factor excluded and weights renormalized. */
  difficultyRating?: number;
  /** 1-5 self-rated understanding. Missing -> factor excluded and weights renormalized. */
  confidenceRating?: number;
  completedUnits: number;
  /** 0 means nothing has been planned yet — a real signal, not missing data. */
  plannedUnits: number;
  /** Hours already committed to other work in the window before the due date. */
  committedHours: number;
  /** Hours actually available in the window before the due date. */
  availableHours: number;
  /** This user's personal mean start-delay in days, if known. */
  userMeanStartDelayDays?: number;
  /** Sample size backing `userMeanStartDelayDays`. Falls back to the global mean when < 5. */
  userStartDelaySampleSize?: number;
  /** Population fallback used when personal history is thin. */
  globalMeanStartDelayDays: number;
  /** Target grade percentage for the class, if the user has set one. */
  targetPct?: number;
  /** Current projected class grade percentage, if computed. */
  projectedPct?: number;
}

export interface AssignmentRiskResult {
  score: number;
  band: RiskBand;
  trace: TraceEntry[];
  confidence: Confidence;
  sampleSize: number;
  /** Factors excluded from this score because their input was unavailable. */
  missingFactors: FactorKey[];
}

export function bandForScore(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "moderate";
  return "low";
}

function normalizeProximity(today: LocalDate, dueDate: LocalDate): number {
  const daysUntil = Math.max(daysBetween(today, dueDate), 0);
  return clamp01(1 - Math.log(1 + daysUntil) / Math.log(1 + PROXIMITY_HORIZON_DAYS));
}

/**
 * A genuinely unavailable rating (difficulty, self-rated confidence, grade headroom) is
 * excluded from the sum and the remaining weights are renormalized over the available
 * mass — never defaulted to 0 (silently discounts risk) or 0.5 (fabricates an
 * unmeasured observation). `unfinished = 1.0` when nothing is planned is a real signal,
 * not missing data, and is never excluded. `procrastination` falling back to the global
 * mean is an estimate, not missing data — it stays in the sum but still downgrades
 * confidence by one level.
 */
export function computeAssignmentRisk(input: AssignmentRiskInput): AssignmentRiskResult {
  const proximity = normalizeProximity(input.today, input.dueDate);
  const weight = clamp01(input.weightPct / WEIGHT_SATURATION_PCT);

  const missingFactors: FactorKey[] = [];
  if (input.difficultyRating == null) missingFactors.push("difficulty");
  if (input.confidenceRating == null) missingFactors.push("knowledgeGap");
  if (input.targetPct == null || input.projectedPct == null) missingFactors.push("gradeHeadroom");

  const difficulty = input.difficultyRating != null ? (input.difficultyRating - 1) / 4 : 0;
  const knowledgeGap = input.confidenceRating != null ? (5 - input.confidenceRating) / 4 : 0;

  const unfinished = input.plannedUnits === 0 ? 1 : clamp01(1 - input.completedUnits / input.plannedUnits);

  const congestion = clamp01(input.committedHours / Math.max(input.availableHours, CONGESTION_EPSILON_HOURS));

  const usingGlobalFallback =
    input.userMeanStartDelayDays == null || (input.userStartDelaySampleSize ?? 0) < MIN_PERSONAL_START_DELAY_SAMPLE;
  const startDelayDays = usingGlobalFallback ? input.globalMeanStartDelayDays : input.userMeanStartDelayDays!;
  const procrastination = clamp01(startDelayDays / PROCRASTINATION_SATURATION_DAYS);

  const gradeHeadroom =
    input.targetPct != null && input.projectedPct != null
      ? clamp01((input.targetPct - input.projectedPct) / GRADE_HEADROOM_SATURATION_PCT)
      : 0;

  const factors: Record<FactorKey, number> = {
    proximity,
    weight,
    difficulty,
    knowledgeGap,
    unfinished,
    congestion,
    procrastination,
    gradeHeadroom,
  };

  const missingSet = new Set(missingFactors);
  const missingMass = missingFactors.reduce((sum, key) => sum + WEIGHTS[key], 0);
  const scale = missingMass < 1 ? 1 / (1 - missingMass) : 0;

  const effectiveWeights: Record<FactorKey, number> = {} as Record<FactorKey, number>;
  for (const key of Object.keys(WEIGHTS) as FactorKey[]) {
    effectiveWeights[key] = missingSet.has(key) ? 0 : WEIGHTS[key] * scale;
  }

  const base = (Object.keys(WEIGHTS) as FactorKey[]).reduce((sum, key) => sum + effectiveWeights[key] * factors[key], 0);
  const salience = 0.35 + 0.65 * proximity;
  const score = Math.round(100 * base * salience);

  const trace: TraceEntry[] = (Object.keys(WEIGHTS) as FactorKey[]).map((key) => ({
    key,
    rawInput: rawInputFor(key, input),
    normalized: factors[key],
    weight: effectiveWeights[key],
    contribution: 100 * salience * effectiveWeights[key] * factors[key],
  }));

  let confidence = confidenceForMissingMass(missingMass);
  if (usingGlobalFallback) confidence = downgradeOneLevel(confidence);

  return {
    score,
    band: bandForScore(score),
    trace,
    confidence,
    sampleSize: usingGlobalFallback ? 0 : (input.userStartDelaySampleSize ?? 0),
    missingFactors,
  };
}

function rawInputFor(key: FactorKey, input: AssignmentRiskInput): unknown {
  switch (key) {
    case "proximity":
      return { today: input.today, dueDate: input.dueDate };
    case "weight":
      return input.weightPct;
    case "difficulty":
      return input.difficultyRating ?? null;
    case "knowledgeGap":
      return input.confidenceRating ?? null;
    case "unfinished":
      return { completedUnits: input.completedUnits, plannedUnits: input.plannedUnits };
    case "congestion":
      return { committedHours: input.committedHours, availableHours: input.availableHours };
    case "procrastination":
      return {
        userMeanStartDelayDays: input.userMeanStartDelayDays ?? null,
        sampleSize: input.userStartDelaySampleSize ?? 0,
        globalMeanStartDelayDays: input.globalMeanStartDelayDays,
      };
    case "gradeHeadroom":
      return { targetPct: input.targetPct ?? null, projectedPct: input.projectedPct ?? null };
  }
}
