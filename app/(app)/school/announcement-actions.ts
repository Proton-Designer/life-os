"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { stageAnnouncementCore, type StageAnnouncementOutcome } from "@/lib/school/announcement-extraction-core";

/**
 * P2-07 — pasted announcement → AI parse → staged diff, the action-layer
 * wiring. Parallel to syllabus-extraction-actions.ts, minus the PDF-parsing
 * step (plain pasted text, no file).
 *
 * P2-21: the actual "parse then stage" logic moved to
 * lib/school/announcement-extraction-core.ts's `stageAnnouncementCore` (R5
 * extraction) — the new Canvas announcement poller needs the identical
 * step, looped over many users with a service-role client and no session.
 * This function is now a thin wrapper: resolve the cookie-authed user/
 * timezone, call the core, revalidate. Behavior unchanged.
 */

export type AnnouncementExtractionOutcome = StageAnnouncementOutcome;

export async function extractAnnouncementDeliverables(classId: string, announcementText: string): Promise<AnnouncementExtractionOutcome> {
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);

  const result = await stageAnnouncementCore(supabase, userId, classId, announcementText, todayStr);
  if (result.outcome === "extracted") revalidatePath("/school");
  return result;
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
