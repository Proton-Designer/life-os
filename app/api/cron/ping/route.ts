import { NextResponse } from "next/server";

/**
 * Proof-of-reachability endpoint for R25's queue driver.
 *
 * WHY THIS EXISTS: Vercel's Hobby plan caps cron at ONCE PER DAY with ±59min
 * precision (verified against Vercel's own docs), so it cannot drive a
 * minute-scale ingestion queue. R25 rules that `pg_cron` + `pg_net` on Supabase
 * drives the route instead.
 *
 * The existing production job (`dispatch-notifications-every-15min`) proves
 * pg_net fires — but it targets a Supabase EDGE FUNCTION, not a Vercel route.
 * So it proves the scheduler works and says nothing about whether Postgres can
 * reach an authenticated Vercel endpoint. This route closes that gap with a
 * real round-trip instead of an assumption.
 *
 * Auth is a shared secret in a header, compared in constant time. A route that
 * answered 200 to everyone would prove reachability while proving nothing about
 * auth — and the negative case (wrong secret -> 401) is the half that makes the
 * positive case mean anything.
 *
 * Returns no data and touches nothing. Safe to leave deployed.
 */
export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Fail closed: an unset secret must not make the route public.
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(token, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
