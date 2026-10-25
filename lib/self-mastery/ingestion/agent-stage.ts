import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAnyAiKey } from "@/lib/ai/resolve-key";
import { hasAgentConnector } from "@/lib/agent-jobs/core";
import { isPagedSource } from "./documents";
import { estimateBookProgressPct } from "@/lib/self-mastery/ingestion-progress";
import { agentUnitFailedMessage, AGENT_CANCELLED_MESSAGE, AGENT_TIMEOUT_MESSAGE } from "./failure-messages";
import type { IngestStage } from "@/lib/self-mastery/types";

/**
 * Book ingestion with no AI key (agent work queue, step 4). The pipeline and its cursor are unchanged; the three stages that call a model
 * (extracting_lessons per chunk, verifying_grounding per lesson, generating_cards per lesson) are PLANNED here, before the stage handler runs:
 *
 *   inline   the owner has a key (or there is no agent to hand work to): run the stage handler exactly as before.
 *   park     the owner has no key but a connected agent: make sure the next BOOK_STAGE_WINDOW unfinished units each have a
 *            self_mastery.book_stage agent job, then park the ingestion job until a result arrives.
 *   advance  every unit of the stage has a finished job: the stage is over, move the cursor like the handler would.
 *   fail     a unit's job failed, was cancelled, or expired: fail the book retryably instead of waiting forever.
 *
 * UNITS ARE KEYED BY ID, NOT BY CURSOR INDEX. Results arrive in any order, and verifying_grounding rejects lessons (dropping their rank) while it
 * walks, which would shift every later index. A unit is "done" when its job (dedupe key `<book>:<stage>:<unit id>`) is done; the cursor itself stays
 * at the stage's start while the agent works, and the stage ends when no unit is left without a done job.
 *
 * Embedding is not a stage the agent needs: it uses the owner's embeddings key only when they have one, and writes nothing otherwise.
 */

export const AGENT_MODEL_STAGES = ["extracting_lessons", "verifying_grounding", "generating_cards"] as const;
export type AgentModelStage = (typeof AGENT_MODEL_STAGES)[number];
export const BOOK_STAGE_JOB_KIND = "self_mastery.book_stage";
/** How many unfinished units ahead get a job at once. Small enough that a dead agent leaves a short queue, large enough that one agent run has plenty to do. */
export const BOOK_STAGE_WINDOW = 20;

const NEXT_AFTER: Record<AgentModelStage, { nextStage: IngestStage; nextChunkIndex: number | null }> = {
  extracting_lessons: { nextStage: "merging", nextChunkIndex: null },
  verifying_grounding: { nextStage: "generating_cards", nextChunkIndex: null },
  generating_cards: { nextStage: "finalizing", nextChunkIndex: null },
};

export type AgentStagePlan =
  | { kind: "inline" }
  | { kind: "park"; waitingFor: number }
  | { kind: "advance"; nextStage: IngestStage; nextChunkIndex: number | null }
  | { kind: "fail"; bookMessage: string; jobMessage: string };

interface PlanJob {
  id: string;
  book_id: string;
  user_id: string;
  stage: string;
}

function isModelStage(stage: string): stage is AgentModelStage {
  return (AGENT_MODEL_STAGES as readonly string[]).includes(stage);
}

const LIVE = ["pending", "claimed", "applying"];

