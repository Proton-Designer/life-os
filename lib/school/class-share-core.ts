import "server-only";
import { randomBytes, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * P3-08: creating/revoking/checking a public share of one class's question
 * bank. Every function here runs on the AUTHENTICATED (RLS-governed)
 * client -- never service-role -- so `classId` ownership is enforced the
 * same way `questions` itself already relies on: the composite FK
 * (`class_question_shares.(user_id,class_id)` -> `classes(user_id,id)`,
 * migration 203) makes a share for a class the caller doesn't own
 * structurally unrepresentable, not merely blocked by a policy. No
 * function here takes a bare classId and trusts it -- the insert/select
 * itself is what proves ownership, via that FK and RLS together (Opus
 * Lead's explicit requirement).
 *
 * HASHED TOKEN, SHOWN ONCE: `token_hash` is the only thing ever persisted.
 * The raw token this file mints is returned to the caller exactly once, in
 * `createClassShareCore`'s own return value -- there is no function
 * anywhere in this file (or the public read path) that can produce it
 * again. `getClassShareStatusCore` returns only whether a share is live,
 * never the token.
 */

/** 256 bits of entropy, base64url -- same generation shape as lib/mcp/tokens.ts's own PATs, but this file mints its own rather than importing that module (a share link is not an MCP credential, and this file has no other MCP coupling). */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256, hex -- one-way, same shape as lib/mcp/tokens.ts's hashToken/lib/mcp/oauth.ts's sha256Hex. */
export function hashShareToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export interface ClassShareStatus {
  active: boolean;
  createdAt: string | null;
}

/**
 * Mints a new share for `classId`, owned by `userId`. REFUSES if a share
 * is already live for that class (migration 203's partial unique index
 * would reject the insert anyway; checking first gives a friendly message
 * instead of a raw 23505). There is deliberately no "get or create" here:
 * since the raw token is never stored, a second call could not hand back
 * the FIRST call's token even if it wanted to -- the owner must
 * `revokeClassShareCore` first to mint a genuinely new one.
 */
export async function createClassShareCore(supabase: SupabaseClient, userId: string, classId: string): Promise<{ rawToken: string }> {
  const existing = await getClassShareStatusCore(supabase, userId, classId);
  if (existing.active) {
    throw new Error("This class is already shared. Revoke the existing link before creating a new one.");
  }

  const rawToken = generateShareToken();
  const { error } = await supabase.from("class_question_shares").insert({
    user_id: userId,
    class_id: classId,
    token_hash: hashShareToken(rawToken),
  });
  if (error) throw error;
  return { rawToken };
}

/** Scoped to (userId, classId) via RLS -- can only ever revoke the caller's own share. */
export async function revokeClassShareCore(supabase: SupabaseClient, userId: string, classId: string): Promise<void> {
  const { error } = await supabase
    .from("class_question_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("class_id", classId)
    .is("revoked_at", null);
  if (error) throw error;
}

export async function getClassShareStatusCore(supabase: SupabaseClient, userId: string, classId: string): Promise<ClassShareStatus> {
  const { data, error } = await supabase
    .from("class_question_shares")
    .select("created_at")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return { active: data !== null, createdAt: data?.created_at ?? null };
}

export interface PublicBankQuestion {
  prompt: string;
  answer: string;
  topic: string | null;
}

export interface PublicQuestionBank {
  className: string;
  questions: PublicBankQuestion[];
}

/**
 * THE ONE PROJECTION, reused by both the owner's pre-creation preview
 * (getSharePreviewCore, authenticated) and the public route
 * (getPublicQuestionBankCore, service-role) -- so "what the owner was
 * shown before sharing" and "what a stranger actually sees" can never
 * drift into two separately-maintained shapes. Selects ONLY
 * prompt/answer/topic -- never `id`, `user_id`, or `class_id`. `className`
 * is `short_name ?? code`, the same display-name derivation
 * app/(app)/school/page.tsx already uses everywhere else.
 */
export function selectPublicFields(
  classRow: { short_name: string | null; code: string },
  questionRows: { prompt: string; answer: string; topic: string | null }[]
): PublicQuestionBank {
  return {
    className: classRow.short_name ?? classRow.code,
    questions: questionRows.map((q) => ({ prompt: q.prompt, answer: q.answer, topic: q.topic })),
  };
}

/**
 * The owner's own "here is exactly what becomes public" preview (Opus
 * Lead's requirement #4) -- authenticated client, RLS-scoped to the
 * caller's own class and active questions. Callable independent of
 * whether a share currently exists, so the owner can preview BEFORE
 * deciding to create one.
 */
export async function getSharePreviewCore(supabase: SupabaseClient, userId: string, classId: string): Promise<PublicQuestionBank> {
  const [{ data: classRow, error: classError }, { data: questionRows, error: questionsError }] = await Promise.all([
    supabase.from("classes").select("short_name, code").eq("user_id", userId).eq("id", classId).single(),
    supabase.from("questions").select("prompt, answer, topic").eq("user_id", userId).eq("class_id", classId).eq("active", true),
  ]);
  if (classError) throw classError;
  if (questionsError) throw questionsError;
  return selectPublicFields(classRow, questionRows ?? []);
}
