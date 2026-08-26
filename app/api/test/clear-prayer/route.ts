import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { checkSecret } from "../check-secret";

// Test-only endpoint (Task 17.1, e2e/deen.spec.ts): markPrayer only supports
// writing on_time/qada/missed — there is no UI affordance to return a prayer
// to "pending" (unlogged), so a test that marks a genuinely-unlogged prayer
// has no way to revert through the app itself. Same gating shape as
// app/api/test/answer-checkin/route.ts: requires both a valid session and
// this secret, so it grants nothing beyond what an authenticated user could
// already do to their own prayers row via the real UI, just without going
// through markPrayer's write-only status values.
export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { prayerName } = (await request.json()) as { prayerName: string };
  if (!prayerName) {
    return NextResponse.json({ error: "Missing prayerName" }, { status: 400 });
  }

  // Compute "today" the same way the Deen page does (account timezone, not
  // server UTC or a client-supplied string) so this can only ever target the
  // exact row the test's own markPrayer call just wrote.
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", user.id)
    .maybeSingle();
  const dateStr = localDateString(new Date(), profile?.timezone ?? "UTC");

  const { error } = await supabase
    .from("prayers")
    .delete()
    .eq("user_id", user.id)
    .eq("date", dateStr)
    .eq("prayer_name", prayerName);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
