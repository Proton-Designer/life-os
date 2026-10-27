import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { isDeenModeOnForRequest } from "@/lib/deen/deen-mode-guard";

/**
 * Where a domains-mode account's Self-Mastery lives: /personal/self_mastery,
 * inside the Faith/Self-Mastery/Fitness tab chrome. Null for an account that
 * has no such route (legacy mode, or Self-Mastery not kept), which stays on
 * the standalone /self-mastery route.
 *
 * Why: every "back" out of the reader, the speed test, a book card and a
 * notification deep-link points at /self-mastery. A domains-mode account
 * landing there lost its subdomain tabs and had no way back to Faith or
 * Fitness short of the top nav (2026-10-26).
 */
export async function personalSelfMasteryHref(bookId?: string): Promise<string | null> {
  const userDomains = await getUserDomains();
  if (userDomains.mode !== "domains") return null;
  const deenMode = await isDeenModeOnForRequest();
  const kept = computeNavDomainState(userDomains.domains, userDomains.subdomains, deenMode).personalSubdomains;
  if (!kept.some((s) => s.key === "self_mastery")) return null;
  return bookId ? `/personal/self_mastery/${bookId}` : "/personal/self_mastery";
}
