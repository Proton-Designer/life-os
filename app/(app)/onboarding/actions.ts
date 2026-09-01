"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { updateProfile, type ProfileUpdatable } from "@/app/(app)/settings/actions";
import type { Json } from "@/lib/supabase/database.types";

export type DomainKey = "personal_growth" | "work" | "school";

export type SubdomainInput = {
  key: string;
  label: string;
  kind?: "job" | "business" | null;
  widgets?: string[];
  config?: Record<string, unknown>;
};

const DOMAIN_KEYS: readonly DomainKey[] = ["personal_growth", "work", "school"];

/**
 * Selection order becomes `position` (M3: domains are walked in the order
 * picked). Idempotent and reconciling: keys present in `keys` are upserted
 * (un-archiving if previously dropped), keys absent from `keys` but
 * currently active are archived — never deleted, so a changed selection
 * (wizard back-nav, or a genuine re-onboarding) keeps history instead of
 * losing it.
 */
export async function saveDomainSelection(keys: DomainKey[]): Promise<void> {
  if (keys.length === 0) {
    throw new Error("saveDomainSelection: at least one domain is required");
  }
  const { supabase, userId } = await requireUser();

  const now = new Date().toISOString();
  const keySet = new Set(keys);
  const toArchive = DOMAIN_KEYS.filter((key) => !keySet.has(key));
  if (toArchive.length > 0) {
    const { error } = await supabase
      .from("user_domains")
      .update({ archived_at: now, updated_at: now })
      .eq("user_id", userId)
      .in("key", toArchive)
      .is("archived_at", null);
    if (error) throw error;
  }

  const rows = keys.map((key, index) => ({
    user_id: userId,
    key,
    position: index,
    archived_at: null,
    updated_at: now,
  }));
  const { error } = await supabase.from("user_domains").upsert(rows, { onConflict: "user_id,key" });
  if (error) throw error;

  revalidatePath("/onboarding");
}

/**
 * Server-side is the authority on the minimum-one-subdomain rule for
 * Personal Growth (M3) — the UI enforces it too, but a request that
 * bypasses the UI must still be refused here. Same reconcile-then-upsert
 * shape as saveDomainSelection, scoped to this one domain's subdomains:
 * anything active and not in `subs` gets archived, everything in `subs` is
 * upserted with archived_at reset to null.
 */
export async function saveSubdomains(domainKey: DomainKey, subs: SubdomainInput[]): Promise<void> {
  if (domainKey === "personal_growth" && subs.length < 1) {
    throw new Error("saveSubdomains: Personal Growth requires at least one subdomain");
  }
  const { supabase, userId } = await requireUser();

  const { data: domain, error: domainError } = await supabase
    .from("user_domains")
    .select("id")
    .eq("user_id", userId)
    .eq("key", domainKey)
    .maybeSingle();
  if (domainError) throw domainError;
  if (!domain) {
    throw new Error(`saveSubdomains: domain "${domainKey}" has not been selected yet`);
  }

  const now = new Date().toISOString();
  const submittedKeys = new Set(subs.map((s) => s.key));
  const { data: existing, error: existingError } = await supabase
    .from("user_subdomains")
    .select("id, key")
    .eq("user_id", userId)
    .eq("domain_id", domain.id)
    .is("archived_at", null);
  if (existingError) throw existingError;

  const toArchiveIds = (existing ?? [])
    .filter((row) => !submittedKeys.has(row.key))
    .map((row) => row.id);
  if (toArchiveIds.length > 0) {
    const { error } = await supabase
      .from("user_subdomains")
      .update({ archived_at: now, updated_at: now })
      .in("id", toArchiveIds);
    if (error) throw error;
  }

  if (subs.length > 0) {
    const rows = subs.map((s, index) => ({
      user_id: userId,
      domain_id: domain.id,
      key: s.key,
      label: s.label,
      kind: s.kind ?? null,
      widgets: (s.widgets ?? []) as unknown as Json,
      config: (s.config ?? {}) as unknown as Json,
      position: index,
      archived_at: null,
      updated_at: now,
    }));
    const { error } = await supabase
      .from("user_subdomains")
      .upsert(rows, { onConflict: "user_id,domain_id,key" });
    if (error) throw error;
  }

  revalidatePath("/onboarding");
}

/**
 * Merges into a subdomain's `config` jsonb via the `merge_subdomain_config`
 * RPC (056) rather than a read-modify-write from here, closing the TOCTOU
 * gap a plain select-then-update would have. Scoped by (domainKey,
 * subdomainKey), not subdomainKey alone (Opus Lead ruling, after the
 * key-collision I flagged) — Work subdomains are user-named, so someone
 * naming their job or business "Faith" is plausible, not adversarial, and a
 * key-only lookup could silently target the wrong subdomain if that
 * happened to collide with Faith's reserved key.
 */
