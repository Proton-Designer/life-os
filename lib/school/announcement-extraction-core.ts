import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractDeliverablesFromAnnouncementText } from "@/lib/school/announcement-extraction";
import { createStagingBatchCore, createStagedDeliverablesCore, type StagingBatchSource } from "@/lib/school/staging-core";

/**
 * P2-21 — extracted from app/(app)/school/announcement-actions.ts's own
 * `extractAnnouncementDeliverables` (minus its `requireUser()`/
 * `getProfile()` calls), so BOTH the cookie-authed paste-an-announcement
 * Server Action AND the new Canvas announcement poller
 * (lib/canvas/sync-core.ts), which loops over many users with a
 * service-role client and no session, share the exact same "parse then
 * stage" step — R5 extraction, same reasoning every other domain's core
 * got extracted for tonight.
 *
 * `canvasAnnouncementId` (P2-21, optional): threaded straight into
 * `createStagingBatchCore`, migration 189's own dedup marker. Undefined
 * for a manually-pasted announcement (unchanged from before this
 * extraction); set by the poller so a re-poll of the same Canvas
 * announcement is a true INSERT...ON CONFLICT DO NOTHING no-op at the
 * database level, never a second staged batch spending a second LLM call.
 */

export type StageAnnouncementOutcome =
  | { outcome: "extracted"; batchId: string; itemCount: number; truncated: boolean }
  | { outcome: "too_short" }
  | { outcome: "no_key" }
  | { outcome: "unavailable" }
  | { outcome: "parse_failed" };

/** Below this, a paste is almost certainly not a real announcement ("ok" /
 * accidental submit) — deciding this before ever calling the gateway means
 * a near-empty paste never spends a call or leaves a history row. */
const MIN_ANNOUNCEMENT_LENGTH = 10;
/** Matches migration 184's own `staging_batches_raw_text_length` CHECK — the
 * insert below would fail the CHECK past this anyway; trimming here first
 * gives a clean "was it stored" invariant rather than relying on the DB to
 * reject an over-long write after the AI call already ran. */
const MAX_STORED_RAW_TEXT_LENGTH = 10_000;

export async function stageAnnouncementCore(
  supabase: SupabaseClient,
  userId: string,
  classId: string,
  announcementText: string,
  todayStr: string,
  canvasAnnouncementId?: string,
): Promise<StageAnnouncementOutcome> {
  const trimmed = announcementText.trim();
  if (trimmed.length < MIN_ANNOUNCEMENT_LENGTH) {
    return { outcome: "too_short" };
  }

  const result = await extractDeliverablesFromAnnouncementText(supabase, userId, trimmed, todayStr);
  if (result.status !== "extracted") {
    return { outcome: result.status };
  }

  const source: StagingBatchSource = "announcement";
  const batchId = await createStagingBatchCore(supabase, userId, classId, source, trimmed.slice(0, MAX_STORED_RAW_TEXT_LENGTH), canvasAnnouncementId);
  await createStagedDeliverablesCore(supabase, userId, batchId, result.items);

  return { outcome: "extracted", batchId, itemCount: result.items.length, truncated: result.truncated };
}
