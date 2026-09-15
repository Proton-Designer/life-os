import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { resolveStoredUserKey } from "@/lib/ai/resolve-key";
import { checkTranscriptionSpendCap } from "@/lib/ai/transcription-spend";
import { computeActualTranscriptionCostUsd } from "@/lib/ai/transcription-pricing";
import { transcribeWithOpenAI, transcribeWithGemini, OPENAI_MAX_FILE_SIZE_BYTES, type TranscriptionClientResult } from "@/lib/ai/transcription";
import { recordUsage } from "@/lib/ai/usage-log";

// Must match app/api/cron/lecture-transcription/route.ts's own `maxDuration`
// route-segment config -- this is the SAME 280s Vercel enforces on the whole
// function, referenced here so Gemini's own internal timeout can be derived
// from it (tracking-app-a9 review). SAFETY_BUFFER_MS reserves time after
// generateContent returns for the completion/failure DB write and
// recordUsage() -- without it, a generateContent call that used its full
// budget would leave no time to write the result before Vercel's own kill.
const FUNCTION_MAX_DURATION_MS = 280_000;
const SAFETY_BUFFER_MS = 30_000;
// Below this much remaining budget, don't even attempt the call -- a doomed
// attempt that Vercel kills before our own abort fires is exactly the stuck-
// 'processing'-row-that-gets-reclaimed-and-rebilled scenario this whole fix
// exists to avoid.
const MIN_VIABLE_GEMINI_TIMEOUT_MS = 20_000;

/**
 * Core cron-worker logic for P3-15 (lecture transcription). Called by
 * app/api/cron/lecture-transcription/route.ts, once per invocation. Takes a
 * SERVICE-ROLE client (lib/supabase/service-role.ts) -- there is no signed-in
 * user in a cron context, and this needs to read/write across every user's
 * rows, not just one.
 *
 * BYOK DISCIPLINE: resolves keys via `resolveStoredUserKey` ONLY, never
 * `resolveApiKey`/`resolveApiKeyWithSource` (both fall through to a shared,
 * allowlisted server key). Transcription is a completely different provider
 * family (OpenAI/Gemini) from the shared DeepSeek-only server key -- this
 * feature must never draw on that balance for a user who has no key of
 * their own; it must simply be unavailable to them, same as every other
 * BYOK feature in this codebase.
 */
export type ProcessJobResult =
  | { processed: false }
  | { processed: true; status: "completed"; recordingId: string }
  | { processed: true; status: "failed"; recordingId: string; reason: string };

