import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/realtime-sync.spec.ts's Work mutation case): the
// Pipeline board only renders when the signed-in account has an active
// coop_targets row at position 1 (app/(app)/work/page.tsx's own
// `currentTarget` resolution) — SEED has none by default, so a test that
// needs to click "Advance a stage" on a real task has to establish that
// state itself first, same "known starting state before either page loads
// it" discipline as clear-prayer. POST creates one target (position 1,
// active) and one backlog task; DELETE removes them (target delete
// cascades to its task via coop_tasks_target_id_fkey).
export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Clear any pre-existing target at position 1 first — the unique
  // constraint on (user_id, position) would otherwise reject this insert
  // if a prior run's teardown didn't complete.
  await supabase.from("coop_targets").delete().eq("user_id", user.id).eq("position", 1);

  const targetTitle = "E2E Realtime Target";
  const { data: target, error: targetError } = await supabase
    .from("coop_targets")
    .insert({ title: targetTitle, status: "active", position: 1 })
    .select("id")
    .single();
  if (targetError || !target) {
    return NextResponse.json({ error: targetError?.message ?? "insert failed" }, { status: 500 });
  }

  const taskTitle = "E2E Realtime Task";
  const { data: task, error: taskError } = await supabase
    .from("coop_tasks")
    .insert({ target_id: target.id, title: taskTitle, status: "backlog" })
    .select("id")
    .single();
  if (taskError || !task) {
    return NextResponse.json({ error: taskError?.message ?? "insert failed" }, { status: 500 });
  }

  return NextResponse.json({ targetId: target.id, taskId: task.id, taskTitle });
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

  const { error } = await supabase.from("coop_targets").delete().eq("user_id", user.id).eq("title", "E2E Realtime Target");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
