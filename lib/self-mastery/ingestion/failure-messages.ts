/**
 * What a person reads when a book fails for a reason that is about THEIR FILE, not about us. Each is deterministic:
 * running the same file again fails the same way, so these fail the book on the first attempt (no retries burned) and
 * "Try again" is not offered for them (see isRetryableBookError).
 */
export const SCANNED_PDF_MESSAGE =
  "This PDF looks like scanned images with no text we can read. Upload a version with selectable text (or run it through OCR first) and try again.";
export const ENCRYPTED_PDF_MESSAGE = "This PDF is password-protected. Remove the password, then upload it again.";
export const UNREADABLE_PDF_MESSAGE = "We couldn't read this PDF. It may be damaged. Try exporting or re-saving it, then upload it again.";
export const tooManyPagesMessage = (pageCount: number, maxPages: number) =>
  `This book has ${pageCount} pages, which is over the ${maxPages}-page limit. Upload a shorter file or split it into parts.`;

const FILE_PROBLEM_PATTERNS = [/^This PDF looks like scanned images/, /^This PDF is password-protected/, /^We couldn't read this PDF/, /^This book has \d+ pages, which is over/];

/** Retrying the same file can't help when the failure is about the file itself. Any other failure (provider, timeout, our bug) may. */
export function isRetryableBookError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return true;
  return !FILE_PROBLEM_PATTERNS.some((p) => p.test(errorMessage));
}
