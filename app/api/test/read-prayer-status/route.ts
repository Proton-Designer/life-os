import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";

// Test-only read endpoint (e2e/sunnah-disclosure.spec.ts): the sunnah
// nesting hazard the 2026-08-25/26 disclosure work explicitly guards
// against — a sunnah tap silently ALSO marking the fard prayer done —
// would render identically to a correct write in the UI, since the row's
// own status buttons re-render from the same page load either way. Only a
// real read of the `prayers` table proves the row was never written, the
// same check done manually via psql during that work. Grants nothing an
// authenticated user couldn't already read about their own prayers row.
function checkSecret(request: NextRequest): boolean {
  const expectedSecret = process.env.E2E_TEST_SECRET;
  return !!expectedSecret && request.headers.get("x-e2e-secret") === expectedSecret;
}

export async function GET(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const prayerName = request.nextUrl.searchParams.get("prayerName");
  if (!prayerName) {
    return NextResponse.json({ error: "Missing prayerName" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("timezone").eq("user_id", user.id).maybeSingle();
  const dateStr = localDateString(new Date(), profile?.timezone ?? "UTC");

  const { data, error } = await supabase
    .from("prayers")
    .select("status, logged_at")
    .eq("user_id", user.id)
    .eq("date", dateStr)
    .eq("prayer_name", prayerName)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // null means genuinely no row — distinct from a row that exists with
  // status "pending" (this schema's own default, though the app never
  // writes that value itself — markPrayer only ever writes
  // on_time/qada/missed, and unmarkPrayer deletes the row outright).
  return NextResponse.json({ status: data?.status ?? null });
}
