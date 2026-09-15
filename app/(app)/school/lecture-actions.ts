"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { untypedFrom } from "@/lib/school/untyped-from";

const LECTURES_BUCKET = "lectures";
const LECTURE_SIGNED_URL_TTL_SECONDS = 3600; // 1 hour -- longer than syllabi's 5 min: scrubbing through a recording takes longer than glancing at a PDF.

// Same sanitizer as class-actions.ts's own (private, not exported) --
// duplicated rather than imported so this file doesn't need to claim
// class-actions.ts (see CLAIMS.md); identical behavior either way.
function sanitizeFilenameSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

type LectureRecordingRow = {
  id: string;
  class_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  created_at: string;
};

/**
 * Same order-of-operations as class-actions.ts's uploadClassSyllabus:
 * upload the object FIRST, insert the row SECOND, clean up the orphaned
 * object on a row-insert failure. Unlike the syllabus (one file, repointed
 * on swap), a class can have many recordings, so this always inserts a new
 * row rather than repointing an existing one -- there's nothing to remove
 * on success.
 */
export async function uploadLectureRecording(classId: string, formData: FormData) {
  const { supabase, userId } = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided");

  const path = `${userId}/${classId}/${Date.now()}-${sanitizeFilenameSegment(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(LECTURES_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { error: insertError } = await untypedFrom(supabase, "lecture_recordings").insert({
    user_id: userId,
    class_id: classId,
    storage_path: path,
    original_filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  });
  if (insertError) {
    // The row never landed -- clean up the just-uploaded orphan rather than
    // leave it consuming storage with nothing referencing it.
    await supabase.storage.from(LECTURES_BUCKET).remove([path]);
    throw insertError;
  }

  revalidatePath("/school");
}

export async function removeLectureRecording(recordingId: string) {
  const { supabase, userId } = await requireUser();
  const { data: existing, error: fetchError } = await untypedFrom(supabase, "lecture_recordings")
    .select("storage_path")
    .eq("id", recordingId)
    .eq("user_id", userId)
    .single()
    .returns<{ storage_path: string }>();
  if (fetchError) throw fetchError;

  const { error: deleteError } = await untypedFrom(supabase, "lecture_recordings")
    .delete()
    .eq("id", recordingId)
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  // Best-effort: the row is already gone from the user's point of view by
  // this point, so a failure here is an orphaned storage object, not lost
  // data -- same reasoning as removeClassSyllabus.
  await supabase.storage.from(LECTURES_BUCKET).remove([existing.storage_path]);
  revalidatePath("/school");
}

/**
 * Mints a fresh, short-lived signed URL on every call -- never stored, never
 * cached across requests. The bucket is private; this is the only way to
 * ever read a recording object. Returns null when the recording isn't found
 * (already removed, or not owned by the caller) so the panel can show a
 * "no longer available" state instead of throwing on a stale row.
 */
export async function getLectureRecordingUrl(recordingId: string): Promise<{ url: string; mimeType: string } | null> {
  const { supabase, userId } = await requireUser();
  const { data: row, error: fetchError } = await untypedFrom(supabase, "lecture_recordings")
    .select("storage_path, mime_type")
    .eq("id", recordingId)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<{ storage_path: string; mime_type: string } | null>();
  if (fetchError) throw fetchError;
  if (!row) return null;

  const { data, error: signError } = await supabase.storage
    .from(LECTURES_BUCKET)
    .createSignedUrl(row.storage_path, LECTURE_SIGNED_URL_TTL_SECONDS);
  if (signError) throw signError;

  return { url: data.signedUrl, mimeType: row.mime_type };
}

export type { LectureRecordingRow };
