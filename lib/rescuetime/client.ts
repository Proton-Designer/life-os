import "server-only";
import { safeFetch } from "@/lib/net/safe-outbound-url";

/**
 * RescueTime REST client (BYOK API key). Same overall shape as
 * lib/canvas/client.ts -- discriminated `RescueTimeClientResult` rather
 * than throwing (a wrong key or a RescueTime outage is an expected, common
 * BYOK outcome, not an exceptional one), no DB access here (that's
 * rescuetime-actions.ts's job, same split canvas-actions.ts/client.ts use).
 *
 * FIXED HOST, still through safeFetch (P3-19 instruction, a9): unlike
 * Canvas's user-supplied instance URL, RescueTime's API host is a constant
 * this file owns -- there is no per-user SSRF surface to guard against
 * here the way there was for Canvas. Routed through safeFetch anyway for
 * uniformity (this codebase's one "make an outbound call safely" utility)
 * and as cheap defense-in-depth against a compromised/malicious redirect
 * from RescueTime's own domain, however unlikely.
 *
 * UNVERIFIED AGAINST A LIVE ACCOUNT (BYOK -- no operator test key exists,
 * same posture already accepted for P2-20's Canvas client and P3-15's
 * Gemini path): built against RescueTime's publicly documented Daily
 * Summary Feed API shape. Flagged in $SD/OPEN_QUESTIONS.md -- smoke-test
 * against a real key before considering this fully proven.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const RESCUETIME_HOST = "https://www.rescuetime.com";

export interface RescueTimeDailySummary {
  date: string; // "YYYY-MM-DD"
  productivityPulse: number | null;
  veryProductivePct: number | null;
  productivePct: number | null;
  neutralPct: number | null;
  distractingPct: number | null;
  veryDistractingPct: number | null;
  totalHours: number | null;
}

export type RescueTimeClientResult<T> = { ok: true; data: T } | { ok: false; message: string };

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

async function rescueTimeFetch(path: string): Promise<RescueTimeClientResult<unknown>> {
  const url = `${RESCUETIME_HOST}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "RescueTime rejected that key." };
    }
    if (!res.ok) {
      return { ok: false, message: `RescueTime returned an error (HTTP ${res.status}).` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, message: "RescueTime didn't respond in time." };
    }
    // safeFetch throws an already user-safe message for a syntax/SSRF
    // rejection -- surface it directly, same convention lib/canvas/client.ts
    // already established.
    if (err instanceof Error && err.message) {
      return { ok: false, message: err.message };
    }
    return { ok: false, message: "Couldn't reach RescueTime." };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Verifies a key is live by asking for the daily summary feed itself
 * (RescueTime has no separate lightweight "whoami" endpoint the way Canvas
 * does) -- a successful, parseable response IS the verification.
 */
export async function verifyRescueTimeKey(apiKey: string): Promise<RescueTimeClientResult<true>> {
  const res = await fetchDailySummaries(apiKey);
  if (!res.ok) return res;
  return { ok: true, data: true };
}

/**
 * RescueTime's Daily Summary Feed API returns an array of per-day summaries
 * (most recent first, per its documented default window) -- this maps every
 * row it returns; the caller (rescuetime-actions.ts) decides how many days
 * to keep/upsert.
 */
export async function fetchDailySummaries(apiKey: string): Promise<RescueTimeClientResult<RescueTimeDailySummary[]>> {
  const res = await rescueTimeFetch(`/anapi/daily_summary_feed?key=${encodeURIComponent(apiKey)}&format=json`);
  if (!res.ok) return res;
  const raw = res.data;
  if (!Array.isArray(raw)) {
    return { ok: false, message: "RescueTime returned an unexpected response shape." };
  }
  const summaries: RescueTimeDailySummary[] = raw
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && "date" in r)
    .map((r) => ({
      date: String(r.date),
      productivityPulse: toNullableNumber(r.productivity_pulse),
      veryProductivePct: toNullableNumber(r.very_productive_percentage),
      productivePct: toNullableNumber(r.productive_percentage),
      neutralPct: toNullableNumber(r.neutral_percentage),
      distractingPct: toNullableNumber(r.distracting_percentage),
      veryDistractingPct: toNullableNumber(r.very_distracting_percentage),
      totalHours: toNullableNumber(r.total_hours),
    }));
  return { ok: true, data: summaries };
}
