/**
 * PHASE 1 -- REAL BOOK UPLOAD INTO THE NEW TEST ACCOUNT.
 *
 * Replicates app/(app)/personal/self-mastery-actions.ts's `uploadBook`
 * server action step for step (same three inserts/uploads, same bucket,
 * same path shape, same trigger-derived user_id) -- NOT calling that
 * function directly, since it depends on a real Next.js request
 * (`requireUser()`'s cookie-based session, `revalidatePath`, FormData) that
 * doesn't exist outside a running server. This script is the same DB/
 * Storage operations, driven directly, so the resulting book row is
 * genuinely indistinguishable from one the real upload flow would have
 * produced -- not a fixture.
 *
 * `books.user_id` is trigger-derived from `auth.uid()`
 * (set_user_id_from_caller, migration 061) and RAISES if auth.uid() is
 * null -- service_role's auth.uid() IS null, so this insert must run as a
 * genuinely signed-in user (same reason scripts/item7-run.ts signs in
 * before its own books insert). ingestion_jobs' own user_id is
 * book-derived (set_user_id_from_book) so service_role is fine there.
 *
 * Usage: npx tsx scripts/ingest-bootstrap-book.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import type { Database } from "../lib/supabase/database.types";

const TEST_EMAIL = "ulm-demo@lifeos.test";
const TEST_PASSWORD = "ULMdemo2026!";
const PDF_PATH = `${process.env.HOME}/mnt/Downloads/_OceanofPDF.com_Actionable_Gamification_-_Yu-kai_Chou.pdf`;
const BOOK_TITLE = "Actionable Gamification";
const BOOK_AUTHOR = "Yu-kai Chou";
const BOOKS_BUCKET = "books";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`ingest-bootstrap-book: missing required env var ${name}`);
  return v;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceRole = createClient<Database>(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log(`[ingest-bootstrap-book] starting ${new Date().toISOString()}`);

  // Refuse to double-upload if this account already has a book with this title.
  const { data: existingUser } = await serviceRole.auth.admin.listUsers({ perPage: 200 });
  const account = existingUser?.users.find((u) => u.email === TEST_EMAIL);
  if (!account) throw new Error(`ingest-bootstrap-book: ${TEST_EMAIL} does not exist -- run bootstrap-test-account.ts first`);
  const userId = account.id;

  const { data: existingBooks } = await serviceRole.from("books").select("id, title").eq("user_id", userId);
  const dup = existingBooks?.find((b) => b.title === BOOK_TITLE);
  if (dup) {
    const { data: job } = await serviceRole.from("ingestion_jobs").select("id, stage").eq("book_id", dup.id).maybeSingle();
    console.log(`[ingest-bootstrap-book] book "${BOOK_TITLE}" already exists (id=${dup.id}), ingestion_jobs stage=${job?.stage ?? "none"} -- not re-uploading.`);
    console.log(JSON.stringify({ userId, bookId: dup.id, jobId: job?.id ?? null }, null, 2));
    return;
  }

  // Real, signed-in session -- required for the books insert's trigger.
  const anon = createClient<Database>(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (signInError || !signInData.session) throw new Error(`ingest-bootstrap-book: sign-in failed: ${signInError?.message}`);
  const asUser = createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${signInData.session.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- 1. books row (as the real user, status "uploading" then "processing" -- same two-step
  // the real action uses, since file_path isn't known until after the Storage upload) ---
  const fileBytes = await readFile(PDF_PATH);
  const { data: inserted, error: insertError } = await asUser
    .from("books")
    .insert({
      user_id: userId,
      title: BOOK_TITLE,
      author: BOOK_AUTHOR,
      status: "uploading",
      stage: "queued",
      progress_pct: 0,
      file_size_bytes: fileBytes.length,
    })
    .select("id")
    .single();
  if (insertError || !inserted) throw new Error(`ingest-bootstrap-book: books insert failed: ${insertError?.message}`);
  const bookId = inserted.id;
  console.log(`[ingest-bootstrap-book] created book ${bookId} ("${BOOK_TITLE}" by ${BOOK_AUTHOR}), ${fileBytes.length} bytes`);

  // --- 2. Real Storage upload, same bucket + path shape as the real action ---
  const path = `${userId}/${bookId}.pdf`;
  const { error: uploadError } = await asUser.storage.from(BOOKS_BUCKET).upload(path, fileBytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) {
    await asUser.from("books").delete().eq("id", bookId);
    throw new Error(`ingest-bootstrap-book: storage upload failed (book row rolled back): ${uploadError.message}`);
  }
  console.log(`[ingest-bootstrap-book] uploaded PDF to ${BOOKS_BUCKET}/${path}`);

  // --- 3. Flip to processing once the file is really in Storage ---
  const { error: updateError } = await asUser.from("books").update({ file_path: path, status: "processing" }).eq("id", bookId);
  if (updateError) throw new Error(`ingest-bootstrap-book: books update failed: ${updateError.message}`);

  // --- 4. ingestion_jobs row -- service_role fine here, user_id is book-derived ---
  const { data: job, error: jobError } = await serviceRole
    .from("ingestion_jobs")
    .insert({ book_id: bookId, user_id: userId, stage: "queued" })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`ingest-bootstrap-book: ingestion_jobs insert failed: ${jobError?.message}`);
  console.log(`[ingest-bootstrap-book] created ingestion_jobs ${job.id}, stage=queued`);

  console.log("\n=== BOOK BOOTSTRAPPED ===");
  console.log(JSON.stringify({ userId, bookId, jobId: job.id }, null, 2));
}

main().catch((err) => {
  console.error("[ingest-bootstrap-book] FAILED:", err);
  process.exit(1);
});
