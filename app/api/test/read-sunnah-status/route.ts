import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";

// Test-only read endpoint (e2e/sunnah-disclosure.spec.ts): pairs with
// read-prayer-status — confirms the sunnah tap DID actually persist
// (`sunnah_logs`), while read-prayer-status confirms the fard prayer
// (`prayers`) was NOT touched. Asserting only one side would leave a
// silent-no-op bug (a tap that neither logs the sunnah slot nor marks the
// fard prayer) indistinguishable from success.
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
  const slot = request.nextUrl.searchParams.get("slot");
  if (!prayerName || !slot) {
    return NextResponse.json({ error: "Missing prayerName or slot" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("timezone").eq("user_id", user.id).maybeSingle();
  const dateStr = localDateString(new Date(), profile?.timezone ?? "UTC");

  const { data, error } = await supabase
    .from("sunnah_logs")
    .select("completed")
    .eq("user_id", user.id)
    .eq("date", dateStr)
    .eq("prayer_name", prayerName)
    .eq("slot", slot)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ completed: data?.completed ?? false });
}
