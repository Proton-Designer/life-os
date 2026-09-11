/**
 * Migration 149's own required proof: "insert one widget of each kind
 * through the actual widget_manage create path against production, confirm
 * all five are accepted, and clean up after." A passing unit test is
 * precisely what failed to catch the original gap (141 shipped the CHECK
 * with only metric_card/list; every kind added since mocks the database, so
 * nothing ever noticed the CHECK was never widened) -- so this script runs
 * the REAL `widgetManageTool` dispatcher against a REAL Supabase client
 * pointed at production, not a mock, and reads the result straight back
 * from the database.
 *
 * Uses the SEED account (SEED_USER_EMAIL), not the owner's daily account --
 * SEED is the designated fixture account for exactly this kind of
 * verification write, and using it keeps this script's temporary rows off
 * the owner's own live Home page for the brief window between insert and
 * cleanup.
 *
 * Cleanup is a REAL DELETE via the service-role client, not
 * `widget_manage`'s "delete" (which only archives, by the standing
 * no-hard-delete rule for MCP-originated deletes -- see actions-core.ts's
 * header). That rule is about the ACTOR: an MCP call may originate from a
 * model acting on injected content, so it never gets to hard-delete. This
 * script is an engineer's own verification run with direct database
 * access, the same actor class as the e2e suite's own teardown -- so a real
 * DELETE is the correct and honest cleanup, not a workaround.
 *
 * Usage: npx tsx scripts/verify-mcp-widgets-kind-check.ts
 * (reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_USER_EMAIL
 * from .env.local, same convention as scripts/backfill-review-state-after.ts)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { widgetManageTool } from "@/lib/mcp/tools/widget-manage";

const CASES: { kind: string; patch: Record<string, unknown> }[] = [
  {
    kind: "metric_card",
    patch: { kind: "metric_card", title: "[verify-149] metric_card", data_source: { domain: "deen", entity: "prayer" }, display: { aggregate: "count" } },
  },
  {
    kind: "list",
    patch: { kind: "list", title: "[verify-149] list", data_source: { domain: "deen", entity: "prayer" }, display: { titleField: "status" } },
  },
  {
    kind: "progress_against_goal",
    patch: {
      kind: "progress_against_goal",
      title: "[verify-149] progress_against_goal",
      data_source: { domain: "deen", entity: "prayer" },
      display: { aggregate: { type: "count" }, goal: 10 },
    },
  },
  {
    kind: "sparkline",
    patch: { kind: "sparkline", title: "[verify-149] sparkline", data_source: { domain: "deen", entity: "quran_session" }, display: { dateField: "date" } },
  },
  {
    kind: "streak",
    patch: { kind: "streak", title: "[verify-149] streak", data_source: { domain: "deen", entity: "quran_session" }, display: { dateField: "date" } },
  },
];

function textOf(outcome: Awaited<ReturnType<typeof widgetManageTool>>): string {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected a text content block");
  return block.text;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const seedEmail = process.env.SEED_USER_EMAIL;
  if (!url || !serviceRoleKey || !seedEmail) {
    console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SEED_USER_EMAIL must all be set (.env.local).");
    process.exit(2);
  }

  const supabase = createClient<Database>(url, serviceRoleKey);

  const { data: userRow, error: userError } = await supabase.auth.admin.listUsers();
  if (userError) throw userError;
  const seedUser = userRow.users.find((u) => u.email === seedEmail);
  if (!seedUser) throw new Error(`SEED account ${seedEmail} not found in auth.users`);
  const userId = seedUser.id;
  console.log(`using SEED account ${seedEmail} (${userId})\n`);

  const createdIds: string[] = [];
  const results: { kind: string; outcome: "accepted" | "REJECTED"; detail: string }[] = [];

  for (const { kind, patch } of CASES) {
    try {
      const outcome = await widgetManageTool(supabase, userId, { action: "create", patch });
      const { id } = JSON.parse(textOf(outcome)) as { id: string };
      createdIds.push(id);
      results.push({ kind, outcome: "accepted", detail: `id=${id}` });
      console.log(`accepted  ${kind.padEnd(22)} id=${id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ kind, outcome: "REJECTED", detail: message });
      console.log(`REJECTED  ${kind.padEnd(22)} ${message}`);
    }
  }

  // Cleanup — a real DELETE, scoped to exactly the rows this run created.
  if (createdIds.length > 0) {
    const { error: deleteError } = await supabase.from("mcp_widgets").delete().in("id", createdIds);
    if (deleteError) {
      console.error(`\nCLEANUP FAILED -- ${createdIds.length} row(s) left behind: ${createdIds.join(", ")}`, deleteError);
      process.exit(1);
    }
    console.log(`\ncleaned up ${createdIds.length} row(s): ${createdIds.join(", ")}`);
  }

  // Verify cleanup actually worked -- a delete call that silently matched
  // zero rows would report success while leaving everything behind.
  const { data: remaining, error: checkError } = await supabase.from("mcp_widgets").select("id").in("id", createdIds);
  if (checkError) throw checkError;
  if ((remaining ?? []).length > 0) {
    console.error(`\nCLEANUP DID NOT TAKE -- ${remaining!.length} row(s) still present: ${remaining!.map((r) => r.id).join(", ")}`);
    process.exit(1);
  }
  console.log("cleanup verified: 0 rows remain from this run.");

  const rejected = results.filter((r) => r.outcome === "REJECTED");
  console.log("\n--- summary ---");
  for (const r of results) console.log(`  ${r.kind.padEnd(22)} ${r.outcome}`);
  if (rejected.length > 0) {
    console.error(`\n${rejected.length}/${results.length} kind(s) still rejected -- migration 149 did not fix this.`);
    process.exit(1);
  }
  console.log(`\nALL ${results.length} KINDS ACCEPTED against production, through the real widget_manage create path. Migration 149 verified.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
