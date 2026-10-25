"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { cancelAgentJobCore, dismissAgentJobCore } from "@/lib/agent-jobs/core";
import { listAgentJobsForSubject } from "@/lib/agent-jobs/queries";
import type { AgentJobView } from "@/lib/agent-jobs/types";

/** The class's agent-job cards (waiting / working / failed / ready drafts). Display-only; a failure reads as none. */
export async function listAgentJobs(classId: string): Promise<AgentJobView[]> {
  const { supabase, userId } = await requireUser();
  return listAgentJobsForSubject(supabase, userId, { subjectId: classId });
}

/** The person cancels their own waiting / claimed job. */
export async function cancelAgentJob(jobId: string): Promise<{ ok: boolean }> {
  const { supabase } = await requireUser();
  const ok = await cancelAgentJobCore(supabase, jobId);
  if (ok) revalidatePath("/school");
  return { ok };
}

/** The person dismisses a failed / expired job, or has taken a finished job's drafts into the review list (migration 277's consume_agent_job). */
export async function dismissAgentJob(jobId: string): Promise<{ ok: boolean }> {
  const { supabase } = await requireUser();
  try {
    return { ok: await dismissAgentJobCore(supabase, jobId) };
  } catch {
    return { ok: false };
  }
}