export async function processOneTranscriptionJob(serviceClient: SupabaseClient<Database>): Promise<ProcessJobResult> {
  const startedAt = Date.now();
  const { data: job, error: claimError } = await serviceClient.rpc("claim_lecture_transcription_job");
  if (claimError) throw claimError;
  if (!job) return { processed: false };
  // claim_lecture_transcription_job() (migration 214) always stamps
  // claimed_at when it hands back a row -- a null here would mean the
  // claim function's own contract broke, not a normal case to route around.
  if (!job.claimed_at) throw new Error(`Claimed lecture_transcripts ${job.id} with no claimed_at -- claim function contract violated.`);
  const claimedAt = job.claimed_at;

  /**
   * Compare-and-set on `status = 'processing'` AND the exact `claimed_at`
   * this worker itself was handed (tracking-app-a9 review): between this
   * claim and this write, claim_lecture_transcription_job() could have
   * reclaimed the SAME row (this worker crashed/timed out from the DB's
   * point of view even though it's still running) or a user could have
   * requeued it once it went stale. 0 rows affected means this write lost
   * that race -- discard it rather than overwrite whatever the reclaiming
   * worker (or the fresh queued attempt) is doing.
   */
  async function fail(reason: string): Promise<ProcessJobResult> {
    const { data, error } = await serviceClient
      .from("lecture_transcripts")
      .update({ status: "failed", error_message: reason })
      .eq("id", job!.id)
      .eq("status", "processing")
      .eq("claimed_at", claimedAt)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      console.warn(`lecture_transcripts ${job!.id}: failure write discarded -- job was reclaimed before it landed.`);
    }
    return { processed: true, status: "failed", recordingId: job!.recording_id, reason };
  }

  const { data: recording, error: recordingError } = await serviceClient
    .from("lecture_recordings")
    .select("user_id, storage_path, size_bytes")
    .eq("id", job.recording_id)
    .maybeSingle();
  if (recordingError) throw recordingError;
  if (!recording) return fail("The recording this transcript was requested for no longer exists.");

  const [openAiKey, googleKey] = await Promise.all([
    resolveStoredUserKey(serviceClient, recording.user_id, "openai"),
    resolveStoredUserKey(serviceClient, recording.user_id, "google"),
  ]);

  // Prefer OpenAI when the file fits its request-size limit and the user
  // has a key for it; Gemini's Files API handles anything larger.
  const provider: "openai" | "google" | null =
    openAiKey && recording.size_bytes <= OPENAI_MAX_FILE_SIZE_BYTES
      ? "openai"
      : googleKey
        ? "google"
        : openAiKey
          ? "openai" // has an OpenAI key but the file is too big and no Gemini key -- OpenAI will reject it, but that's a clearer error than "no key" when a key does exist
          : null;

  if (!provider) {
    return fail("Needs an OpenAI or Gemini key in Settings to transcribe.");
  }
  if (provider === "openai" && recording.size_bytes > OPENAI_MAX_FILE_SIZE_BYTES) {
    return fail("This recording is too large for OpenAI's transcription API (25MB limit) -- add a Gemini key to transcribe it.");
  }

  const apiKey = provider === "openai" ? openAiKey! : googleKey!;

  const spendCheck = await checkTranscriptionSpendCap(serviceClient, recording.user_id, provider, recording.size_bytes);
  if (!spendCheck.allowed) {
    return fail(spendCheck.reason);
  }

  const { data: audioBlob, error: downloadError } = await serviceClient.storage.from("lectures").download(recording.storage_path);
  if (downloadError || !audioBlob) {
    return fail("Couldn't read the audio file from storage.");
  }
  const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());

  // Only meaningful for the Gemini path -- see this constant's own header
  // and transcribeWithGemini's own doc comment (lib/ai/transcription.ts).
  const elapsedMs = Date.now() - startedAt;
  const geminiTimeoutMs = FUNCTION_MAX_DURATION_MS - elapsedMs - SAFETY_BUFFER_MS;
  if (provider === "google" && geminiTimeoutMs < MIN_VIABLE_GEMINI_TIMEOUT_MS) {
    return fail("Not enough time left in this run to transcribe -- try again.");
  }

  // Defense-in-depth (tracking-app-a9 review): transcribeWithOpenAI/
  // transcribeWithGemini are designed to never throw (they catch
  // internally), but if something unexpected still does -- a bug, a truly
  // unhandled rejection -- it must become a clean, terminal fail() write
  // through the same CAS path as every other failure, not an uncaught
  // exception that crashes this invocation and leaves the row stuck in
  // 'processing' for the stuck-job reclaim to retry (and potentially
  // re-bill) later. Scoped to ONLY the provider call -- a DB error below
  // this block still throws and crashes the invocation loudly, which is
  // correct for an unexpected DB failure.
  let result: TranscriptionClientResult;
  try {
    result =
      provider === "openai"
        ? await transcribeWithOpenAI(apiKey, audioBytes, recording.storage_path.split("/").pop() ?? "recording", audioBlob.type)
        : await transcribeWithGemini(apiKey, audioBytes, audioBlob.type, geminiTimeoutMs);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Transcription failed unexpectedly.");
  }

  if (!result.ok) {
    return fail(result.message);
  }

  // Gemini doesn't reliably report real duration (lib/ai/transcription.ts's
  // own header) -- fall back to the same worst-case size estimate used for
  // the pre-flight gate rather than leaving cost unaccounted for.
  const durationSeconds = result.data.durationSeconds ?? (recording.size_bytes * 8) / (64 * 1000);
  const costUsd = computeActualTranscriptionCostUsd(provider, durationSeconds);

  // Same compare-and-set discipline as fail() above.
  const { data: completedRows, error: completeError } = await serviceClient
    .from("lecture_transcripts")
    .update({
      status: "completed",
      provider,
      transcript_text: result.data.text,
      duration_seconds: durationSeconds,
      cost_usd: costUsd,
      error_message: null,
    })
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("claimed_at", claimedAt)
    .select("id");
  if (completeError) throw completeError;
  if (!completedRows || completedRows.length === 0) {
    console.warn(`lecture_transcripts ${job.id}: completion write discarded -- job was reclaimed before it landed.`);
  }

  // recordUsage runs regardless of whether the DB write above won its race:
  // the provider call genuinely happened and genuinely cost real money
  // either way -- the spend log must never silently drop a real cost just
  // because a different write won the row-update race.
  await recordUsage({
    userId: recording.user_id,
    feature: "lecture_transcription",
    provider,
    model: provider === "openai" ? "whisper-1" : "gemini",
    keySource: "user",
    promptText: `lecture_recording:${job.recording_id}`,
    tokens: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
    costUsd,
    succeeded: true,
    retryCount: 0,
  });

  return { processed: true, status: "completed", recordingId: job.recording_id };
}
