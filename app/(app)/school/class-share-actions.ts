"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import {
  createClassShareCore,
  revokeClassShareCore,
  getClassShareStatusCore,
  getSharePreviewCore,
  type ClassShareStatus,
  type PublicQuestionBank,
} from "@/lib/school/class-share-core";

/**
 * P3-08 — cookie-coupled Server Action layer over lib/school/class-share-core.ts,
 * same split as question-actions.ts over questions-core.ts: requireUser()
 * lives here, the actual writes there. Every function takes only a
 * `classId` and relies on the AUTHENTICATED client + migration 203's
 * composite FK for ownership — none of these trust the id on their own.
 */

/** Returns the raw token ONCE. Never callable again for the same share — see class-share-core.ts's own header. */
export async function createClassShare(classId: string): Promise<{ rawToken: string } | { error: string }> {
  const { supabase, userId } = await requireUser();
  try {
    const result = await createClassShareCore(supabase, userId, classId);
    revalidatePath("/school");
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't create a share link" };
  }
}

export async function revokeClassShare(classId: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await revokeClassShareCore(supabase, userId, classId);
  revalidatePath("/school");
}

/** Read-only: active/createdAt, never a token. */
export async function getClassShareStatus(classId: string): Promise<ClassShareStatus> {
  const { supabase, userId } = await requireUser();
  return getClassShareStatusCore(supabase, userId, classId);
}

/** The owner's own "here is exactly what becomes public" preview, before or after sharing. */
export async function getSharePreview(classId: string): Promise<PublicQuestionBank> {
  const { supabase, userId } = await requireUser();
  return getSharePreviewCore(supabase, userId, classId);
}
