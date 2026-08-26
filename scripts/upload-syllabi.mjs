// Upload Ayman's five Fall 2026 syllabi into the `syllabi` bucket and point
// each classes.syllabus_path at its object.
//
//   node scripts/upload-syllabi.mjs            # dry run: what it would do
//   node scripts/upload-syllabi.mjs --execute
//
// Path layout and upload ORDER are copied deliberately from
// app/(app)/school/class-actions.ts#uploadClassSyllabus: object first,
// repoint second, delete-the-old last. A file that is already uploaded is
// skipped rather than duplicated, so this is safe to re-run.
//
// Runs as the service role (this is a maintenance script, not a request
// path), so it sets user_id explicitly on every write instead of relying on
// auth.uid(). It only ever touches the one user_id below.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";

const USER_ID = "f503c9b6-a0ad-4c4e-8af4-451fb065d61a";
const BUCKET = "syllabi";
const DOWNLOADS = "/Users/aymanmohammed/Downloads";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// code -> the file Ayman sent. PHYS 2126 (lab) has no syllabus: he said the
// five files exclude the lab classes.
const FILES = [
  { code: "CS-3345-HON",   file: "CS 3345H Fall 2026 Syllabus.pdf",                     type: PDF },
  { code: "CS-3341-HON",   file: "Prob_Stats_Syllabus.pdf",                             type: PDF },
  { code: "PHYS-2326-002", file: "Syllabus-PHYS2326.pdf",                               type: PDF },
  { code: "AMS-2341-HN1",  file: "F26 AMS 2341 CV SYLLABUS LONG.docx",                  type: DOCX },
  { code: "MATH 2418",     file: "MATH 2418 5 Linear Algebra - Simple Syllabus.pdf",    type: PDF },
];

const execute = process.argv.includes("--execute");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — source .env.local first.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Same sanitiser as class-actions.ts, so a path written here is
// indistinguishable from one written by the app.
const sanitize = (name) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

const { data: classes, error } = await supabase
  .from("classes")
  .select("id, short_name, code, syllabus_path")
  .eq("user_id", USER_ID);
if (error) throw error;

let uploaded = 0;
for (const entry of FILES) {
  const cls = classes.find((c) => c.code === entry.code);
  if (!cls) {
    console.error(`  SKIP  ${entry.code}: no classes row with that code`);
    process.exitCode = 1;
    continue;
  }
  const bytes = await readFile(`${DOWNLOADS}/${entry.file}`);
  const label = `${cls.short_name ?? cls.code} (${cls.code})`;

  if (cls.syllabus_path) {
    console.log(`  have  ${label} -> ${cls.syllabus_path}`);
    continue;
  }
  if (!execute) {
    console.log(`  would upload  ${label} <- ${basename(entry.file)} (${bytes.length} bytes)`);
    continue;
  }

  const path = `${USER_ID}/${cls.id}/${Date.now()}-${sanitize(entry.file)}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: entry.type, upsert: false });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("classes")
    .update({ syllabus_path: path })
    .eq("id", cls.id)
    .eq("user_id", USER_ID);
  if (updateError) {
    // Never leave a path referenced that the update failed to record.
    await supabase.storage.from(BUCKET).remove([path]);
    throw updateError;
  }
  console.log(`  uploaded  ${label} -> ${path}`);
  uploaded += 1;
}

console.log(execute ? `\n${uploaded} uploaded.` : "\nDRY RUN — nothing written. Re-run with --execute.");
