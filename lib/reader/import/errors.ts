import type { ReaderImportErrorCode } from "../types";

const DEFAULT_MESSAGES: Record<ReaderImportErrorCode, string> = {
  unsupported_type: "That file type isn't supported. Use a PDF, EPUB, TXT, Markdown or HTML file, or paste the text.",
  too_large: "That file is too large to import.",
  encrypted_pdf: "This PDF is password-protected, so it can't be read.",
  no_text: "This PDF has no selectable text (it looks scanned). OCR isn't supported yet.",
  empty: "There's no readable text in that.",
  fetch_failed: "Couldn't fetch that link.",
  not_article: "That page doesn't look like an article we can extract.",
  parse_failed: "That file couldn't be read. It may be corrupted.",
};

/** Every importer failure. `message` is safe to show to the person; `cause` is for logs only. */
export class ReaderImportError extends Error {
  constructor(
    public readonly code: ReaderImportErrorCode,
    message?: string,
    options?: { cause?: unknown }
  ) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = "ReaderImportError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** Anything thrown inside an importer becomes a ReaderImportError (never a raw error to the UI). */
export function toReaderImportError(err: unknown, fallback: ReaderImportErrorCode = "parse_failed"): ReaderImportError {
  if (err instanceof ReaderImportError) return err;
  return new ReaderImportError(fallback, undefined, { cause: err });
}
