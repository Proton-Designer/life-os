/**
 * E2E-01: idempotent fixture seeder for the e2e SEED account, seed-legacy@lifeos.test
 * (legacy mode, created EMPTY). The old SEED had six classes with positions and two syllabi; the
 * school specs (school-class-view, layout-overflow /school) depend on them.
 *
 * SAFETY: service role, but it ONLY ever touches the one account whose auth email is exactly
 * SEED_EMAIL. The email is a constant, not an input: any other value on the command line is
 * refused, and the account is looked up by email, never by a guessed id. It creates nothing else
 * (no auth user, no profile), so a missing account is an error, not something it papers over.
 *
 * Idempotent: classes are matched on (user_id, code) and updated in place; each syllabus lives at
 * a fixed storage path and is upserted. Re-running changes nothing.
 *
 * Usage (lead runs this, never an engineer against prod): npx tsx scripts/seed-e2e-legacy.ts
 * Reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import { config as loadEnv } from "dotenv";
import JSZip from "jszip";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SEED_EMAIL = "seed-legacy@lifeos.test";

/** Ayman's requested card order (e2e/school-class-view.spec.ts CLASS_ORDER); position follows it. */
export const SEED_CLASSES: ReadonlyArray<{
  shortName: string;
  code: string;
  room: string;
  instructor: string;
  syllabus: "pdf" | "docx" | null;
}> = [
  { shortName: "Prob & Stats", code: "MATH 3341", room: "SCI 101", instructor: "Dr. Fixture", syllabus: null },
  { shortName: "DSA", code: "CSCE 3110", room: "ENG 210", instructor: "Dr. Fixture", syllabus: "pdf" },
  // The class-view spec reads /MATH 2418/ off this class's details.
  { shortName: "Lin Alg", code: "MATH 2418", room: "SCI 204", instructor: "Dr. Fixture", syllabus: null },
  { shortName: "Ameri Studies", code: "AMST 2301", room: "LIB 12", instructor: "Dr. Fixture", syllabus: "docx" },
  { shortName: "Phys", code: "PHYS 2325", room: "SCI 310", instructor: "Dr. Fixture", syllabus: null },
  { shortName: "Phys Lab", code: "PHYS 2125", room: "SCI 312", instructor: "Dr. Fixture", syllabus: null },
];

/** Refuses anything but the one allowed account. Exported so it can be tested. */
export function assertSeedEmail(email: string | undefined | null): void {
  if (email !== SEED_EMAIL) {
    throw new Error(`seed-e2e-legacy only ever touches ${SEED_EMAIL}; refusing "${email ?? ""}"`);
  }
}

/** A tiny but valid one-page PDF. */
export function buildPdf(): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "", // content stream, filled below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 72 700 Td (E2E fixture syllabus) Tj ET";
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A minimal valid .docx (docx-preview renders it into .docx-wrapper). */
export async function buildDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>E2E fixture syllabus</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function findSeedUserId(admin: SupabaseClient): Promise<string> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email === SEED_EMAIL);
    if (hit) {
      assertSeedEmail(hit.email);
      return hit.id;
    }
    if (data.users.length < 200) break;
  }
  throw new Error(`${SEED_EMAIL} does not exist; this script never creates accounts`);
}

export async function seedLegacyFixture(admin: SupabaseClient, log: (m: string) => void = console.log) {
  const userId = await findSeedUserId(admin);
  const pdf = buildPdf();
  const docx = await buildDocx();

  for (const [position, c] of SEED_CLASSES.entries()) {
    const fields = { short_name: c.shortName, room: c.room, instructor: c.instructor, position };
    const { data: existing, error: findErr } = await admin
      .from("classes")
      .select("id")
      .eq("user_id", userId)
      .eq("code", c.code)
      .maybeSingle();
    if (findErr) throw new Error(`classes lookup (${c.code}): ${findErr.message}`);

    let classId: string;
    if (existing) {
      const { error } = await admin.from("classes").update(fields).eq("id", existing.id).eq("user_id", userId);
      if (error) throw new Error(`classes update (${c.code}): ${error.message}`);
      classId = existing.id;
      log(`class ${c.shortName}: updated`);
    } else {
      const { data, error } = await admin
        .from("classes")
        .insert({ user_id: userId, code: c.code, ...fields })
        .select("id")
        .single();
      if (error) throw new Error(`classes insert (${c.code}): ${error.message}`);
      classId = data.id;
      log(`class ${c.shortName}: created`);
    }

    if (c.syllabus) {
      const path = `${userId}/${classId}/e2e-fixture-syllabus.${c.syllabus}`;
      const body = c.syllabus === "pdf" ? pdf : docx;
      const contentType =
        c.syllabus === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const { error: upErr } = await admin.storage.from("syllabi").upload(path, body, { contentType, upsert: true });
      if (upErr) throw new Error(`syllabus upload (${c.shortName}): ${upErr.message}`);
      const { error: ptrErr } = await admin.from("classes").update({ syllabus_path: path }).eq("id", classId).eq("user_id", userId);
      if (ptrErr) throw new Error(`syllabus pointer (${c.shortName}): ${ptrErr.message}`);
      log(`  syllabus ${c.syllabus}: ${path}`);
    }
  }
  return { userId };
}

async function main() {
  const arg = process.argv[2];
  if (arg !== undefined) assertSeedEmail(arg); // an email argument is accepted ONLY if it is the seed account
  loadEnv({ path: ".env.local" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { userId } = await seedLegacyFixture(admin);
  console.log(`done: ${SEED_EMAIL} (${userId})`);
}

if (process.argv[1] && /seed-e2e-legacy\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
