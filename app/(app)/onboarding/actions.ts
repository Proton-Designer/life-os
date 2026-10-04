"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, getAuthedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { updateProfile, type ProfileUpdatable } from "@/app/(app)/settings/actions";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Every key `user_domains.key` may legally hold — the TypeScript mirror of
 * that column's CHECK, which is what check-enum-drift.sh pairs this against.
 * Migration 115 widens the CHECK (faith/body/learning/business), so this
 * widens with it: a DB value TS does not name renders `undefined` through any
 * exhaustive Record, which is the drift direction that check exists to catch.
 *
 * DELIBERATELY NOT the same list as DOMAIN_KEYS below, and they must not be
 * merged. This type answers "what may exist"; DOMAIN_KEYS answers "what this
 * onboarding flow manages" — and DOMAIN_KEYS drives `toArchive`, so adding a
 * key there archives every row of that key for any user who completes
 * onboarding without picking it. Widening this type is safe; widening that
 * list would silently archive users' post-115 Faith/Body/Learning rows.
 */
export type DomainKey = "personal_growth" | "faith" | "body" | "learning" | "business" | "work" | "school";

export type SubdomainInput = {
  key: string;
  label: string;
  kind?: "job" | "business" | null;
  widgets?: string[];
  config?: Record<string, unknown>;
};

// The keys THIS FLOW offers and therefore manages. Scoped deliberately: it
// drives `toArchive` below, so it must never list a key the flow cannot also
// offer. It widens when onboarding actually offers the new areas (R27.2), not
// when the database learns to accept them.
//
// DO NOT MERGE THIS WITH `DomainKey` ABOVE. They look like the same list and
// they are not: the type answers "what may exist", this answers "what this
// flow manages". Collapsing them to one constant is the obvious tidy-up and
// it is a DATA-LOSS BUG — every post-115 Faith/Body/Learning row would land
// in `toArchive` and be archived the next time any user completed onboarding
// without picking an area this flow cannot even display yet.
const DOMAIN_KEYS: readonly DomainKey[] = ["personal_growth", "work", "school"];

/**
 * Selection order becomes `position` (M3: domains are walked in the order
 * picked). Idempotent and reconciling: keys present in `keys` are kept
 * active (un-archiving if previously dropped), keys absent from `keys` but
 * currently active are archived — never deleted, so a changed selection
 * (wizard back-nav, or a genuine re-onboarding) keeps history instead of
 * losing it.
 *
 * Insert and update are deliberately TWO separate calls, not one upsert
 * (R10 / ruling c): `weight` (essential/important/background) must be set
 * on a genuinely new row — first selected gets essential, the rest
 * important — but must never be touched on a row that already exists. This
 * function can run again for the same user (back-nav, a future add/remove-
 * domains action), and a single upsert can't express "set this column only
 * on insert": Postgres materializes `excluded.weight` from the attempted
 * row INCLUDING its column default for any key the payload omits, so
 * `ON CONFLICT DO UPDATE SET weight = excluded.weight` would silently reset
 * an already-existing domain's weight back to the default on every re-run —
 * the exact "reordering silently re-weights" failure R10 was written to
 * prevent, just moved from `position` to a repeat call of this function.
 * Keeping `weight` out of the update payload entirely, not just out of a
 * shared upsert row, is what makes that structurally impossible rather than
 * merely unlikely.
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

  const { data: existingRows, error: existingError } = await supabase
    .from("user_domains")
    .select("key")
    .eq("user_id", userId)
    .in("key", keys);
  if (existingError) throw existingError;
  const existingKeys = new Set((existingRows ?? []).map((r) => r.key));

  const newRows = keys
    .map((key, position) => ({ key, position }))
    .filter(({ key }) => !existingKeys.has(key))
    .map(({ key, position }) => ({
      user_id: userId,
      key,
      position,
      archived_at: null,
      updated_at: now,
      // R10: first-selected (position 0 of the WHOLE selection, not just
      // of the new ones) is essential; every other new row is important.
      // Nothing is ever born background.
      weight: position === 0 ? "essential" : "important",
    }));
  if (newRows.length > 0) {
    const { error } = await supabase.from("user_domains").insert(newRows);
    if (error) throw error;
  }

  // Existing rows: only reconcile position/archived_at/updated_at.
  // Small counts (<=3 top-level domains), so a per-row update is simplest
  // and — critically — each call's payload has no `weight` key at all.
  for (const [position, key] of keys.entries()) {
    if (!existingKeys.has(key)) continue;
    const { error } = await supabase
      .from("user_domains")
      .update({ position, archived_at: null, updated_at: now })
      .eq("user_id", userId)
      .eq("key", key);
    if (error) throw error;
  }

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
export async function saveSubdomains(domainKey: DomainKey, rawSubs: SubdomainInput[]): Promise<void> {
  // Deen Mode (R5): onboarding never creates the Faith subdomain, even from a
  // stale/legacy payload. Only Settings -> Deen Mode turns the Faith area on.
  const subs =
    domainKey === "personal_growth" ? rawSubs.filter((s) => s.key !== "faith") : rawSubs;
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
    // A pre-existing Faith subdomain is left alone (R4: never mutate deen
    // data): onboarding no longer offers it, so its absence from `subs` must
    // not read as "the user dropped it".
    .filter((row) => !submittedKeys.has(row.key) && !(domainKey === "personal_growth" && row.key === "faith"))
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
      widgets: (s.widgets ?? []) as unknown as NonNullable<Json>,
      config: (s.config ?? {}) as unknown as NonNullable<Json>,
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
 *
 * Deliberately does NOT use requireUser() (Opus Lead, live-browser catch):
 * this runs on the RENDER path, not a mutation path, and `/onboarding`'s
 * page and `AuthedShell`'s auth check/redirect run in parallel — Next does
 * not wait for the layout before rendering the page. During the brief
 * window where the session cookie is present but not yet resolved,
 * requireUser()'s throw was surfacing as an unhandled error boundary that
 * killed the whole client tree before hydration, instead of letting the
 * layout's redirect("/login") do its job. A read that decorates a page
 * must degrade, not throw — getAuthedUser() returns null instead of
 * throwing, so an unauthenticated/not-yet-resolved caller just sees empty
 * state and the layout handles the redirect on its own.
 */
