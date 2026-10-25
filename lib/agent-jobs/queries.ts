import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAgentJobKind, type AgentJobKind } from "./kinds";
import type { AgentJobView } from "./types";

/**
 * What the UI shows for a class's agent jobs: waiting / working jobs, failed or expired ones the person has not dismissed, and
 * question drafts an agent finished that the person has not reviewed yet. A finished extraction needs no card: its staged batch is
 * already on the page. RLS-scoped (select-own); a read error reads as nothing, because this is display-only.
 */
export async function listAgentJobsForSubject(supabase: SupabaseClient, userId: string, args: { subjectId: string }): Promise<AgentJobView[]> {
  const { data, error } = await supabase
    .from("agent_jobs")
    .select("id, kind, status, created_at, error, result")
    .eq("user_id", userId)
    .eq("subject_id", args.subjectId)
    .in("status", ["pending", "claimed", "applying", "failed", "expired", "done"])
    .is("consumed_at", null)
    .order("created_at", { ascending: false });
  if (error || !Array.isArray(data)) return [];
  const views: AgentJobView[] = [];
  for (const r of data as { id: string; kind: string; status: string; created_at: string; error: string | null; result: { drafts?: AgentJobView["drafts"] } | null }[]) {
    if (!isAgentJobKind(r.kind)) continue;
    const kind: AgentJobKind = r.kind;
    if (r.status === "pending") views.push({ id: r.id, kind, state: "waiting", createdAt: r.created_at, error: null });
    else if (r.status === "claimed" || r.status === "applying") views.push({ id: r.id, kind, state: "working", createdAt: r.created_at, error: null });
    else if (r.status === "failed" || r.status === "expired") {
      views.push({ id: r.id, kind, state: "failed", createdAt: r.created_at, error: r.status === "expired" ? "Your agent didn't get to this in time." : (r.error ?? "Your agent couldn't do this.") });
    } else if (r.status === "done" && kind === "school.question_draft" && Array.isArray(r.result?.drafts)) {
      views.push({ id: r.id, kind, state: "ready_drafts", createdAt: r.created_at, error: null, drafts: r.result!.drafts });
    }
  }
  // oldest first, so the card order is stable as jobs finish
  return views.reverse();
}
