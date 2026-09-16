import "server-only";
import { safeFetch } from "@/lib/net/safe-outbound-url";

/**
 * Canvas LMS REST client (BYO instance URL + personal access token).
 *
 * Own module, deliberately: P2-21 (announcement/grade sync) and P3-13
 * (ICS reconciliation) import this directly rather than re-implementing
 * the fetch wrapper. No database access here — that's canvas-actions.ts's
 * job (it decrypts the stored token and calls into this file). Keeping
 * this file DB-free means it can be unit-tested (or exercised against a
 * mock server) without a Postgres connection.
 *
 * Every function returns a discriminated `CanvasClientResult` rather than
 * throwing — a wrong token or an unreachable instance is an expected,
 * common outcome for a BYO integration (typo'd URL, expired token,
 * school's Canvas down for maintenance), not an exceptional one, and the
 * caller (a Server Action) needs a message it can show the user directly.
 *
 * SSRF (P2-20 security review, MEDIUM): the instance URL is user-supplied
 * and this server sends the user's own token to wherever it resolves —
 * nothing else here validates that isn't a cloud-metadata or internal
 * address. All outbound calls go through `safeFetch`
 * (lib/net/safe-outbound-url.ts), never Node's raw `fetch`, and it
 * re-validates DNS + redirects on every single call — see its own header.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const COURSES_PER_PAGE = 100;

export interface CanvasSelfUser {
  canvasUserId: string;
  name: string;
}

export interface CanvasCourseSummary {
  canvasCourseId: string;
  name: string;
  courseCode: string | null;
  /**
   * CANVAS-GAP-01 (ENG3's CANVAS-VERIFY-01 live probe): the instructor-
   * computed running/final grade for the CURRENT user's own enrollment,
   * confirmed live against a real Canvas instance via
   * `include[]=total_scores`. All three independently nullable -- Canvas
   * omits them when the course/enrollment doesn't compute one (no
   * fabricated 0%/"—" here; the caller decides how to render an absence).
   * A course-level SNAPSHOT, never touched against or compared with any
   * single `class_assessments` row.
   */
  computedCurrentScore: number | null;
  computedFinalScore: number | null;
  computedCurrentLetterGrade: string | null;
}

/**
 * `authExpired` (P2-22): true only when Canvas itself rejected the token
 * (HTTP 401/403) — distinguishes "the credential is bad, ask the user to
 * reconnect" from every other failure kind (network, timeout, malformed
 * response, SSRF-guard rejection), which callers must NOT treat as an
 * expired token. A typed flag, not a string match on `message`, so a
 * caller can branch on it without depending on exact wording.
 */
export type CanvasClientResult<T> = { ok: true; data: T } | { ok: false; message: string; authExpired?: boolean };

/** Strips a trailing slash so `${base}${path}` never double-slashes. */
function normalizeInstanceUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