async function cancelLiveSteps(supabase: SupabaseClient, userId: string, bookId: string): Promise<void> {
  await supabase
    .from("agent_jobs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("subject_id", bookId)
    .eq("kind", BOOK_STAGE_JOB_KIND)
    .in("status", LIVE);
}

type Unit = { id: string };

async function listUnits(supabase: SupabaseClient, bookId: string, stage: AgentModelStage): Promise<Unit[]> {
  if (stage === "extracting_lessons") {
    const { data, error } = await supabase.from("source_chunks").select("id").eq("book_id", bookId).order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Unit[];
  }
  // verifying_grounding and generating_cards walk the same rank-ordered set of lessons merging selected.
  const { data, error } = await supabase.from("lessons").select("id").eq("book_id", bookId).not("rank", "is", null).order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Unit[];
}

/** The input of one step: the unit's own text for the agent to work on (the instructions come from the job kind, not from here). */
async function buildUnitInputs(supabase: SupabaseClient, bookId: string, stage: AgentModelStage, ids: string[]): Promise<{ unit_id: string; input: Record<string, unknown> }[]> {
  if (ids.length === 0) return [];
  if (stage === "extracting_lessons") {
    const { data: book, error: bookError } = await supabase.from("books").select("reader_source").eq("id", bookId).single();
    if (bookError) throw bookError;
    const paged = isPagedSource((book as { reader_source?: string | null } | null)?.reader_source);
    const sectionTitles = new Map<string, string>();
    if (!paged) {
      const { data: sections } = await supabase.from("book_sections").select("id, title").eq("book_id", bookId);
      for (const s of (sections ?? []) as { id: string; title: string }[]) sectionTitles.set(s.id, s.title);
    }
    const { data, error } = await supabase.from("source_chunks").select("id, text, page_start, page_end, section_id").eq("book_id", bookId).in("id", ids);
    if (error) throw error;
    const byId = new Map(((data ?? []) as { id: string; text: string; page_start: number | null; page_end: number | null; section_id: string | null }[]).map((c) => [c.id, c]));
    return ids.flatMap((id) => {
      const c = byId.get(id);
      if (!c) return [];
      const location = paged ? `page ${c.page_start ?? 0}` : c.section_id && sectionTitles.has(c.section_id) ? `section "${sectionTitles.get(c.section_id)}"` : "a passage from the text";
      return [{ unit_id: id, input: { text: c.text, location, page_start: c.page_start ?? 0, page_end: c.page_end ?? c.page_start ?? 0, source_chunk_id: c.id, paged } }];
    });
  }
  const { data, error } = await supabase.from("lessons").select("id, title, core_claim, mechanism, action_template, provenance_quote").eq("book_id", bookId).in("id", ids);
  if (error) throw error;
  const byId = new Map(((data ?? []) as { id: string; title: string; core_claim: string | null; mechanism: string | null; action_template: string | null; provenance_quote: string }[]).map((l) => [l.id, l]));
  return ids.flatMap((id) => {
    const l = byId.get(id);
    if (!l) return [];
    const lesson = { title: l.title, core_claim: l.core_claim ?? "", mechanism: l.mechanism ?? "", action_template: l.action_template ?? "", provenance_quote: l.provenance_quote };
    // `text` is what the step's size is measured by: the source quote (entailment) or the lesson's core fields (cards).
    return [{ unit_id: id, input: { text: stage === "verifying_grounding" ? l.provenance_quote : `${l.title}\n${l.core_claim ?? ""}\n${l.mechanism ?? ""}`, lesson, lesson_id: l.id } }];
  });
}

export async function planAgentStage(supabase: SupabaseClient, job: PlanJob): Promise<AgentStagePlan> {
  if (!isModelStage(job.stage)) return { kind: "inline" };
  const stage = job.stage;

  if (await hasAnyAiKey(supabase, job.user_id)) {
    // The owner's own key does the work. Steps still queued for an agent (a key was added mid-way) must not apply later on top of it.
    await cancelLiveSteps(supabase, job.user_id, job.book_id);
    return { kind: "inline" };
  }
  if (!(await hasAgentConnector(supabase, job.user_id, new Date()))) return { kind: "inline" }; // no key, no agent: the existing fail-fast no-key message

  const units = await listUnits(supabase, job.book_id, stage);

  const { data: stepRows, error: stepError } = await supabase
    .from("agent_jobs")
    .select("dedupe_key, status, error")
    .eq("user_id", job.user_id)
    .eq("subject_id", job.book_id)
    .eq("kind", BOOK_STAGE_JOB_KIND)
    .like("dedupe_key", `${job.book_id}:${stage}:%`)
    .limit(5000);
  if (stepError) throw stepError;
  const prefix = `${job.book_id}:${stage}:`;
  const byUnit = new Map<string, { status: string; error: string | null }[]>();
  for (const r of (stepRows ?? []) as { dedupe_key: string; status: string; error: string | null }[]) {
    const unit = r.dedupe_key.slice(prefix.length);
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), { status: r.status, error: r.error }]);
  }
  const statusesOf = (id: string) => byUnit.get(id) ?? [];
  const isDone = (id: string) => statusesOf(id).some((s) => s.status === "done");
  const isLive = (id: string) => statusesOf(id).some((s) => LIVE.includes(s.status));

  const remaining = units.filter((u) => !isDone(u.id));
  const doneCount = units.length - remaining.length;
  await syncAgentProgress(supabase, job.book_id, stage, doneCount, units.length);

  if (remaining.length === 0) return { kind: "advance", ...NEXT_AFTER[stage] };

  const window = remaining.slice(0, BOOK_STAGE_WINDOW);

  // A unit whose only jobs are dead cannot progress: fail the book (retryable) instead of waiting for something that will never come.
  for (const u of window) {
    if (isLive(u.id)) continue;
    const dead = statusesOf(u.id);
    if (dead.length === 0) continue;
    const failed = dead.find((s) => s.status === "failed");
    if (failed) {
      const message = agentUnitFailedMessage(failed.error);
      return { kind: "fail", bookMessage: message, jobMessage: `${stage}: your agent failed a step -- ${failed.error ?? "no reason given"}` };
    }
    if (dead.some((s) => s.status === "cancelled")) return { kind: "fail", bookMessage: AGENT_CANCELLED_MESSAGE, jobMessage: `${stage}: a step was cancelled` };
    return { kind: "fail", bookMessage: AGENT_TIMEOUT_MESSAGE, jobMessage: `${stage}: a step expired before your agent finished it` };
  }

  const missing = window.filter((u) => !isLive(u.id)).map((u) => u.id);
  if (missing.length > 0) {
    const inputs = await buildUnitInputs(supabase, job.book_id, stage, missing);
    if (inputs.length > 0) {
      const { error } = await supabase.rpc("enqueue_book_stage_jobs", { p_user_id: job.user_id, p_book_id: job.book_id, p_stage: stage, p_units: inputs });
      if (error) throw error;
    }
  }
  return { kind: "park", waitingFor: window.length };
}

/** books.progress_pct from the steps the agent has finished (never backwards, same guarded update the route's cursor sync uses). Best-effort. */
async function syncAgentProgress(supabase: SupabaseClient, bookId: string, stage: AgentModelStage, done: number, total: number): Promise<void> {
  try {
    const pct = estimateBookProgressPct(stage, done, total);
    if (pct === null) return;
    await supabase.from("books").update({ progress_pct: pct }).eq("id", bookId).lt("progress_pct", pct);
  } catch {
    // cosmetic
  }
}
