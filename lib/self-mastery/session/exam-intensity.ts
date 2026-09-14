// #27 -- backward-planned exam-intensity curve. ZERO PRIOR ART: nothing in
// this codebase ramps review intensity toward a deadline today. Built on
// two things that already exist, per the Opus Lead's scoping note:
//   1. Assessment due dates -- `class_assessments.date` (`type` in
//      ('exam','final_midterm'), 000/105/151/152), read directly (RLS
//      already scopes it to the caller; no RPC needed).
//   2. A due-item pool scoped to a class -- exists once 160 (#24) lands:
//      `get_session_queue`'s `due`/`warm_up` entries are joined through a
//      `kind='course'` `sources` row keyed on `question.class_id`.
// Does NOT use grade_categories (#11, 152) -- explicitly out of scope per
// the Lead's note; this curve only ever asks "how many days until the
// nearest exam-type assessment for this class", nothing about weighting or
// grade impact.
//
// WHY THIS IS A PURE MULTIPLIER, NOT A NEW RPC OR A NEW SessionPlan SHAPE:
// `queue-limits.ts` already separates "how much capacity exists" from "how
// the RPC round-robins within it" -- `allocateQueueLimits(capacity,
// totalDueCount, dailyNewLimit)`. Scaling `capacity` for a class approaching
// an exam is additive to that pipeline, not a rewrite of it. Full
// per-class-scoped allocation (asking the queue for MORE of one class's
// due items specifically as its exam nears) is a real, larger feature --
// `get_session_queue` interleaves round-robin across ALL sources today with
// no per-source weighting knob -- and is flagged as follow-up work in this
// file's own doc, not invented here.
//
// Calendar-date discipline (AGENTS.md, lib/date-utils.ts): every date here
// is a YYYY-MM-DD string, diffed via `Date.UTC(y, m-1, d)` on ALREADY
// -resolved calendar components -- never `new Date(dateStr)` naive parsing,
// never a raw instant. Same idiom `lib/date-utils.ts` itself uses
// (`getWeekStartDate`, `addDaysToDateString`), kept local to this file
// rather than added to that shared module, since it isn't owned here.

export interface UpcomingAssessment {
  classId: string;
  date: string; // YYYY-MM-DD
  type: string;
  name: string;
}

/**
 * Calendar days from `fromStr` to `toStr` (both YYYY-MM-DD), positive when
 * `toStr` is later. Pure integer arithmetic on already-resolved calendar
 * components -- no instant, no timezone, matching `lib/date-utils.ts`'s own
 * `Date.UTC` idiom for exactly this reason.
 */
export function daysBetweenDateStrings(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const fromUTC = Date.UTC(fy!, fm! - 1, fd!);
  const toUTC = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((toUTC - fromUTC) / 86_400_000);
}

/**
 * Backward-planned intensity ramp: how many times the normal review budget
 * a class's due-item pool deserves, as its nearest exam-type assessment
 * approaches. `null` (no upcoming exam known) or a NEGATIVE distance (the
 * assessment date has already passed -- stale data, not "infinitely
 * urgent") both return the baseline multiplier, never an inflated one --
 * an exam that already happened is not a reason to over-study its class
 * today.
 *
 * The curve itself (>21d baseline, ramping to 3x inside 24h) is a
 * deliberate, simple backward-planning shape -- flat until "this needs
 * real attention" (3 weeks, a conventional exam-prep horizon), then
 * monotonically steeper as the deadline closes. Not derived from any
 * existing feature (there is none, per this file's header) -- a
 * placeholder ramp meant to be tuned against real usage, not a claimed
 * optimum.
 */
export function examIntensityMultiplier(daysUntilExam: number | null): number {
  if (daysUntilExam === null || daysUntilExam < 0) return 1.0;
  if (daysUntilExam <= 1) return 3.0;
  if (daysUntilExam <= 3) return 2.5;
  if (daysUntilExam <= 7) return 2.0;
  if (daysUntilExam <= 14) return 1.5;
  if (daysUntilExam <= 21) return 1.2;
  return 1.0;
}

/**
 * Scales a base item budget by an intensity multiplier, rounded down and
 * floored at the base itself -- intensity only ever ADDS capacity toward an
 * approaching exam, never removes it (a multiplier below 1.0 is not a
 * concept this curve produces, but this guards the arithmetic regardless).
 */
export function applyExamIntensity(baseLimit: number, multiplier: number): number {
  return Math.max(baseLimit, Math.floor(baseLimit * multiplier));
}

interface AssessmentRow {
  class_id: string;
  date: string;
  type: string;
  name: string;
}

interface AssessmentQueryClient {
  from(table: "class_assessments"): {
    select(columns: string): {
      eq(column: string, value: string): {
        in(column: string, values: string[]): {
          gte(column: string, value: string): {
            order(column: string, opts?: { ascending?: boolean }): Promise<{ data: AssessmentRow[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
}

/**
 * The nearest upcoming exam-type assessment per class, for `userId`, on or
 * after `todayStr`. Plain RLS-scoped read (`class_assessments_own_row`
 * already restricts to the caller) -- no RPC needed, per this file's
 * header. Returns a Map keyed by class_id; a class with no upcoming
 * exam-type assessment is simply absent, not a null entry -- callers
 * combine with `examIntensityMultiplier(null)` for that case, never
 * invent a placeholder date.
 */
export async function loadNearestUpcomingExamsByClass(
  client: AssessmentQueryClient,
  userId: string,
  todayStr: string,
): Promise<Map<string, UpcomingAssessment>> {
  const { data, error } = await client
    .from("class_assessments")
    .select("class_id, date, type, name")
    .eq("user_id", userId)
    .in("type", ["exam", "final_midterm"])
    .gte("date", todayStr)
    .order("date", { ascending: true });
  if (error) throw error;

  const byClass = new Map<string, UpcomingAssessment>();
  for (const row of data ?? []) {
    // Rows arrive ordered by date ascending -- the FIRST row seen per
    // class_id is therefore its nearest upcoming exam-type assessment;
    // never overwrite it with a later one.
    if (!byClass.has(row.class_id)) {
      byClass.set(row.class_id, { classId: row.class_id, date: row.date, type: row.type, name: row.name });
    }
  }
  return byClass;
}
