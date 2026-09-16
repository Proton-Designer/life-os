import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashShareToken, selectPublicFields, type PublicQuestionBank } from "./class-share-core";

/**
 * The public read path (P3-08) -- the ONLY function in this feature
 * allowed to use the service-role client, and the only one an
 * unauthenticated visitor's request ever reaches. Looks up by
 * `sha256(rawToken)` (never a raw-token column exists to look up by), and
 * returns `null` for EVERY failure mode identically: unknown token,
 * revoked token, or a class with sharing off entirely. The caller
 * (app/share/[token]/page.tsx) must not — and cannot, from this return
 * shape — distinguish which one happened, per Opus Lead's no-enumeration
 * requirement.
 *
 * Selects ONLY `prompt, answer, topic` from `questions` (never `id`,
 * `user_id`, or `class_id`) via the SAME `selectPublicFields` projection
 * the owner's own pre-share preview uses (class-share-core.ts) — the two
 * can never drift into different shapes because they are one function.
 *
 * `active = true` ONLY, read live at request time (the caller renders this
 * with `dynamic = "force-dynamic"`, never cached) — an owner's edit or
 * retirement of a question is reflected on the very next request, because
 * there is no snapshot anywhere to go stale.
 */
export async function getPublicQuestionBankCore(serviceClient: SupabaseClient, rawToken: string): Promise<PublicQuestionBank | null> {
  if (rawToken.length === 0) return null;
  const tokenHash = hashShareToken(rawToken);

  const { data: share, error: shareError } = await serviceClient
    .from("class_question_shares")
    .select("class_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (shareError) throw shareError;
  if (share === null) return null;

  const { data: classRow, error: classError } = await serviceClient.from("classes").select("short_name, code").eq("id", share.class_id).maybeSingle();
  if (classError) throw classError;
  if (classRow === null) return null;

  const { data: questionRows, error: questionsError } = await serviceClient
    .from("questions")
    .select("prompt, answer, topic")
    .eq("class_id", share.class_id)
    .eq("active", true);
  if (questionsError) throw questionsError;

  return selectPublicFields(classRow, questionRows ?? []);
}
