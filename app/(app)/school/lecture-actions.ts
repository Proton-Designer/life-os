"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";

const LECTURES_BUCKET = "lectures";
const LECTURE_SIGNED_URL_TTL_SECONDS = 3600; // 1 hour -- longer than syllabi's 5 min: scrubbing through a recording takes longer than glancing at a PDF.

// Keep in sync with migration 211's bucket file_size_limit/allowed_mime_types
// -- the bucket itself is the real enforcement (Storage rejects the raw PUT
// server-side, can't be bypassed by a client that skips this action), this
// is a cheap up-front check so prepareLectureUpload can reject before ever
// minting a signed upload URL for a request that's going to fail anyway.
const LECTURE_MAX_SIZE_BYTES = 524288000; // 500 MiB
const LECTURE_ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
]);

// Same sanitizer as class-actions.ts's own (private, not exported) --
// duplicated rather than imported so this file doesn't need to claim
// class-actions.ts (see CLAIMS.md); identical behavior either way.
function sanitizeFilenameSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * Step 1 of 2 (a9 review, P3-14): a Server Action's own request body is
 * capped well below any real lecture recording (Next's default
 * serverActions.bodySizeLimit is 1MB; Vercel caps request bodies at 4.5MB
 * regardless) -- so the audio bytes themselves never pass through a Server
 * Action at all. This mints a signed UPLOAD url; the browser uploads
 * straight to Storage (see lecture-panel.tsx), then calls
 * finalizeLectureUpload below once that succeeds.
 *
 * Validates class ownership and the client-declared mime/size against the
 * bucket's own allowlist before minting anything -- a cheap reject now
 * beats letting the browser spend minutes uploading a file Storage was
 * always going to refuse.
 */
export async function prepareLectureUpload(
  classId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number
): Promise<{ path: string; token: string }> {
  const { supabase, userId } = await requireUser();

  const { error: classError } = await supabase
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("user_id", userId)
    .single();
  if (classError) throw new Error("Class not found");

  if (!LECTURE_ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType || "unknown"}`);
  }
  if (!(sizeBytes > 0) || sizeBytes > LECTURE_MAX_SIZE_BYTES) {
    throw new Error("File is too large");
  }

  const path = `${userId}/${classId}/${Date.now()}-${sanitizeFilenameSegment(filename)}`;
  const { data, error } = await supabase.storage.from(LECTURES_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;

  return { path, token: data.token };
}

/**
 * Step 2 of 2: called after the browser's own direct-to-Storage upload
 * succeeds. Never trusts anything the client claims about what it uploaded
 * -- re-reads the real object from Storage (list, not the client's File
 * object) for its actual size/mime, and independently re-checks the path's
 * <user_id>/<class_id>/ prefix against THIS request's own authenticated
 * userId/classId. That second check is load-bearing, not redundant with
 * prepareLectureUpload: prepareLectureUpload builds the path from the
 * server's own auth context, but `path` arrives here as a plain client-
 * supplied string with no guarantee it's the same one this session was
 * ever issued -- rejecting a mismatch is what stops a caller from
 * finalizing a row against an object under someone else's folder.
 */
export async function finalizeLectureUpload(classId: string, path: string) {
  const { supabase, userId } = await requireUser();

  const expectedPrefix = `${userId}/${classId}/`;
  if (!path.startsWith(expectedPrefix)) {
    throw new Error("Path does not belong to this user/class");
  }

  const lastSlash = path.lastIndexOf("/");
  const dir = path.slice(0, lastSlash);
  const filename = path.slice(lastSlash + 1);
  const { data: listing, error: listError } = await supabase.storage.from(LECTURES_BUCKET).list(dir, { search: filename });
  if (listError) throw listError;
  const object = listing?.find((f) => f.name === filename);
  if (!object) throw new Error("Upload not found -- it may have failed or expired");

  const metadata = object.metadata as { size?: number; mimetype?: string } | null;
  const sizeBytes = metadata?.size ?? 0;
  const mimeType = metadata?.mimetype ?? "application/octet-stream";
  // Belt-and-suspenders on top of the bucket's own file_size_limit/
  // allowed_mime_types (which already gate what CAN exist at this path) --
  // cheap, and doesn't assume the bucket's config can never drift from
  // this file's constants.
  if (!LECTURE_ALLOWED_MIME_TYPES.has(mimeType) || sizeBytes <= 0 || sizeBytes > LECTURE_MAX_SIZE_BYTES) {
    await supabase.storage.from(LECTURES_BUCKET).remove([path]);
    throw new Error("Uploaded file failed validation");
  }

  const originalFilename = filename.replace(/^\d+-/, "");

  const { error: insertError } = await supabase.from("lecture_recordings").insert({
    user_id: userId,
    class_id: classId,
    storage_path: path,
    original_filename: originalFilename,
    mime_type: mimeType,
    size_bytes: sizeBytes,
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
  const { data: existing, error: fetchError } = await supabase
    .from("lecture_recordings")
    .select("storage_path")
    .eq("id", recordingId)
    .eq("user_id", userId)
    .single();
  if (fetchError) throw fetchError;

  const { error: deleteError } = await supabase.from("lecture_recordings").delete().eq("id", recordingId).eq("user_id", userId);
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
  const { data: row, error: fetchError } = await supabase
    .from("lecture_recordings")
    .select("storage_path, mime_type")
    .eq("id", recordingId)
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!row) return null;

  const { data, error: signError } = await supabase.storage
    .from(LECTURES_BUCKET)
    .createSignedUrl(row.storage_path, LECTURE_SIGNED_URL_TTL_SECONDS);
  if (signError) throw signError;

  return { url: data.signedUrl, mimeType: row.mime_type };
}
