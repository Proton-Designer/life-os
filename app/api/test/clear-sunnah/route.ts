import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";

// Test-only endpoint (e2e/sunnah-disclosure.spec.ts): toggleSunnah only
// flips whatever is currently stored, so a spec can't reliably establish
// "not yet logged" as its OWN starting state without first knowing what a
// prior run left behind — same class of pre-run-state trap as
// e2e/deen.spec.ts's residual-status note, just for sunnah_logs instead of
// prayers. This deletes today's row for the given (prayer, slot)
// outright, restoring the exact "never logged" state a fresh account
// would have.
function checkSecret(request: NextRequest): boolean {
  const expectedSecret = process.env.E2E_TEST_SECRET;
  return !!expectedSecret && request.headers.get("x-e2e-secret") === expectedSecret;
}

export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { prayerName, slot } = (await request.json()) as { prayerName: string; slot: string };
  if (!prayerName || !slot) {
    return NextResponse.json({ error: "Missing prayerName or slot" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("timezone").eq("user_id", user.id).maybeSingle();
  const dateStr = localDateString(new Date(), profile?.timezone ?? "UTC");

  const { error } = await supabase
    .from("sunnah_logs")
    .delete()
    .eq("user_id", user.id)
    .eq("date", dateStr)
    .eq("prayer_name", prayerName)
    .eq("slot", slot);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
