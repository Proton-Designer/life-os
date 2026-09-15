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
}

export type CanvasClientResult<T> = { ok: true; data: T } | { ok: false; message: string };

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
      return { ok: false, message: "Canvas rejected that token. Check the token and instance URL." };
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

/**
 * Active-enrollment courses only (`enrollment_state=active`) — a BYO sync
 * is for "what am I taking right now", not a full historical archive.
 * Widening this to include concluded/inactive enrollments is a real future
 * option (P2-22 territory: expiry/sync-status screen), not in scope here.
 *
 * per_page=100 covers a normal course load without pagination; a user
 * enrolled in more than 100 active Canvas courses simultaneously is not a
 * real case this integration needs to handle on day one — logged as a
 * known gap rather than built speculatively.
 */
export async function fetchCanvasCourses(instanceUrl: string, token: string): Promise<CanvasClientResult<CanvasCourseSummary[]>> {
  const res = await canvasFetch(instanceUrl, token, `/api/v1/courses?enrollment_state=active&per_page=${COURSES_PER_PAGE}`);
  if (!res.ok) return res;
  const raw = res.data;
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Canvas returned an unexpected course list shape." };
  }
  const courses: CanvasCourseSummary[] = raw
    .filter((c): c is { id: number | string; name?: string; course_code?: string } => Boolean(c) && typeof c === "object" && "id" in c)
    .map((c) => ({
      canvasCourseId: String(c.id),
      name: c.name ?? `Course ${c.id}`,
      courseCode: c.course_code ?? null,
    }));
  return { ok: true, data: courses };
}
