import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/goals.spec.ts): there is no delete UI for a goal
// anywhere in the app — "Done"/"Drop" (setGoalStatusAction) both leave the
// row in place, visible forever in the Goals page's own "Completed &
// dropped" history section, which is the correct product behavior (a real
// month's goal history) but means a spec that creates one has no in-app
// way to remove it again. goal_milestones references goals(user_id, id)
// ON DELETE CASCADE (migration 165), so deleting the goal row here is
// sufficient teardown for any milestone a test added under it. Same
// secret-gated shape as the other test-only routes, scoped by title (like
// clear-task) rather than id, since a spec typically never sees the
// generated id.
export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { title } = (await request.json()) as { title: string };
  if (!title) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
  }

  const { error } = await supabase.from("goals").delete().eq("user_id", user.id).eq("title", title);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
