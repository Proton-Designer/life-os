import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, resolveLocalTime } from "@/lib/date-utils";
import { saveAllocationCheckin } from "@/app/(app)/checkin/allocation-actions";
import { emptyAllocation, type Allocation } from "@/lib/checkins/allocation";

// Test-only endpoint (e2e/checkin.spec.ts, 2026-08-25 rewrite): the current
// check-in model is per-window allocation (checkins.kind = 'allocation' +
// checkin_allocations), not the old tag_type point-sample this route's
// sibling (answer-checkin) still drives — that path never populates
// allocation-minutes, so it can't seed data /insights actually reads.
// Drives the real saveAllocationCheckin Server Action (same one the
// allocation-checkin UI calls), not a hand-rolled insert.
//
// The window is computed HERE, server-side, from the authed user's own
// profile timezone — never from the test runner's raw clock — the exact
// date-boundary trap that hit prayer-times code, hand-written SQL, and test
// fixtures elsewhere in this same session. 01:00-03:00 local, today: well
// outside any real checkin_window_start/end (waking hours), so a genuine
// answered window from actual usage can't already occupy this slot.
function checkSecret(request: NextRequest): boolean {
  const expectedSecret = process.env.E2E_TEST_SECRET;
  return !!expectedSecret && request.headers.get("x-e2e-secret") === expectedSecret;
}

export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);
  const windowStart = resolveLocalTime(todayStr, "01:00", timezone);
  const windowEnd = resolveLocalTime(todayStr, "03:00", timezone);

  const body = (await request.json().catch(() => ({}))) as { allocation?: Partial<Allocation> };
  const allocation: Allocation = { ...emptyAllocation(), ...(body.allocation ?? { business: 30 }) };

  await saveAllocationCheckin(windowStart.toISOString(), windowEnd.toISOString(), allocation);

  // saveAllocationCheckin returns void — re-select what it wrote so the
  // spec can assert against real persisted state and clean up by id.
  const { data: row, error } = await supabase
    .from("checkins")
    .select("id, window_start, window_end, kind, answered, checkin_allocations(domain, minutes)")
    .eq("user_id", user.id)
    .eq("kind", "allocation")
    .eq("window_start", windowStart.toISOString())
    .maybeSingle();
  if (error || !row) {
    return NextResponse.json({ error: "Insert succeeded but row not found on re-select" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, row });
}

// Cleanup — deletes the exact row by id; checkin_allocations cascades
// (checkin_id references checkins(id) on delete cascade, 019). Also
// accepts deleting by the well-known window_start alone (no id needed) so
// a spec whose earlier assertion threw before it captured `row.id` can
// still clean up in a `finally` — robust to the test failing, not just to
// it passing.
export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = (await request.json().catch(() => ({}))) as { id?: string };

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);
  const windowStart = resolveLocalTime(todayStr, "01:00", timezone).toISOString();

  const query = supabase.from("checkins").delete().eq("user_id", user.id).eq("kind", "allocation");
  const { error } = id ? await query.eq("id", id) : await query.eq("window_start", windowStart);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
