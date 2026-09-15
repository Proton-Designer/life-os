"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { extractDeliverablesFromAnnouncementText } from "@/lib/school/announcement-extraction";
import { createStagingBatchCore, createStagedDeliverablesCore } from "@/lib/school/staging-core";

/**
 * P2-07 — pasted announcement → AI parse → staged diff, the action-layer
 * wiring. Parallel to syllabus-extraction-actions.ts, minus the PDF-parsing
 * step (plain pasted text, no file). A `staging_batches` row is created ONLY
 * once extraction actually runs and produces a result — same rule that
 * file's own header states, same reason: a paste too short to bother with,
 * or an AI call that never ran, leaves no batch and no history row behind.
 */

export type AnnouncementExtractionOutcome =
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

export async function extractAnnouncementDeliverables(classId: string, announcementText: string): Promise<AnnouncementExtractionOutcome> {
  const { supabase, userId } = await requireUser();

  const trimmed = announcementText.trim();
  if (trimmed.length < MIN_ANNOUNCEMENT_LENGTH) {
    return { outcome: "too_short" };
  }

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);

  const result = await extractDeliverablesFromAnnouncementText(supabase, userId, trimmed, todayStr);
  if (result.status !== "extracted") {
    return { outcome: result.status };
  }

  const batchId = await createStagingBatchCore(supabase, userId, classId, "announcement", trimmed.slice(0, MAX_STORED_RAW_TEXT_LENGTH));
  await createStagedDeliverablesCore(supabase, userId, batchId, result.items);

  revalidatePath("/school");
  return { outcome: "extracted", batchId, itemCount: result.items.length, truncated: result.truncated };
}

export interface AnnouncementHistoryEntry {
  id: string;
  rawText: string | null;
  status: string;
  itemCount: number;
  createdAt: string;
}

/** Per-course announcement history (the acceptance criteria's own words) —
 * every announcement batch ever parsed for this class, most recent first,
 * with the count of staged deliverables it currently carries (the accepted
 * set once confirmed, the proposed set while still pending/confirming —
 * rejected items are plain deletes, per staging-core.ts's own convention,
 * so they never inflate this count). */
export async function getAnnouncementHistory(classId: string): Promise<AnnouncementHistoryEntry[]> {
  const { supabase, userId } = await requireUser();

  const { data: batches, error: batchError } = await supabase
    .from("staging_batches")
    .select("id, raw_text, status, created_at")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .eq("source", "announcement")
    .order("created_at", { ascending: false });
  if (batchError) throw batchError;

  const rows = batches ?? [];
  if (rows.length === 0) return [];

  const batchIds = rows.map((b) => b.id);
  const { data: deliverableRows, error: deliverableError } = await supabase
    .from("staged_deliverables")
    .select("batch_id")
    .eq("user_id", userId)
    .in("batch_id", batchIds);
  if (deliverableError) throw deliverableError;

  const countByBatch = new Map<string, number>();
  for (const d of deliverableRows ?? []) {
    countByBatch.set(d.batch_id, (countByBatch.get(d.batch_id) ?? 0) + 1);
  }

  return rows.map((b) => ({
    id: b.id,
    rawText: b.raw_text,
    status: b.status,
    itemCount: countByBatch.get(b.id) ?? 0,
    createdAt: b.created_at,
  }));
}
