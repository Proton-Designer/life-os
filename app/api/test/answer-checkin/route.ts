import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { answerCheckin } from "@/app/(app)/checkin/actions";
import type { CheckinTagType } from "@/lib/checkins/types";

// Test-only endpoint (Task 17.1, Playwright's e2e/checkin.spec.ts): a real
// 2-hour check-in window can't be waited out in a test run, so this drives
// the actual answerCheckin Server Action directly instead of faking DB rows.
// Doesn't grant any capability an authenticated user doesn't already have
// via the real check-in UI — still requires a valid session — but is
// additionally gated behind E2E_TEST_SECRET so it can't be hit by a stray
// discovered URL even against the live production deployment.
function checkSecret(request: NextRequest): boolean {
  const expectedSecret = process.env.E2E_TEST_SECRET;
  return !!expectedSecret && request.headers.get("x-e2e-secret") === expectedSecret;
}

export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as {
    checkinTime: string;
    tagType: CheckinTagType;
    tagLabel: string;
    tagRefId: string | null;
  };
  if (!body.checkinTime || !body.tagType || !body.tagLabel) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await answerCheckin(body.checkinTime, body.tagType, body.tagLabel, body.tagRefId ?? null);

  // answerCheckin itself returns void — re-select the row the test just
  // asked it to write so the spec can assert against real persisted state.
  const { data: row, error } = await supabase
    .from("checkins")
    .select("id, checkin_time, tag_type, tag_label, tag_ref_id, answered")
    .eq("user_id", user.id)
    .eq("checkin_time", body.checkinTime)
    .eq("tag_type", body.tagType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !row) {
    return NextResponse.json({ error: "Insert succeeded but row not found on re-select" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, row });
}

// Cleanup — the spec deletes the exact row it created (by id) once its
// assertions are done, so this test run leaves no residue in the real
// account's data, matching this whole build's revert-after-QA convention.
export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = (await request.json()) as { id: string };
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { error } = await supabase.from("checkins").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
