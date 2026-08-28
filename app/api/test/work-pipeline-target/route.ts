import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/work-pipeline.spec.ts): the Weekly Agenda
// Pipeline panel only renders when the account has an active coop_targets
// row at position 1 (app/(app)/work/page.tsx's `currentTarget`) — SEED
// carries none by default, same "establish the starting state before the
// page loads it" discipline as reset-coop-pipeline. A distinct title from
// that route's "E2E Realtime Target" so the two specs' fixtures never read
// as each other's leftovers if a teardown is ever incomplete.
//
// Clears any pre-existing row at position 1 first (same reasoning as
// reset-coop-pipeline): the unique constraint on (user_id, position)
// would otherwise reject this insert if a prior run's teardown didn't
// complete. DELETE removes by title; coop_tasks cascades via
// coop_tasks_target_id_fkey, so every task this spec creates under this
// target is cleaned up in the same request.
const TARGET_TITLE = "E2E Work Pipeline Target";

export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  await supabase.from("coop_targets").delete().eq("user_id", user.id).eq("position", 1);

  const { data: target, error } = await supabase
    .from("coop_targets")
    .insert({ title: TARGET_TITLE, status: "active", position: 1 })
    .select("id")
    .single();
  if (error || !target) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  return NextResponse.json({ targetId: target.id, title: TARGET_TITLE });
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

  const { error } = await supabase.from("coop_targets").delete().eq("user_id", user.id).eq("title", TARGET_TITLE);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
