/**
 * Loop verification for the MCP WRITE path against a real deployment.
 *
 * scripts/mcp-protocol-check.ts proves `list_capabilities` and `read` over a
 * real network round trip. It does NOT call `write` — so until now no write
 * action had ever executed in production through an actual MCP client, the
 * self_mastery surface (shipped 2026-09-10) least of all.
 *
 * That gap is the same shape as the widget-kind bug found the same night:
 * every component was verified and the assembled loop was not, so three
 * widget kinds shipped that could never be created. Rigour at layer N says
 * nothing about layer N-1.
 *
 * SEED ONLY. Every row written here is named, removed afterward, and the
 * removal is verified by QUERYING FOR ITS ABSENCE -- never by trusting the
 * tool's own success report, which is precisely the green this program has
 * learned not to accept.
 *
 *   npx tsx scripts/mcp-write-loop-check.ts <baseUrl>
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomBytes, createHash } from "crypto";

// Deliberately NOT importing lib/mcp/tokens: it carries `import "server-only"`,
// which Next vendors internally and which does not resolve outside its build.
// These three lines mirror generateRawToken/hashToken/last4 exactly
// (tokens.ts:38-57) -- a copy, and therefore a thing that can drift. The
// connect() step below is the guard: a wrong hash cannot authenticate, so a
// drifted copy fails loudly at step 1 rather than silently testing nothing.
const TOKEN_PREFIX = "lifeos_pat_";
const generateRawToken = () => TOKEN_PREFIX + randomBytes(32).toString("base64url");
const hashToken = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const last4 = (t: string) => t.slice(-4);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const BASE = process.argv[2];
const { NEXT_PUBLIC_SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: SRK, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SEED_USER_EMAIL: EMAIL, SEED_USER_PASSWORD: PASSWORD } = process.env;
if (!BASE || !SUPA || !SRK || !ANON || !EMAIL || !PASSWORD) { console.error("need <baseUrl> + SUPABASE url/service-role/anon + SEED_USER_EMAIL/PASSWORD"); process.exit(2); }

let pass = 0, fail = 0;
const ok = (m: string, extra = "") => { pass++; console.log(`  PASS  ${m}${extra ? " — " + extra : ""}`); };
const bad = (m: string, e: unknown) => { fail++; console.log(`  FAIL  ${m} — ${e instanceof Error ? e.message : String(e)}`); };
const textOf = (r: any) => (r.content ?? []).map((c: any) => (c.type === "text" ? c.text : "")).join("");

const run = async () => {
  const admin = createClient(SUPA, SRK, { auth: { persistSession: false } });
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const seed = users?.users.find((u) => u.email === EMAIL);
  if (!seed) throw new Error(`SEED user ${EMAIL} not found`);
  console.log(`SEED: ${EMAIL} (${seed.id})\ntarget: ${BASE}\n`);

  const PAT = generateRawToken();
  const { data: tokRow, error: tokErr } = await admin
    .from("mcp_access_tokens")
    .insert({ user_id: seed.id, token_hash: hashToken(PAT), token_last4: last4(PAT), label: "LOOP CHECK — mcp-write-loop-check.ts", scopes: ["read", "write"] })
    .select("id")
    .single();
  if (tokErr || !tokRow) throw new Error(`token mint failed: ${tokErr?.message}`);
  const tokenId = tokRow.id as string;
  console.log("1. minted a real PAT (read+write)\n");

  const client = new Client({ name: "mcp-write-loop-check", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${PAT}` } } });

  const writtenSelfExpIds: string[] = [];
  let probeBookId: string | null = null;
  let probeLessonId: string | null = null;
  const PROBE_DATE = "2026-01-04"; // a past date on SEED, deliberately not today
  try {
    await client.connect(transport);
    ok("connect() — initialize + bearer auth + R4a + JWT + RLS all survived");

    const tools = (await client.listTools()).tools.map((t) => t.name);
    tools.includes("write") ? ok("tools/list includes `write`", tools.join(", ")) : bad("tools/list includes `write`", tools.join(", "));

    // ---- READ (baseline shape) ----
    const r = await client.callTool({ name: "read", arguments: { domain: "deen", entity: "prayer" } });
    const read = JSON.parse(textOf(r));
    Array.isArray(read.items) ? ok("read(deen.prayer)", `${read.items.length} item(s)`) : bad("read(deen.prayer)", JSON.stringify(read).slice(0, 120));

    // ---- WRITE 1: prayer log -> verify in DB -> unlog -> verify ----
    const w1 = await client.callTool({ name: "write", arguments: { domain: "deen", entity: "prayer", action: "log", patch: { date: PROBE_DATE, prayer_name: "fajr", status: "qada" } } });
    (w1 as any).isError ? bad("write deen.prayer.log", textOf(w1)) : ok("write deen.prayer.log", textOf(w1).slice(0, 90));

    const { data: afterLog } = await admin.from("prayers").select("status, logged_at").eq("user_id", seed.id).eq("date", PROBE_DATE).eq("prayer_name", "fajr").maybeSingle();
    afterLog?.status === "qada" ? ok("DB confirms the write landed", `status=${afterLog.status}`) : bad("DB confirms the write landed", `got ${JSON.stringify(afterLog)}`);

    const w2 = await client.callTool({ name: "write", arguments: { domain: "deen", entity: "prayer", action: "unlog", patch: { date: PROBE_DATE, prayer_name: "fajr" } } });
    (w2 as any).isError ? bad("write deen.prayer.unlog", textOf(w2)) : ok("write deen.prayer.unlog");
    const { data: afterUnlog } = await admin.from("prayers").select("status").eq("user_id", seed.id).eq("date", PROBE_DATE).eq("prayer_name", "fajr").maybeSingle();
    afterUnlog?.status === "unlogged" ? ok("DB confirms unlog wrote 'unlogged', not a delete (R9)") : bad("DB confirms unlog", JSON.stringify(afterUnlog));

    // ---- WRITE 2a: ADVERSARIAL — a lesson SEED does not own must be refused ----
    // Found by accident on the first run of this script: it picked a lesson
    // with `.limit(1)` and no user filter, handing SEED another account's
    // lesson_id. The write was refused. Keeping it deliberately -- an
    // unplanned cross-account write attempt against production is worth more
    // as a permanent check than as an anecdote.
    const { data: foreign } = await admin.from("lessons").select("id, user_id").neq("user_id", seed.id).limit(1).maybeSingle();
    if (foreign) {
      const wX = await client.callTool({ name: "write", arguments: { domain: "self_mastery", entity: "self_explanation", action: "log", patch: { lesson_id: foreign.id, prompt: "LOOP CHECK cross-account probe", response: "must not land" } } });
      (wX as any).isError ? ok("cross-account lesson_id is REFUSED", `owner ${String(foreign.user_id).slice(0, 8)}… != SEED`) : bad("cross-account lesson_id is REFUSED", "it was accepted");
      const { count: leak } = await admin.from("self_explanations").select("id", { count: "exact", head: true }).eq("prompt", "LOOP CHECK cross-account probe");
      leak === 0 ? ok("no row was written for the refused cross-account attempt") : bad("no row written for refused attempt", `${leak} row(s) exist`);
    }

    // ---- WRITE 2b: the legitimate path on a lesson SEED DOES own ----
    // `books` carries a set_user_id_from_caller() trigger that RAISES for a
    // service-role insert ("no authenticated user") -- rows must be created by
    // a real signed-in user, not by the admin key. So sign in as SEED and seed
    // the fixture the way the app itself would. Found by this script failing.
    const asSeed = createClient(SUPA, ANON, { auth: { persistSession: false } });
    const { error: signInErr } = await asSeed.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (signInErr) throw new Error(`SEED sign-in failed: ${signInErr.message}`);
    const { data: book, error: bookErr } = await asSeed.from("books").insert({ user_id: seed.id, title: "LOOP CHECK book" }).select("id").single();
    if (bookErr) throw new Error(`book insert failed: ${bookErr.message}`);
    if (book) probeBookId = book.id;
    const { data: ownLesson, error: lessonErr } = await asSeed.from("lessons").insert({ user_id: seed.id, book_id: book!.id, title: "LOOP CHECK lesson", provenance_quote: "written by mcp-write-loop-check.ts" }).select("id").single();
    if (lessonErr) throw new Error(`lesson insert failed: ${lessonErr.message}`);
    if (ownLesson) probeLessonId = ownLesson.id;

    const w3 = await client.callTool({ name: "write", arguments: { domain: "self_mastery", entity: "self_explanation", action: "log", patch: { lesson_id: ownLesson!.id, prompt: "LOOP CHECK probe", response: "written by mcp-write-loop-check.ts" } } });
    if ((w3 as any).isError) bad("write self_mastery.self_explanation.log (own lesson)", textOf(w3));
    else {
      ok("write self_mastery.self_explanation.log (own lesson)", textOf(w3).slice(0, 80));
      const { data: rows } = await admin.from("self_explanations").select("id").eq("user_id", seed.id).eq("prompt", "LOOP CHECK probe");
      (rows?.length ?? 0) > 0 ? ok("DB confirms the self_explanation row exists", `${rows!.length} row(s)`) : bad("DB confirms the self_explanation row", "none found");
      rows?.forEach((x) => writtenSelfExpIds.push(x.id));
    }

  } catch (e) { bad("loop", e); }

  // ---- CLEANUP, verified by absence ----
  console.log("\n2. cleanup");
  await admin.from("prayers").delete().eq("user_id", seed.id).eq("date", PROBE_DATE).eq("prayer_name", "fajr");
  const { count: pCount } = await admin.from("prayers").select("id", { count: "exact", head: true }).eq("user_id", seed.id).eq("date", PROBE_DATE).eq("prayer_name", "fajr");
  pCount === 0 ? ok("prayers probe row GONE (verified by absence)") : bad("prayers probe row removed", `${pCount} remain`);

  if (probeBookId) {
    // books -> lessons -> self_explanations all cascade on (user_id, id).
    await admin.from("books").delete().eq("id", probeBookId);
    const { count: bCount } = await admin.from("books").select("id", { count: "exact", head: true }).eq("id", probeBookId);
    const { count: lCount } = await admin.from("lessons").select("id", { count: "exact", head: true }).eq("id", probeLessonId ?? "00000000-0000-0000-0000-000000000000");
    bCount === 0 && lCount === 0 ? ok("probe book + lesson GONE (cascade verified by absence)") : bad("probe book/lesson removed", `book=${bCount} lesson=${lCount}`);
  }
  if (writtenSelfExpIds.length) {
    await admin.from("self_explanations").delete().in("id", writtenSelfExpIds);
    const { count: sCount } = await admin.from("self_explanations").select("id", { count: "exact", head: true }).in("id", writtenSelfExpIds);
    sCount === 0 ? ok("self_explanation probe row(s) GONE (verified by absence)") : bad("self_explanation rows removed", `${sCount} remain`);
  }

  // ---- REVOCATION, proven live ----
  console.log("\n3. revocation enforced in production");
  await admin.from("mcp_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenId).is("revoked_at", null);
  try {
    const c2 = new Client({ name: "revoked-probe", version: "1.0.0" }, { capabilities: {} });
    await c2.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${PAT}` } } }));
    bad("revoked PAT is rejected", "it still connected");
    await c2.close();
  } catch { ok("revoked PAT is rejected on the very next request"); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(3); });
