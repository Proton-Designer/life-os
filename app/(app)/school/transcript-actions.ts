"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { resolveStoredUserKey } from "@/lib/ai/resolve-key";

/**
 * Requests a transcription (or retries a failed/re-requests an existing
 * one) for a lecture recording. Thin wrapper over
 * requeue_lecture_transcription() (migration 214) -- that function is
 * security definer specifically because "reset an existing row back to
 * queued" is an UPDATE, and lecture_transcripts has no UPDATE policy for
 * `authenticated` (every status transition is worker-only); the function
 * checks ownership against lecture_recordings itself rather than relying on
 * RLS, same pattern migration 048's delete_class_assessment already uses.
 */
export async function requestTranscription(recordingId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("requeue_lecture_transcription", { p_recording_id: recordingId });
  if (error) throw error;
  revalidatePath("/school");
}

/**
 * Whether this user has a BYOK key for either provider that can transcribe
 * audio -- the panel needs this up front to show "Transcribe" vs. a clear
 * "needs a key" state, same posture as Canvas's `storageConfigured` and the
 * AI-key settings' own availability checks. Never returns the keys
 * themselves, only whether each exists.
 */
export async function getTranscriptionAvailability(): Promise<{ hasOpenAi: boolean; hasGoogle: boolean }> {
  const { supabase, userId } = await requireUser();
  const [openAiKey, googleKey] = await Promise.all([
    resolveStoredUserKey(supabase, userId, "openai"),
    resolveStoredUserKey(supabase, userId, "google"),
  ]);
  return { hasOpenAi: openAiKey !== null, hasGoogle: googleKey !== null };
}
