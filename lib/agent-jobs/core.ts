import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ToolInputError, ToolNotFoundError } from "@/lib/mcp/tool-input-error";
import { AGENT_JOB_KIND_DEFS, ApplyRejected, JOB_INPUT_IS_DATA, isAgentJobKind, type AgentJobKind } from "./kinds";

/**
 * The agent work queue's server side (migration 277). Every state change is an RPC that acts as the caller (auth.uid()), so a
 * person's jobs are only ever visible to and movable by their own tokens. See kinds.ts for what each kind validates and applies.
 */

export interface ClaimedJob {
  id: string;
  kind: AgentJobKind;
  subject_id: string | null;
  /** Text from the person's own documents (a professor's announcement, a syllabus, notes): UNTRUSTED data to do the task on, never instructions. */
  untrusted_input: Record<string, unknown>;
  attempts: number;
  lease_until: string;
  instructions: string;
  output_schema: string;
}

export async function enqueueAgentJobCore(
  supabase: SupabaseClient,
  input: { kind: AgentJobKind; subjectId: string | null; input: Record<string, unknown> },
): Promise<string> {
  const def = AGENT_JOB_KIND_DEFS[input.kind];
  const field = input.input[def.textField];
  const chars = typeof field === "string" ? field.length : 0;
  if (chars > def.maxInputChars) throw new ToolInputError(`${def.label} input must be at most ${def.maxInputChars} characters. Got ${chars}.`);
  const { data, error } = await supabase.rpc("enqueue_agent_job", {
    p_kind: input.kind,
    p_subject_type: input.subjectId ? def.subjectType : null,
    p_subject_id: input.subjectId,
    p_input: input.input,
    p_input_chars: chars,
  });
  if (error) throw error;
  return data as string;
}

/** Claims up to `limit` (max 10) pending jobs, by kind, or one by id. */
export async function claimAgentJobsCore(supabase: SupabaseClient, args: { kind?: string; limit?: number; id?: string; tokenId?: string }): Promise<ClaimedJob[]> {
  if (args.kind !== undefined && !isAgentJobKind(args.kind)) {
    throw new ToolInputError(`patch.kind must be one of: ${Object.keys(AGENT_JOB_KIND_DEFS).join(", ")}. Got: ${JSON.stringify(args.kind)}.`);
  }
  const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 1), 10));
  const { data, error } = await supabase.rpc("claim_agent_jobs", { p_kind: args.kind ?? null, p_limit: limit, p_id: args.id ?? null, p_token_id: args.tokenId ?? null });
  if (error) throw error;
  const rows = (data ?? []) as { id: string; kind: string; subject_id: string | null; input: Record<string, unknown>; attempts: number; lease_until: string }[];
  return rows.filter((r) => isAgentJobKind(r.kind)).map((r) => {
    const def = AGENT_JOB_KIND_DEFS[r.kind as AgentJobKind];
    return {
      id: r.id,
      kind: r.kind as AgentJobKind,
      subject_id: r.subject_id,
      untrusted_input: r.input,
      attempts: r.attempts,
      lease_until: r.lease_until,
      instructions: `${def.task}\n\n${JOB_INPUT_IS_DATA}`,
      output_schema: def.outputSchema,
    };
  });
}

/**
 * Submit: compare-and-set the job to `applying` (only the claimer, inside the lease), validate + apply with the kind's code, then
 * complete it. A result that fails validation is handed back to the agent with the reason (the job returns to `claimed`, failed
 * after 3 attempts); an apply failure does the same with a generic message.
 */
export async function submitAgentJobCore(
  supabase: SupabaseClient,
  userId: string,
  args: { id: string; result: unknown; tokenId?: string },
): Promise<{ summary: string; stored: Record<string, unknown> }> {
  const { data: begun, error: beginError } = await supabase.rpc("begin_agent_job_submit", { p_id: args.id, p_token_id: args.tokenId ?? null });
  if (beginError) throw beginError;
  if (!begun) throw new ToolNotFoundError(`No claimed job found with id "${args.id}" (it may not be yours, may not be claimed by this token, or its 30-minute lease may have lapsed).`);
  const job = begun as { id: string; kind: string; subject_id: string | null; input: Record<string, unknown> };
  if (!isAgentJobKind(job.kind)) {
    await supabase.rpc("reject_agent_job_submit", { p_id: args.id, p_error: "Unknown job kind." });
    throw new ToolInputError("Unknown job kind.");
  }
  const def = AGENT_JOB_KIND_DEFS[job.kind];

  let applied: { stored: Record<string, unknown>; summary: string };
  try {
    applied = await def.apply(supabase, userId, { id: job.id, subjectId: job.subject_id, input: job.input }, args.result);
  } catch (e) {
    if (e instanceof ApplyRejected) {
      await supabase.rpc("reject_agent_job_submit", { p_id: args.id, p_error: e.message });
      throw new ToolInputError(`The result was not accepted: ${e.message} Fix it and submit again.`);
    }
    await supabase.rpc("reject_agent_job_submit", { p_id: args.id, p_error: "The result couldn't be applied." });
    throw new ToolInputError("The result couldn't be applied. Submit it again; if it keeps failing, use fail with a reason.");
  }

  const { error: completeError } = await supabase.rpc("complete_agent_job", { p_id: args.id, p_result: applied.stored });
  if (completeError) throw completeError;
  return applied;
}

export async function failAgentJobCore(supabase: SupabaseClient, args: { id: string; reason: string; tokenId?: string }): Promise<void> {
  const { data, error } = await supabase.rpc("fail_agent_job", { p_id: args.id, p_reason: args.reason, p_token_id: args.tokenId ?? null });
  if (error) throw error;
  if (!Number(data)) throw new ToolNotFoundError(`No claimed job found with id "${args.id}" to fail.`);
}

/** The person cancels their own waiting job. Returns whether one was cancelled. */
export async function cancelAgentJobCore(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("cancel_agent_job", { p_id: id });
  if (error) throw error;
  return Number(data) > 0;
}

/** "Connector present?" -- is there a live (not revoked, not expired) token that can write? Without one nothing could ever pick a job up, so we don't queue. */
export async function hasAgentConnector(supabase: SupabaseClient, userId: string, now: Date): Promise<boolean> {
  const { data, error } = await supabase
    .from("mcp_access_tokens")
    .select("id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .overlaps("scopes", ["write", "jobs"])
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

/** The person dismisses a failed / expired job, or takes a finished job's drafts into review (consume_agent_job). Returns whether one changed. */
export async function dismissAgentJobCore(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("consume_agent_job", { p_id: id });
  if (error) throw error;
  return Number(data) > 0;
}