export async function getOnboardingState(): Promise<{
  domains: OnboardingDomainState[];
  subdomains: OnboardingSubdomainState[];
}> {
  const user = await getAuthedUser();
  if (!user) {
    return { domains: [], subdomains: [] };
  }
  const userId = user.id;
  const supabase = await createClient();

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
 *
 * REVALIDATE THE SHARED LAYOUT BEFORE REDIRECTING (first-use trust bug,
 * 2026-09-18, same shape as app/(app)/open/actions.ts's startDayAction):
 * `redirect()` works by throwing, so a revalidate placed after it is dead
 * code. This is the FIRST screen a brand-new user ever sees after signup —
 * a stale client Router Cache entry for "/" (or, per this layout's own
 * header comment, a brief pre-redirect render of /onboarding's children
 * that can precede AuthedShell's own redirect) would land them on what
 * looks like an unfinished app: Home rendering as though onboarding never
 * happened, in the wrong (legacy vs domains) nav shape. `updateProfile`
 * below already revalidates the layout on its own whenever
 * `onboarding_completed` is among the written fields (see that function's
 * own reasoning) — it always is here — but this call stays explicit rather
 * than relying on that as an implementation detail of a function this one
 * merely calls: the ordering guarantee (revalidate before redirect) belongs
 * to whichever function actually redirects.
 */
export async function completeOnboarding(
  fields: Omit<ProfileUpdatable, "pin" | "pin_hash" | "onboarding_completed">
): Promise<void> {
  const { supabase, userId } = await requireUser();

  // Deen Mode (R5): onboarding never writes location or prayer settings,
  // even if a stale client sends them -- those belong to Settings, behind
  // the Deen Mode switch.
  const {
    location_lat: _lat,
    location_lng: _lng,
    location_label: _label,
    prayer_calc_method: _calc,
    asr_madhab: _madhab,
    ...safeFields
  } = fields as typeof fields & Record<string, unknown>;
  void [_lat, _lng, _label, _calc, _madhab];

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

  await updateProfile({ ...(safeFields as typeof fields), onboarding_completed: true });

  // ONB item 11 (Ayman): removed the automatic Marcus Aurelius "Meditations"
  // starter-deck seed that used to run here unconditionally for anyone who
  // kept Self-Mastery -- a new account showed "47 cards ready to start" out
  // of nowhere, with no book the user ever chose. This is not a casual
  // reversal of the prior ruling that a seed failure must be visible, never
  // silent (R7, self-mastery-session-actions.ts's own history) -- that
  // ruling is now moot, not overturned, because there is no seed left to
  // fail. Zero books is a genuine, honest empty state for every new
  // Self-Mastery user now (see getDueSummary's `hasBooks`), not evidence of
  // a failed write. Existing accounts that were already seeded keep their
  // decks -- deleting user data (and any real study progress on it) is
  // Ayman's call, not made here.

  revalidatePath("/", "layout");
  redirect("/");
}
