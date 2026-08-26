import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/fitness-daily-log.spec.ts): logWeight/logWaist
// only support writing a value — there is no UI affordance to clear
// today's body_metrics row back to "not logged today," same gap as
// clear-prayer/clear-daily-check. Clears just the ONE field the test
// wrote, preserving the other (a real logged waist alongside a
// test-written weight must not be destroyed) — and only deletes the row
// outright once BOTH fields would be null, since body_metrics_check
// forbids a row with neither.
export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { field } = (await request.json()) as { field: "weight_lb" | "waist_in" };
  if (field !== "weight_lb" && field !== "waist_in") {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("timezone").eq("user_id", user.id).maybeSingle();
  const dateStr = localDateString(new Date(), profile?.timezone ?? "UTC");

  const { data: existing } = await supabase
    .from("body_metrics")
    .select("weight_lb, waist_in")
    .eq("user_id", user.id)
    .eq("date", dateStr)
    .maybeSingle();
  if (!existing) return NextResponse.json({ ok: true });

  const otherField = field === "weight_lb" ? "waist_in" : "weight_lb";
  if (existing[otherField] === null) {
    const { error } = await supabase.from("body_metrics").delete().eq("user_id", user.id).eq("date", dateStr);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const update = field === "weight_lb" ? { weight_lb: null } : { waist_in: null };
    const { error } = await supabase.from("body_metrics").update(update).eq("user_id", user.id).eq("date", dateStr);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
