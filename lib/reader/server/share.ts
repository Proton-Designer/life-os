import "server-only";
import { cancelReaderImportCore, createReaderImportCore, prepareReaderDocCore, type Db } from "./core";
import { BOOKS_BUCKET } from "./paths";

// The POST share target (manifest share_target, multipart): the OS hands the app a title / text / url and maybe a file.
// The long text lives in the request BODY (a GET share put it in the URL, which hosts cap), so the import is created and
// prepared here, server-side, and the person lands on the normal preview/confirm with ?pending=<bookId>.

/** Vercel Functions cap request bodies at 4.5 MB; stay under it so the refusal is ours and readable. */
export const SHARE_MAX_BYTES = 4 * 1024 * 1024;
export const SHARE_MAX_TEXT_CHARS = 200_000;

export interface ShareInput {
  title: string;
  text: string;
  url: string;
  file: { name: string; bytes: Uint8Array } | null;
}

export type ShareResult = { ok: true; bookId: string } | { ok: false; message: string };

const HTTP_URL = /^https?:\/\/\S+$/i;

/** A shared page URL often arrives in `text`; a link wins over text, a file wins over both. */
export function classifyShare(input: ShareInput): { kind: "file" } | { kind: "url"; url: string } | { kind: "paste"; text: string } | null {
  if (input.file && input.file.bytes.byteLength > 0) return { kind: "file" };
  const url = input.url.trim() || (HTTP_URL.test(input.text.trim()) ? input.text.trim() : "");
  if (url) return { kind: "url", url };
  const text = input.text.slice(0, SHARE_MAX_TEXT_CHARS);
  return text.trim() ? { kind: "paste", text } : null;
}

export async function createShareImportCore(db: Db, userId: string, input: ShareInput): Promise<ShareResult> {
  const plan = classifyShare(input);
  if (!plan) return { ok: false, message: "There was nothing to import in what was shared." };
  const given = input.title.trim() ? { title: input.title.trim().slice(0, 200) } : {};

  let bytes: Uint8Array | null = null;
  let request: unknown;
  if (plan.kind === "file") {
    const file = input.file!;
    if (file.bytes.byteLength > SHARE_MAX_BYTES) return { ok: false, message: "That file is too large to share into the reader. Import it from the library instead." };
    bytes = file.bytes;
    request = { kind: "file", filename: file.name, fileSizeBytes: file.bytes.byteLength, ...given };
  } else if (plan.kind === "url") {
    request = { kind: "url", url: plan.url, ...given };
  } else {
    bytes = new TextEncoder().encode(plan.text);
    request = { kind: "paste", ...given };
  }

  const created = await createReaderImportCore(db, userId, request);
  if (!created.ok) return { ok: false, message: created.message };
  const bookId = created.bookId;
  const fail = async (message: string): Promise<ShareResult> => {
    await cancelReaderImportCore(db, userId, bookId);
    return { ok: false, message };
  };

  if (created.upload) {
    if (!bytes) return fail("Something went wrong. Please try again.");
    const { error } = await db.storage.from(BOOKS_BUCKET).upload(created.upload.path, new Blob([bytes as BlobPart], { type: created.upload.contentType }), {
      contentType: created.upload.contentType,
      upsert: true,
    });
    if (error) return fail("The shared content couldn't be saved. Please try again.");
  }
  const prepared = await prepareReaderDocCore(db, userId, bookId);
  if (!prepared.ok) return fail(prepared.message);
  return { ok: true, bookId };
}
