import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/task-row-list.spec.ts): the 2026-08-26 afternoon
// School redesign scopes both TaskListModule and TaskEditDialog to
// `openTasks` (app/(app)/school/page.tsx filters `!completed` before either
// component ever sees a row), and neither Home's Now module (next-actions.tsx
// doesn't wire TaskRowList's onRemove) nor School's KPI dialogs
// (kpi-task-dialog.tsx, same) do either — so once a task is completed via
// tap-to-complete, there is no in-app way left to remove it or revert it to
// pending. A test that completes a task to verify tap-to-complete's
// persistence-across-reload behavior (the whole point of that spec) has no
// UI path to clean up after itself. Same secret-gated shape as the other
// test-only routes; scoped by title, not id, since the spec creates the
// task through the wizard and never sees its generated id.
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

  const { error } = await supabase.from("tasks").delete().eq("user_id", user.id).eq("title", title);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
