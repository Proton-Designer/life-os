import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/deen-mode-helpers.ts, DEEN-09). Deen Mode is a
// per-account switch, so every spec that needs Faith visible (or hidden) must
// establish its OWN starting state rather than trust fixture state -- the SEED
// account is legacy and its deen_mode is whatever production last had. Same
// gating shape as the other app/api/test/* routes: a valid session AND the
// E2E secret, and it only ever touches the caller's own profiles row -- the
// exact column Settings -> Features -> Deen Mode already lets them flip. It
// writes ONLY deen_mode (never deen data, never user_domains).
//
// GET returns the current value plus the total count of the account's
// `prayers` rows, so a spec can prove OFF never deletes deen data (R4).
export async function GET(request: NextRequest) {
  if (!checkSecret(request)) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const supabase = await createClient();

  const { data: profile, error } = await supabase.from("profiles").select("deen_mode").eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { count, error: countError } = await supabase.from("prayers").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

  return NextResponse.json({ deenMode: isDeenModeOn(profile), prayerRows: count ?? 0 });
}

export async function PUT(request: NextRequest) {
  if (!checkSecret(request)) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { on } = (await request.json()) as { on?: unknown };
  if (typeof on !== "boolean") return NextResponse.json({ error: "Body must be { on: boolean }" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ deen_mode: on }).eq("user_id", user.id).select("deen_mode");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "No profiles row for this user" }, { status: 404 });
  return NextResponse.json({ ok: true, deenMode: on });
}