async function canvasFetch(instanceUrl: string, token: string, path: string): Promise<CanvasClientResult<unknown>> {
  const url = `${normalizeInstanceUrl(instanceUrl)}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Canvas rejected that token. Check the token and instance URL.", authExpired: true };
    }
    if (!res.ok) {
      return { ok: false, message: `Canvas returned an error (HTTP ${res.status}).` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, message: "Canvas didn't respond in time. Check the instance URL." };
    }
    // safeFetch throws a specific, already user-safe message for a syntax
    // or SSRF rejection (e.g. "That host resolves to a private or internal
    // address, which isn't allowed.") — surface it directly rather than
    // flattening every failure into one generic string.
    if (err instanceof Error && err.message) {
      return { ok: false, message: err.message };
    }
    return { ok: false, message: "Couldn't reach that Canvas instance. Check the URL." };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Verifies a token is live AND identifies who it belongs to, in one call —
 * `/api/v1/users/self` is Canvas's standard "who am I" endpoint and works
 * identically for any account type, so this doubles as the connect-time
 * check and the source of canvas_user_id/canvas_user_name for the vault.
 */
export async function verifyCanvasToken(instanceUrl: string, token: string): Promise<CanvasClientResult<CanvasSelfUser>> {
  const res = await canvasFetch(instanceUrl, token, "/api/v1/users/self");
  if (!res.ok) return res;
  const raw = res.data as { id?: number | string; name?: string };
  if (raw.id === undefined || raw.id === null || !raw.name) {
    return { ok: false, message: "Canvas responded, but not with a recognizable user." };
  }
  return { ok: true, data: { canvasUserId: String(raw.id), name: raw.name } };
}

type RawCanvasCourse = { id: number | string; name?: string; course_code?: string; enrollments?: { computed_current_score?: number; computed_final_score?: number; computed_current_letter_grade?: string }[] };

function mapCanvasCourses(raw: unknown): CanvasClientResult<CanvasCourseSummary[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Canvas returned an unexpected course list shape." };
  }
  const courses: CanvasCourseSummary[] = raw
    .filter((c): c is RawCanvasCourse => Boolean(c) && typeof c === "object" && "id" in c)
    .map((c) => {
      const enrollment = c.enrollments?.[0];
      return {
        canvasCourseId: String(c.id),
        name: c.name ?? `Course ${c.id}`,
        courseCode: c.course_code ?? null,
        computedCurrentScore: typeof enrollment?.computed_current_score === "number" ? enrollment.computed_current_score : null,
        computedFinalScore: typeof enrollment?.computed_final_score === "number" ? enrollment.computed_final_score : null,
        computedCurrentLetterGrade: typeof enrollment?.computed_current_letter_grade === "string" ? enrollment.computed_current_letter_grade : null,
      };
    });
  return { ok: true, data: courses };
}

/**
 * Active-enrollment courses only (`enrollment_state=active`) — a BYO sync
 * is for "what am I taking right now" by default. Concluded/inactive
 * enrollments are a real, separate, opt-in fetch now (CANVAS-LITE-04) --
 * `fetchConcludedCanvasCourses` below -- never silently folded into this
 * default list, so "what am I taking right now" stays true of this
 * function's own contract.
 *
 * per_page=100 covers a normal course load without pagination; a user
 * enrolled in more than 100 active Canvas courses simultaneously is not a
 * real case this integration needs to handle on day one — logged as a
 * known gap rather than built speculatively.
 */
export async function fetchCanvasCourses(instanceUrl: string, token: string): Promise<CanvasClientResult<CanvasCourseSummary[]>> {
  // CANVAS-GAP-01: `include[]=total_scores` embeds `enrollments[]` on each
  // course object, scoped to the calling token's OWN enrollment(s) for a
  // normal (non-admin) token -- confirmed live (ENG3's CANVAS-VERIFY-01),
  // not assumed from docs alone. Free on this same request, no second call.
  const res = await canvasFetch(instanceUrl, token, `/api/v1/courses?enrollment_state=active&include[]=total_scores&per_page=${COURSES_PER_PAGE}`);
  if (!res.ok) return res;
  return mapCanvasCourses(res.data);
}

/**
 * CANVAS-LITE-04: concluded/inactive courses, fetched ONLY when the caller
 * explicitly asks (the Settings "N concluded courses skipped -- import
 * them?" offer, or the user clicking through it) -- never merged into
 * `fetchCanvasCourses`'s own default active-only list, and never fetched
 * automatically on every sync (an extra Canvas API call the common case
 * doesn't need). `enrollment_state=completed` is Canvas's own documented
 * value for a concluded enrollment.
 */
export async function fetchConcludedCanvasCourses(instanceUrl: string, token: string): Promise<CanvasClientResult<CanvasCourseSummary[]>> {
  const res = await canvasFetch(instanceUrl, token, `/api/v1/courses?enrollment_state=completed&include[]=total_scores&per_page=${COURSES_PER_PAGE}`);
  if (!res.ok) return res;
  return mapCanvasCourses(res.data);
}

const ANNOUNCEMENTS_PER_PAGE = 50;
const ASSIGNMENTS_PER_PAGE = 100;

export interface CanvasAnnouncement {
  canvasAnnouncementId: string;
  title: string;
  /** Raw HTML, exactly as Canvas stores it — the caller (P2-21's sync-core)
   * strips tags before handing this to the LLM extraction step, same as
   * any other untrusted free text this app parses. */
  messageHtml: string;
  postedAt: string | null;
}

/**
 * P2-21 — announcements posted to a mapped course since `sinceIso`.
 * `context_codes[]=course_<id>` is Canvas's own multi-context announcements
 * endpoint (built for exactly this "what's new across my courses" use);
 * scoped to one course per call here since the sync loop already iterates
 * courses one at a time (same shape `fetchCanvasCourses` and
 * `fetchCanvasGradedAssignments` both take). `start_date` bounds the
 * window rather than tracking a per-course cursor — the caller re-polls a
 * fixed recent window every run and relies on migration 189's own dedup
 * index for idempotency, not on this call returning only-ever-new items.
 */
export async function fetchCanvasAnnouncements(instanceUrl: string, token: string, courseId: string, sinceIso: string): Promise<CanvasClientResult<CanvasAnnouncement[]>> {
  const res = await canvasFetch(
    instanceUrl,
    token,
    `/api/v1/announcements?context_codes[]=${encodeURIComponent(`course_${courseId}`)}&start_date=${encodeURIComponent(sinceIso)}&per_page=${ANNOUNCEMENTS_PER_PAGE}`,
  );
  if (!res.ok) return res;
  const raw = res.data;
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Canvas returned an unexpected announcement list shape." };
  }
  const announcements: CanvasAnnouncement[] = raw
    .filter((a): a is { id: number | string; title?: string; message?: string; posted_at?: string } => Boolean(a) && typeof a === "object" && "id" in a)
    .map((a) => ({
      canvasAnnouncementId: String(a.id),
      title: a.title ?? "(untitled announcement)",
      messageHtml: a.message ?? "",
      postedAt: a.posted_at ?? null,
    }));
  return { ok: true, data: announcements };
}

export interface CanvasGradedAssignment {
  canvasAssignmentId: string;
  name: string;
  dueAt: string | null;
  pointsPossible: number | null;
  pointsEarned: number;
  /**
   * CANVAS-GAP-03 (ENG3's CANVAS-VERIFY-01 live probe): carried through
   * verbatim, not interpreted here — `points`/`percent` are the only
   * types whose `submission.score` is directly comparable to
   * `points_possible` (Canvas's own UI shows `percent` as score/possible,
   * same underlying scale as `points`; `pass_fail` is a fixed 0-or-full
   * score with no partial-credit meaning; `letter_grade`/`gpa_scale` map
   * through the COURSE's own grading scheme, which this app never
   * fetches; `not_graded` was never a real grade). The actual guard lives
   * where the write happens (`processCanvasAssignment`, sync-core.ts) so
   * it applies identically to a Canvas-fetched assignment AND an
   * agent-supplied one (CANVAS-LITE-02) — see that function's own header.
   */
  gradingType: string | null;
}

/**
 * P2-21 — assignments the caller has a GRADED submission for, in a mapped
 * course. `include[]=submission` embeds the current user's own submission
 * on each assignment object in one call — Canvas's own idiom for "my
 * grades in this course" — rather than a separate submissions endpoint.
 * Filtered to `workflow_state === "graded"` with a real numeric `score`
 * here (not left to the caller): an ungraded/excused/missing submission
 * has no grade to sync, and P2-21's own scope is grade sync, not a general
 * due-date/assignment sync (that reads as P3-13's ICS-reconciliation
 * territory instead). `grading_type` is NOT filtered here — see
 * `CanvasGradedAssignment.gradingType`'s own header for why the guard
 * lives one layer down instead.
 */
export async function fetchCanvasGradedAssignments(instanceUrl: string, token: string, courseId: string): Promise<CanvasClientResult<CanvasGradedAssignment[]>> {
  const res = await canvasFetch(instanceUrl, token, `/api/v1/courses/${encodeURIComponent(courseId)}/assignments?include[]=submission&per_page=${ASSIGNMENTS_PER_PAGE}`);
  if (!res.ok) return res;
  const raw = res.data;
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Canvas returned an unexpected assignment list shape." };
  }
  const graded: CanvasGradedAssignment[] = raw
    .filter(
      (a): a is { id: number | string; name?: string; due_at?: string; points_possible?: number; grading_type?: string; submission?: { workflow_state?: string; score?: number } } =>
        Boolean(a) && typeof a === "object" && "id" in a,
    )
    .filter((a) => a.submission?.workflow_state === "graded" && typeof a.submission?.score === "number")
    // `not_graded` is structurally never a real grade (Canvas's own
    // vocabulary, not this app's guess) -- excluded here exactly like an
    // ungraded submission above, not merely left ungradable. Every OTHER
    // unsafe grading_type (pass_fail, letter_grade, gpa_scale) is a real
    // grade, just not points-comparable, so it still flows through for
    // linking; only the points_earned/points_possible write is guarded,
    // one layer down (see CanvasGradedAssignment.gradingType's header).
    .filter((a) => a.grading_type !== "not_graded")
    .map((a) => ({
      canvasAssignmentId: String(a.id),
      name: a.name ?? `Assignment ${a.id}`,
      dueAt: a.due_at ?? null,
      pointsPossible: typeof a.points_possible === "number" ? a.points_possible : null,
      pointsEarned: a.submission!.score as number,
      gradingType: typeof a.grading_type === "string" ? a.grading_type : null,
    }));
  return { ok: true, data: graded };
}

/** 5 MB -- generous for a single user's term calendar (a few hundred VEVENTs is a few hundred KB), small enough that a malicious or misconfigured feed URL can't be used to exhaust memory/bandwidth on this server. */
const ICS_FEED_MAX_BYTES = 5 * 1024 * 1024;

/**
 * P3-13 -- fetches the raw text of a Canvas ICS calendar feed.
 *
 * DELIBERATELY NOT `canvasFetch`: the feed URL is not an `/api/v1/...`
 * path against a stored `instanceUrl`, and it carries its own embedded
 * secret token in its query string rather than a Bearer header -- the
 * URL IS the credential, per the Lead's ruling. Still goes through
 * `safeFetch` (SSRF-guarded, re-validated on every call, same as every
 * other outbound Canvas request in this module) since it's still a
 * user-supplied URL this server fetches on the user's behalf.
 *
 * SIZE-CAPPED, STREAMED: an ICS feed is attacker-influenceable text (the
 * Lead's explicit ruling) -- reads the response body incrementally and
 * aborts the moment it exceeds `ICS_FEED_MAX_BYTES`, rather than buffering
 * an unbounded body via `res.text()` first and checking after the fact.
 */
export async function fetchCanvasIcsFeed(feedUrl: string): Promise<CanvasClientResult<string>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await safeFetch(feedUrl, { headers: { Accept: "text/calendar" }, signal: controller.signal });
    if (!res.ok) return { ok: false, message: `The calendar feed returned an error (HTTP ${res.status}).` };
    if (!res.body) return { ok: true, data: await res.text() };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let totalBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > ICS_FEED_MAX_BYTES) {
        await reader.cancel();
        return { ok: false, message: "That calendar feed is larger than expected. Reconciliation stopped." };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, data: text };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, message: "The calendar feed didn't respond in time." };
    }
    if (err instanceof Error && err.message) {
      return { ok: false, message: err.message };
    }
    return { ok: false, message: "Couldn't reach that calendar feed." };
  } finally {
    clearTimeout(timeout);
  }
}
