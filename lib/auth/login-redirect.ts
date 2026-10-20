import { safeNextPath } from "./safe-next";

/** Signed-out pages that must come back to the SAME url (query included) after sign-in, e.g. a PWA share into the reader. */
const RETURN_PREFIXES = ["/read/import"];

/**
 * Where a signed-out visit goes. Almost everything goes to plain /login (Home after sign-in); the share landing keeps its
 * title/text/url query so a signed-out share is not lost. `next` still passes safeNextPath, so it is never an open redirect.
 */
export function loginRedirectFor(pathname: string, search: string): string {
  const keep = RETURN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const next = keep ? safeNextPath(`${pathname}${search}`) : null;
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
