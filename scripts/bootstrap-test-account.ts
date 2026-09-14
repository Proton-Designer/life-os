/**
 * PHASE 1 -- FRESH TEST ACCOUNT BOOTSTRAP (redo item, per Lead's message:
 * "do NOT touch ayman.m0704@gmail.com or any existing account").
 *
 * Creates a brand-new Supabase auth user via the admin API
 * (email_confirm: true, so it can be signed into immediately -- a .test
 * address receives no confirmation email), then hand-writes exactly the
 * rows a real account needs to render a non-empty, non-broken shell,
 * since there is NO auth.users trigger in this schema (migration 080:
 * deliberate "lazy upsert on first real use" design) -- profiles/
 * user_settings/domain rows are normally created lazily by the onboarding
 * flow and various RPCs, which this script bypasses on purpose (no browser
 * available here), so it must create the lazy rows itself.
 *
 * MODE DECISION (domains, not legacy) -- verified against the actual code,
 * not assumed:
 *   - lib/domains/get-user-domains.ts: mode:"legacy" fires only when
 *     onboarding_completed=true AND zero non-archived user_domains rows.
 *   - app/(app)/personal/[subdomain]/layout.tsx and .../personal/page.tsx
 *     both compute `kept = mode==="domains" ? computeNavDomainState(...).
 *     personalSubdomains : []` and `redirect("/")` whenever kept.length===0.
 *     In legacy mode `kept` is ALWAYS [], so both routes unconditionally
 *     redirect to "/" -- this is not a hypothetical, it is what the code
 *     does today.
 *   - The book detail page lives at exactly
 *     app/(app)/personal/[subdomain]/[bookId]/page.tsx, i.e. inside that
 *     same layout. A legacy-mode account cannot reach it by URL: 200 with a
 *     redirect to "/", not a 404 -- confirmed by reading the route, not
 *     assumed.
 *   - Worse: lib/self-mastery/get-in-progress-books.ts (which feeds the
 *     Home page's own InProgressBanner -- the ONE piece of UI meant to let
 *     you jump back into an in-progress book) hard-codes
 *     `href: \`/personal/self_mastery/\${b.id}\`` -- so on a legacy-mode
 *     account, following the app's own "resume this book" link on the
 *     dashboard bounces you straight back to the dashboard. This is a real
 *     product bug on legacy-mode accounts (which includes Ayman's own real
 *     account), being flagged to the Lead separately -- not something this
 *     script works around by picking legacy mode anyway.
 *   - Therefore: DOMAINS mode. One `user_domains` row (key="learning", the
 *     post-115 flattened vocabulary -- lib/domains/area-vocabulary.ts) is
 *     enough on its own for nav-domain-state.ts's PERSONAL_AREAS fallback to
 *     synthesize a `self_mastery` entry in personalSubdomains (no
 *     user_subdomains row is actually required for THAT), but a matching
 *     `user_subdomains` row (key="self_mastery") is added anyway so the
 *     account looks like a genuine post-onboarding account, not a shell
 *     shortcut, and so any code that does query user_subdomains directly
 *     (onboarding/actions.ts's seed RPC gate) sees a real row too.
 *
 * Usage: npx tsx scripts/bootstrap-test-account.ts
 * (reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from .env.local)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";

const TEST_EMAIL: string = "ulm-demo@lifeos.test";
const TEST_PASSWORD = "ULMdemo2026!";
const BOOK_TITLE = "Actionable Gamification";
const BOOK_AUTHOR = "Yu-kai Chou";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`bootstrap-test-account: missing required env var ${name}`);
  return v;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const supabase = createClient<Database>(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log(`[bootstrap] starting ${new Date().toISOString()}`);
  console.log(`[bootstrap] guard: target email is "${TEST_EMAIL}" -- never ayman.m0704@gmail.com or any existing account`);
  if (TEST_EMAIL === "ayman.m0704@gmail.com") throw new Error("REFUSING: target email matches the operator's real account");

  // --- 0. Refuse if this email already exists (idempotency safety, not a retry mechanism) ---
  const { data: existingPage, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw new Error(`bootstrap: listUsers failed: ${listError.message}`);
  const already = existingPage.users.find((u) => u.email === TEST_EMAIL);
  if (already) {
    console.log(`[bootstrap] user ${TEST_EMAIL} already exists as ${already.id} -- not creating a duplicate. Re-run cleanup manually if you want a fresh one.`);
    console.log(JSON.stringify({ userId: already.id, email: TEST_EMAIL, password: TEST_PASSWORD }, null, 2));
    return;
  }

  // --- 1. Create the auth user, email_confirm true so no confirmation email is needed ---
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (userError || !userData.user) throw new Error(`bootstrap: createUser failed: ${userError?.message}`);
  const userId = userData.user.id;
  console.log(`[bootstrap] created auth user ${userId} (${TEST_EMAIL})`);

  // --- 2. profiles row (lazy-created normally by updateProfile() during onboarding) ---
  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: userId,
    display_name: "ULM Demo",
    onboarding_completed: true,
  });
  if (profileError) throw new Error(`bootstrap: profiles insert failed: ${profileError.message}`);
  console.log(`[bootstrap] profiles row created (onboarding_completed=true)`);

  // --- 3. user_settings row (lazy-created normally by start_session/submit_review/
  // complete_session's own `insert ... on conflict do nothing` -- avoid migration
  // 080's documented all-NULL degraded-record failure mode by writing it now) ---
  const { error: settingsError } = await supabase.from("user_settings").insert({ user_id: userId });
  if (settingsError) throw new Error(`bootstrap: user_settings insert failed: ${settingsError.message}`);
  console.log(`[bootstrap] user_settings row created (defaults)`);

  // --- 4. user_domains row: key="learning" -- enough on its own for
  // nav-domain-state.ts's PERSONAL_AREAS fallback to surface self_mastery
  // in personalSubdomains. service_role bypasses RLS; user_domains has no
  // set_user_id_from_caller-style trigger (unlike books), so an explicit
  // user_id in the insert is honoured as given. ---
  const { data: domainRow, error: domainError } = await supabase
    .from("user_domains")
    .insert({ user_id: userId, key: "learning", position: 0, weight: "important" })
    .select("id")
    .single();
  if (domainError || !domainRow) throw new Error(`bootstrap: user_domains insert failed: ${domainError?.message}`);
  console.log(`[bootstrap] user_domains row created: learning (id=${domainRow.id})`);

  // --- 5. user_subdomains row: key="self_mastery", for realism / any code that
  // queries subdomains directly (onboarding/actions.ts's seed RPC gate) ---
  const { error: subdomainError } = await supabase.from("user_subdomains").insert({
    user_id: userId,
    domain_id: domainRow.id,
    key: "self_mastery",
    label: "Self-Mastery",
    position: 0,
  });
  if (subdomainError) throw new Error(`bootstrap: user_subdomains insert failed: ${subdomainError.message}`);
  console.log(`[bootstrap] user_subdomains row created: self_mastery`);

  // --- 6. ACTUALLY VERIFY login works -- authenticate against Supabase with
  // the created credentials, not just "the row exists". ---
  const anon = createClient<Database>(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (signInError || !signInData.session) {
    throw new Error(`bootstrap: VERIFICATION FAILED -- sign-in with the created credentials did not work: ${signInError?.message}`);
  }
  console.log(`[bootstrap] VERIFIED: signed in successfully as ${TEST_EMAIL}, session user id = ${signInData.session.user.id} (matches created user: ${signInData.session.user.id === userId})`);

  // Confirm getUserDomains()'s own condition resolves to "domains" mode for
  // this account, reading it back exactly the way that function does.
  const { data: domainCheck } = await supabase
    .from("user_domains")
    .select("key")
    .eq("user_id", userId)
    .is("archived_at", null);
  console.log(`[bootstrap] getUserDomains() precondition check: onboarding_completed=true, non-archived user_domains rows = ${domainCheck?.length ?? 0} -> mode should be "domains" (legacy requires exactly 0)`);

  console.log("\n=== TEST ACCOUNT READY ===");
  console.log(JSON.stringify({ userId, email: TEST_EMAIL, password: TEST_PASSWORD, mode: "domains", bookTitle: BOOK_TITLE, bookAuthor: BOOK_AUTHOR }, null, 2));
}

main().catch((err) => {
  console.error("[bootstrap] FAILED:", err);
  process.exit(1);
});