export async function saveSubdomainConfig(
  domainKey: DomainKey,
  subdomainKey: string,
  config: Record<string, unknown>
): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: domain, error: domainError } = await supabase
    .from("user_domains")
    .select("id")
    .eq("user_id", userId)
    .eq("key", domainKey)
    .maybeSingle();
  if (domainError) throw domainError;
  if (!domain) {
    throw new Error(`saveSubdomainConfig: domain "${domainKey}" has not been selected yet`);
  }

  const { data: subdomain, error: findError } = await supabase
    .from("user_subdomains")
    .select("id")
    .eq("user_id", userId)
    .eq("domain_id", domain.id)
    .eq("key", subdomainKey)
    .is("archived_at", null)
    .maybeSingle();
  if (findError) throw findError;
  if (!subdomain) {
    throw new Error(
      `saveSubdomainConfig: no active subdomain with key "${subdomainKey}" under domain "${domainKey}"`
    );
  }

  const { error } = await supabase.rpc("merge_subdomain_config", {
    p_subdomain_id: subdomain.id,
    p_patch: config as unknown as Json,
  });
  if (error) throw error;

  revalidatePath("/onboarding");
}

export type OnboardingDomainState = {
  key: DomainKey;
  position: number;
};

export type OnboardingSubdomainState = {
  domainKey: DomainKey;
  key: string;
  label: string;
  kind: "job" | "business" | null;
  widgets: string[];
  config: Record<string, unknown>;
  position: number;
};

/**
 * The resume read. Active rows only, shaped for direct wizard consumption
 * (domain keys already resolved onto subdomains, not raw domain_id uuids)
 * so Engineer 2's wizard can hydrate its initial step/selection state
 * without re-deriving anything. Never throws for a user with nothing yet —
 * a brand-new account mid-first-onboarding is the common case, not an
 * error, so this returns empty arrays rather than requiring every caller to
 * handle a rejected promise just to render step 1.
 *
 * Without this, the archive-and-reactivate design saveDomainSelection/
 * saveSubdomains rely on is a trap: a user who abandons has real rows
 * sitting there, the wizard would restart blank with no memory of them, and
 * the next submit would reactivate rows the user never re-confirmed in this
 * session.
 */
export async function getOnboardingState(): Promise<{
  domains: OnboardingDomainState[];
  subdomains: OnboardingSubdomainState[];
}> {
  const { supabase, userId } = await requireUser();

  const { data: domainRows, error: domainsError } = await supabase
    .from("user_domains")
    .select("id, key, position")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("position", { ascending: true });
  if (domainsError) throw domainsError;

  const domains = (domainRows ?? []) as { id: string; key: DomainKey; position: number }[];
  if (domains.length === 0) {
    return { domains: [], subdomains: [] };
  }

  const domainIdToKey = new Map(domains.map((d) => [d.id, d.key]));
  const { data: subdomainRows, error: subdomainsError } = await supabase
    .from("user_subdomains")
    .select("domain_id, key, label, kind, widgets, config, position")
    .eq("user_id", userId)
    .in("domain_id", domains.map((d) => d.id))
    .is("archived_at", null)
    .order("position", { ascending: true });
  if (subdomainsError) throw subdomainsError;

  return {
    domains: domains.map((d) => ({ key: d.key, position: d.position })),
    subdomains: (subdomainRows ?? []).map((s) => ({
      domainKey: domainIdToKey.get(s.domain_id) as DomainKey,
      key: s.key,
      label: s.label,
      kind: (s.kind as "job" | "business" | null) ?? null,
      widgets: (s.widgets ?? []) as string[],
      config: (s.config ?? {}) as Record<string, unknown>,
      position: s.position,
    })),
  };
}

/**
 * The failure mode this guards: a user who abandons halfway must never end
 * up with onboarding_completed = true and zero domains. This is the only
 * writer of that flag, so the check belongs here, before updateProfile —
 * not trusted to have already been enforced by whichever step ran last.
 */
export async function completeOnboarding(
  fields: Omit<ProfileUpdatable, "pin" | "pin_hash" | "onboarding_completed">
): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { count, error } = await supabase
    .from("user_domains")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("archived_at", null);
  if (error) throw error;
  if (!count || count < 1) {
    throw new Error(
      "completeOnboarding: at least one domain must be selected before onboarding can complete"
    );
  }

  await updateProfile({ ...fields, onboarding_completed: true });
  redirect("/");
}
