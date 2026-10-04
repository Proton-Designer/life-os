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
      widgets: [] as unknown as NonNullable<Json>,
      config: {} as unknown as NonNullable<Json>,
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

// ---------------------------------------------------------------------------
// WORK-W1: the Work screen's tab editor. The three single-row actions above stay as they were
// (parity-manifest decisions, tests); the editor uses these two so a whole edit (renames, order,
// archives) is ONE atomic bulk upsert and the keep-at-least-one rule is enforced server-side.
// ---------------------------------------------------------------------------

const MAX_TAB_LABEL = 40;

type SubdomainRow = {
  id: string;
  user_id: string;
  domain_id: string;
  key: string;
  label: string;
  kind: string | null;
  widgets: NonNullable<Json>;
  config: NonNullable<Json>;
  position: number;
  archived_at: string | null;
};

const SUBDOMAIN_COLUMNS = "id, user_id, domain_id, key, label, kind, widgets, config, position, archived_at";

/** `key` is the tab's stable slug (unique per account's Work domain); it never changes on rename. */
export type WorkTabEdit = { key: string; label: string; archived?: boolean };

/**
 * Applies an edited tab list in one statement. `tabs` (by stable `key`) is EVERY one of the account's Work
 * subdomains the editor showed, in the order wanted: renames come from `label`, order from the
 * array index (among tabs that stay active; position is 0..n-1), `archived: true` archives
 * (never deletes). Rejected, with nothing written: an unknown id, a blank/oversized label, a
 * missing active tab, or archiving every tab (at least one must stay).
 */
export async function saveWorkTabs(tabs: WorkTabEdit[]): Promise<void> {
  const { supabase, userId } = await requireUser();
  const domainId = await findWorkDomainId(supabase, userId);

  const { data, error } = await supabase
    .from("user_subdomains")
    .select(SUBDOMAIN_COLUMNS)
    .eq("user_id", userId)
    .eq("domain_id", domainId);
  if (error) throw error;
  const rows = (data ?? []) as SubdomainRow[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const active = rows.filter((r) => r.archived_at === null);

  if (new Set(tabs.map((t) => t.key)).size !== tabs.length) throw new Error("saveWorkTabs: duplicate tab");
  for (const t of tabs) {
    const row = byKey.get(t.key);
    if (!row) throw new Error("saveWorkTabs: unknown tab");
    if (row.archived_at !== null) throw new Error("saveWorkTabs: tab is already archived");
    const label = t.label.trim();
    if (!label) throw new Error("saveWorkTabs: a tab needs a name");
    if (label.length > MAX_TAB_LABEL) throw new Error(`saveWorkTabs: tab names are at most ${MAX_TAB_LABEL} characters`);
  }
  // The editor must account for every active tab, or a missing one would silently keep a stale position.
  if (tabs.length !== active.length) throw new Error("saveWorkTabs: the edit must include every active tab");
  const staying = tabs.filter((t) => !t.archived);
  if (staying.length === 0) throw new Error("saveWorkTabs: keep at least one Work tab");

  const now = new Date().toISOString();
  let nextPosition = 0;
  const updated: SubdomainRow[] = tabs.map((t) => {
    const row = byKey.get(t.key)!;
    const archived = t.archived === true;
    return {
      ...row,
      label: t.label.trim(),
      position: archived ? row.position : nextPosition++,
      archived_at: archived ? now : null,
    };
  });

  const { error: upsertError } = await supabase
    .from("user_subdomains")
    .upsert(updated.map((r) => ({ ...r, updated_at: now })), { onConflict: "id" });
  if (upsertError) throw upsertError;
}

/**
 * Gives an account that has a Work domain but no Business tab one: kind 'business', label
 * "Business", position 0, existing tabs shift to 1+. Explicit and idempotent (a second call finds
 * the tab and does nothing); an archived business tab is brought back instead of duplicated.
 * Never runs from a page render.
 */
export async function ensureBusinessWorkTab(): Promise<{ key: string; created: boolean }> {
  const { supabase, userId } = await requireUser();
  const domainId = await findWorkDomainId(supabase, userId);

  const { data, error } = await supabase
    .from("user_subdomains")
    .select(SUBDOMAIN_COLUMNS)
    .eq("user_id", userId)
    .eq("domain_id", domainId);
  if (error) throw error;
  const rows = (data ?? []) as SubdomainRow[];

  const activeBusiness = rows.find((r) => r.archived_at === null && r.kind === "business");
  if (activeBusiness) return { key: activeBusiness.key, created: false };

  const now = new Date().toISOString();
  const active = rows.filter((r) => r.archived_at === null).sort((a, b) => a.position - b.position);
  const shifted = active.map((r, i) => ({ ...r, position: i + 1, updated_at: now }));

  const archivedBusiness = rows.find((r) => r.kind === "business" && r.archived_at !== null);
  let businessRow: SubdomainRow & { updated_at: string };
  if (archivedBusiness) {
    businessRow = { ...archivedBusiness, label: archivedBusiness.label || "Business", position: 0, archived_at: null, updated_at: now };
  } else {
    const taken = new Set(rows.map((r) => r.key));
    let key = "business";
    for (let n = 2; taken.has(key); n++) key = `business-${n}`;
    businessRow = {
      id: crypto.randomUUID(),
      user_id: userId,
      domain_id: domainId,
      key,
      label: "Business",
      kind: "business",
      widgets: [] as unknown as NonNullable<Json>,
      config: {} as unknown as NonNullable<Json>,
      position: 0,
      archived_at: null,
      updated_at: now,
    };
  }

  const { error: upsertError } = await supabase.from("user_subdomains").upsert([businessRow, ...shifted], { onConflict: "id" });
  if (upsertError) throw upsertError;
  return { key: businessRow.key, created: true };
}

/** Data-free cache revalidation scheduled by the tab editor after an edit: the tab bar and nav live in the shared layout. */
export async function refreshWorkViews(): Promise<void> {
  await requireUser();
  revalidatePath("/", "layout");
}
