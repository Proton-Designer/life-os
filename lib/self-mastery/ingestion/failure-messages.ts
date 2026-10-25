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
 * An AI block is about the ACCOUNT, not the file, and it can clear (a key is added, a month turns over), so these stay retryable: they are deliberately NOT in FILE_PROBLEM_PATTERNS.
 */
export const NO_KEY_MESSAGE =
  "AI isn't set up for your account yet. Add an API key in Settings, or connect an agent (Claude or ChatGPT) under Settings > Connector so it can do this for you, then tap Try again.";
export const MONTHLY_CAP_MESSAGE = "You've used this month's AI budget, so this book couldn't be processed. Tap Try again once it resets or is raised.";
/** Book steps done by the owner's connected agent (agent work queue). Retryable like any AI block: they are not about the file. */
export const AGENT_CANCELLED_MESSAGE = "You cancelled your agent's work on this book. Tap Try again to start it over.";
export const AGENT_TIMEOUT_MESSAGE = "Your agent didn't finish a step of this book in time. Check that its scheduled task is running, then tap Try again.";
export const agentUnitFailedMessage = (reason: string | null | undefined) =>
  `Your agent couldn't finish a step of this book${reason ? ` (${reason.replace(/\s+/g, " ").trim().slice(0, 160)})` : ""}. Tap Try again.`;

export const AI_BLOCK_MESSAGE = { no_key: NO_KEY_MESSAGE, monthly_cap: MONTHLY_CAP_MESSAGE } as const;

export const EMPTY_DOCUMENT_MESSAGE = "We couldn't find any readable text in this file. Check that it isn't empty or only images, then upload it again.";
export const NOT_TEXT_MESSAGE = "This file isn't readable text. Upload a PDF, EPUB, TXT or Markdown file.";
export const UNREADABLE_DOCUMENT_MESSAGE = "We couldn't read this file. It may be damaged. Try exporting or re-saving it, then upload it again.";

const FILE_PROBLEM_PATTERNS = [/^We couldn't find any readable text in this file/, /^This file isn't readable text/, /^We couldn't read this file/, /^This PDF looks like scanned images/, /^This PDF is password-protected/, /^We couldn't read this PDF/, /^This book has \d+ pages, which is over/];

/** Retrying the same file can't help when the failure is about the file itself. Any other failure (provider, timeout, our bug) may. */
export function isRetryableBookError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return true;
  return !FILE_PROBLEM_PATTERNS.some((p) => p.test(errorMessage));
}
