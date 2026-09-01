"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { untypedFrom } from "@/lib/self-mastery/untyped-from";
import { isIngestionAvailable, INGESTION_UNAVAILABLE_MESSAGE } from "@/lib/self-mastery/ingestion-availability";

/**
 * The provenance drill-down's second block ("In context, from the book") —
 * live-fetched on open, never preloaded with the lesson list. Mirrors
 * ULM's own fetchSourceChunkText exactly: one column, one row, nothing
 * else about the chunk (embedding, token_count) leaves the server.
 */
export async function fetchSourceChunkText(sourceChunkId: string): Promise<string | null> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await untypedFrom(supabase, "source_chunks")
    .select("text")
    .eq("id", sourceChunkId)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<{ text: string } | null>();
  if (error) throw error;
  return data?.text ?? null;
}

export interface UploadBookResult {
  ok: true;
  bookId: string;
}
export interface UploadBookError {
  ok: false;
  message: string;
}

const BOOKS_BUCKET = "books";
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB, matching ULM's own limit
const GENERIC_UPLOAD_ERROR = "Something went wrong uploading that file. Please try again.";

function validateBookFile(file: File): string | null {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "That doesn't look like a PDF. Please choose a .pdf file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `That file is too large (${Math.round(file.size / (1024 * 1024))}MB, max 200MB).`;
  }
  return null;
}

/**
 * Creates the `books` row, uploads the PDF to storage, then enqueues an
 * `ingestion_jobs` row for the worker — same three-step shape as ULM's
 * createBookAndUploadJob. Requires the `books` storage bucket to actually
 * exist (it does not yet in the scratch DB as of this writing — flagged to
 * the Lead separately; this function is correct against the schema, but
 * the upload step will fail until the bucket is provisioned).
 */
export async function uploadBook(formData: FormData): Promise<UploadBookResult | UploadBookError> {
  // Refuse on the SERVER, not only by hiding the button. Without a worker to
  // consume `ingestion_jobs`, a successful upload strands the book at
  // "processing" forever with no failure path — so accepting the file is the
  // harm, and a hidden trigger is not a guard. See
  // lib/self-mastery/ingestion-availability.ts.
  if (!isIngestionAvailable()) return { ok: false, message: INGESTION_UNAVAILABLE_MESSAGE };

  const file = formData.get("file");
  const title = String(formData.get("title") ?? "").trim();
  const author = String(formData.get("author") ?? "").trim();

  if (!(file instanceof File)) return { ok: false, message: "No file provided" };
  const validationError = validateBookFile(file);
  if (validationError) return { ok: false, message: validationError };
  if (!title) return { ok: false, message: "Give this book a title." };

  const { supabase, userId } = await requireUser();

  const { data: inserted, error: insertError } = await untypedFrom(supabase, "books")
    .insert({
      user_id: userId,
      title,
      author: author || null,
      status: "uploading",
      stage: "queued",
      progress_pct: 0,
      file_size_bytes: file.size,
    })
    .select("id")
    .single()
    .returns<{ id: string }>();
  if (insertError) return { ok: false, message: GENERIC_UPLOAD_ERROR };

  const bookId = inserted.id;
  const path = `${userId}/${bookId}.pdf`;

  const { error: uploadError } = await supabase.storage.from(BOOKS_BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) {
    await untypedFrom(supabase, "books").delete().eq("id", bookId);
    return { ok: false, message: GENERIC_UPLOAD_ERROR };
  }

  const { error: updateError } = await untypedFrom(supabase, "books")
    .update({ file_path: path, status: "processing" })
    .eq("id", bookId);
  if (updateError) return { ok: false, message: GENERIC_UPLOAD_ERROR };

  const { error: jobError } = await untypedFrom(supabase, "ingestion_jobs").insert({
    book_id: bookId,
    user_id: userId,
    stage: "queued",
  });
  if (jobError) return { ok: false, message: GENERIC_UPLOAD_ERROR };

  revalidatePath("/personal/self_mastery");
  revalidatePath("/");
  return { ok: true, bookId };
}
