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

/**
 * An AI block is about the ACCOUNT, not the file, and it can clear (a key is added, a month turns over, the shared budget is
 * topped up), so these stay retryable: they are deliberately NOT in FILE_PROBLEM_PATTERNS.
 */
export const NO_KEY_MESSAGE = "AI isn't set up for your account yet. Add an API key in Settings, then tap Try again.";
export const MONTHLY_CAP_MESSAGE = "You've used this month's AI budget, so this book couldn't be processed. Tap Try again once it resets or is raised.";
export const GLOBAL_CAP_MESSAGE = "The shared AI budget is used up for now. Tap Try again later, or add your own API key in Settings.";
export const AI_BLOCK_MESSAGE = { no_key: NO_KEY_MESSAGE, monthly_cap: MONTHLY_CAP_MESSAGE, global_cap: GLOBAL_CAP_MESSAGE } as const;

const FILE_PROBLEM_PATTERNS = [/^This PDF looks like scanned images/, /^This PDF is password-protected/, /^We couldn't read this PDF/, /^This book has \d+ pages, which is over/];

/** Retrying the same file can't help when the failure is about the file itself. Any other failure (provider, timeout, our bug) may. */
export function isRetryableBookError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return true;
  return !FILE_PROBLEM_PATTERNS.some((p) => p.test(errorMessage));
}
