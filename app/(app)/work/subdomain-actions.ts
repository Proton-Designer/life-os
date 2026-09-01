"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import type { Json } from "@/lib/supabase/database.types";

export type WorkSubdomainKind = "job" | "business";

// User-created Work subdomains (M4: "creating a new work subdomain -> first
// prompt: business or job?"), living on top of the same user_subdomains
// table onboarding's saveSubdomains writes to (056) — no schema change
// needed, checked before writing this file per the Lead's hold on new
// migrations pending 000_baseline.sql.
//
// Deliberately separate from app/(app)/work/actions.ts, which is the
// legacy Co-op/Work schedule-events file (a fixed `domain = "co_op"`
// concept, unrelated table). This file is post-onboarding, in-app
// subdomain management for the new user-created-subdomains model — a
// different concept that happens to share a route directory name.

function slugify(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "subdomain";
}

async function findWorkDomainId(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("user_domains")
    .select("id")
    .eq("user_id", userId)
    .eq("key", "work")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("Work subdomain action: the Work domain has not been selected for this account");
  }
  return data.id;
}

/**
 * Slug uniqueness is checked against ALL of this domain's subdomain rows,
 * not just active ones — the (user_id, domain_id, key) unique index isn't
 * partial on archived_at (056), so an archived row's key is still taken.
 * Falls back to `<slug>-2`, `<slug>-3`, ... on collision rather than
 * failing the create outright; two Work subdomains with the same label is
 * a real, unremarkable case ("Consulting" the job and "Consulting" the
 * side business).
 */
export async function createWorkSubdomain(label: string, kind: WorkSubdomainKind): Promise<{ id: string; key: string }> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("createWorkSubdomain: label is required");
  }
  const { supabase, userId } = await requireUser();
  const domainId = await findWorkDomainId(supabase, userId);

  const { data: rows, error: rowsError } = await supabase
    .from("user_subdomains")
    .select("key, position, archived_at")
    .eq("user_id", userId)
    .eq("domain_id", domainId);
  if (rowsError) throw rowsError;

  const takenKeys = new Set((rows ?? []).map((r) => r.key));
  const base = slugify(trimmed);
  let key = base;
  let suffix = 2;
  while (takenKeys.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }

  const activePositions = (rows ?? []).filter((r) => r.archived_at === null).map((r) => r.position);
  const nextPosition = activePositions.length > 0 ? Math.max(...activePositions) + 1 : 0;

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("user_subdomains")
    .insert({
      user_id: userId,
      domain_id: domainId,
      key,
      label: trimmed,
      kind,
      widgets: [] as unknown as Json,
      config: {} as unknown as Json,
      position: nextPosition,
      archived_at: null,
      updated_at: now,
    })
    .select("id, key")
    .single();
  if (insertError) throw insertError;

  revalidatePath("/");
  return { id: inserted.id, key: inserted.key };
}

/**
 * `key` (the slug) never changes on rename — it's the stable identity
 * anything else (widget config, future deep links) would reference.
 */
export async function renameWorkSubdomain(subdomainId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("renameWorkSubdomain: label is required");
  }
  const { supabase, userId } = await requireUser();

  const { error } = await supabase
    .from("user_subdomains")
    .update({ label: trimmed, updated_at: new Date().toISOString() })
    .eq("id", subdomainId)
    .eq("user_id", userId);
  if (error) throw error;

  revalidatePath("/");
}

/** Archive, never delete — same discipline as onboarding's reconcile step. */
export async function archiveWorkSubdomain(subdomainId: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("user_subdomains")
    .update({ archived_at: now, updated_at: now })
    .eq("id", subdomainId)
    .eq("user_id", userId)
    .is("archived_at", null);
  if (error) throw error;

  revalidatePath("/");
}

/**
 * Takes the full ordered id list for the caller's active Work subdomains
 * and rewrites position = array index — the same "position is the array
 * index" convention saveDomainSelection/saveSubdomains already use, rather
 * than a target-swap RPC. Simple, needs no schema addition, and correct as
 * long as the caller always passes every active id (a partial list would
 * silently leave the rest at their old positions, interleaved wrong) —
 * documented here since nothing enforces "the full set" at the type level.
 */
export async function reorderWorkSubdomains(orderedSubdomainIds: string[]): Promise<void> {
  const { supabase, userId } = await requireUser();
  const now = new Date().toISOString();

  for (const [index, id] of orderedSubdomainIds.entries()) {
    const { error } = await supabase
      .from("user_subdomains")
      .update({ position: index, updated_at: now })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  revalidatePath("/");
}
