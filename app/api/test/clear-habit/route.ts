import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/habits.spec.ts): there is no delete UI for an
// identity habit anywhere in the app — "Archive" (archiveIdentityHabitCore)
// leaves the row in place with status='archived', which is correct product
// behavior (pause/freeze/resume is Phase 2+, per the Habits ruling
// 2026-09-14 — an archived habit isn't meant to vanish, it's meant to free
// its rank) but means a spec that creates one has no in-app way to remove
// it again. habit_votes references identity_habits(user_id, id) ON DELETE
// CASCADE (migration 175), so deleting the habit row here also removes any
// vote a test cast under it. Same secret-gated shape as the other
// test-only routes, scoped by identity_statement rather than id, since a
// spec typically never sees the generated id.
export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { identityStatement } = (await request.json()) as { identityStatement: string };
  if (!identityStatement) {
    return NextResponse.json({ error: "Missing identityStatement" }, { status: 400 });
  }

  const { error } = await supabase.from("identity_habits").delete().eq("user_id", user.id).eq("identity_statement", identityStatement);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
