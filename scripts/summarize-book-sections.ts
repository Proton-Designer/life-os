/**
 * L9/R6's manual invocation point. `lib/self-mastery/ingestion/
 * summarize-sections.ts` is a plain function, wired to nothing — no route,
 * no cron, no worker stage calls it. This script is the ONLY way to run it
 * today, by design: a background job that spends the owner's metered
 * DeepSeek credits without him asking is not a feature (the lead's
 * explicit instruction).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
 *     npx tsx scripts/summarize-book-sections.ts --book-id=<uuid> [--force] [--provider=deepseek|heuristic]
 *
 * `--provider` defaults to `deepseek` (R6's real engine). `--provider=heuristic`
 * runs HeuristicProvider's deterministic, keyless extractive stand-in
 * instead — useful for proving the orchestration (batching, provenance,
 * idempotency) actually works end-to-end without spending anything, but
 * its output is NOT a real summary (see heuristic-provider.ts's own
 * comment on `summarizeSection`).
 *
 * THE KEY IS NOT AN ARGUMENT, same posture as scripts/
 * backfill-review-state-after.ts — SUPABASE_SERVICE_ROLE_KEY comes from the
 * environment, never argv (visible in `ps`/shell history otherwise). The
 * book owner's OWN DeepSeek key is resolved server-side from
 * `user_api_keys` (lib/ai/resolve-key.ts) — this script never takes one as
 * an argument either.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { resolveApiKeyWithSource, PROVIDERS } from "@/lib/ai/resolve-key";
import { HeuristicProvider } from "@/lib/self-mastery/ingestion/llm/heuristic-provider";
import { DeepSeekProvider } from "@/lib/self-mastery/ingestion/llm/deepseek-provider";
import { summarizeBookSections } from "@/lib/self-mastery/ingestion/summarize-sections";
import type { LlmProvider } from "@/lib/self-mastery/ingestion/llm/types";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`summarize-book-sections: ${name} must be set in the environment.`);
    process.exit(1);
  }
  return v;
}

function parseArgs(argv: string[]): { bookId: string; force: boolean; provider: "deepseek" | "heuristic" } {
  let bookId: string | null = null;
  let force = false;
  let provider: "deepseek" | "heuristic" = "deepseek";
  for (const arg of argv) {
    if (arg.startsWith("--book-id=")) bookId = arg.slice("--book-id=".length);
    else if (arg === "--force") force = true;
    else if (arg === "--provider=heuristic") provider = "heuristic";
    else if (arg === "--provider=deepseek") provider = "deepseek";
  }
  if (!bookId) {
    console.error("summarize-book-sections: --book-id=<uuid> is required.");
    process.exit(1);
  }
  return { bookId, force, provider };
}

async function main() {
  const { bookId, force, provider: providerChoice } = parseArgs(process.argv.slice(2));
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient<Database>(url, serviceRoleKey);

  // book_sections' summary columns don't exist in the generated Database
  // type until the L9 migration is applied — untyped access for exactly
  // that pre-migration reason (see summarize-sections.ts's own header).
  const untyped = supabase as unknown as ReturnType<typeof createClient>;

  const { data: book, error: bookError } = await untyped.from("books").select("title, user_id").eq("id", bookId).single();
  if (bookError) throw bookError;
  if (!book) {
    console.error(`summarize-book-sections: no book with id ${bookId}.`);
    process.exit(1);
  }

  let provider: LlmProvider;
  let summarizedBy: "model" | "heuristic";
  let summaryModel: string | null;

  if (providerChoice === "heuristic") {
    provider = new HeuristicProvider();
    summarizedBy = "heuristic";
    summaryModel = null;
    console.log("summarize-book-sections: using HeuristicProvider (deterministic, keyless, NOT a real summary — see its own header).");
  } else {
    const resolved = await resolveApiKeyWithSource(untyped, (book as { user_id: string }).user_id, "deepseek");
    if (!resolved) {
      console.error(
        `summarize-book-sections: no DeepSeek key configured for this book's owner (user_api_keys, provider='deepseek').\n` +
          `  Configure one in Settings, or pass --provider=heuristic to exercise the pipeline without spending anything.`,
      );
      process.exit(1);
    }
    // UPDATED, Phase 1 item 3 (2026-09-13): DeepSeekProvider is now routed
    // through lib/ai/gateway.ts's `gatewayChat()` for every call it makes,
    // including `summarizeSection` -- the constructor no longer takes a raw
    // key at all (the gateway resolves it internally, same
    // user-key-then-server-key order as `resolveApiKeyWithSource` below),
    // and every server-key call is now subject to the gateway's own hard
    // spend cap (lib/ai/spend-cap.ts). The comment this replaces argued for
    // refusing a fallback-to-shared-key run here BECAUSE DeepSeekProvider
    // had no cap of its own -- that specific reason is gone. The refusal
    // below is kept anyway, deliberately more conservative than the
    // gateway's own cap requires: this script can still burn many calls
    // (one per section) in a single invocation against a shared,
    // near-empty balance before the cap's own pre-flight check would ever
    // see a reason to refuse a later call in a DIFFERENT run, and a book
    // owner silently spending the operator's shared money because they
    // never configured their own key is still a surprising outcome worth
    // stopping explicitly rather than leaving entirely to the cap. Revisit
    // this policy with the Lead if that's ever too strict in practice --
    // it is not a re-derivation of a stale safety requirement.
    if (resolved.source === "server") {
      console.error(
        `summarize-book-sections: this book's owner has no key of their own -- resolution fell back to the ` +
          `SHARED operator DeepSeek key. Refusing: a multi-section book run against the shared balance is ` +
          `still worth stopping explicitly here, on top of (not instead of) the LLM gateway's own spend cap. ` +
          `Configure the book owner's own key in Settings, or pass --provider=heuristic.`,
      );
      process.exit(1);
    }
    provider = new DeepSeekProvider(untyped, (book as { user_id: string }).user_id);
    summarizedBy = "model";
    summaryModel = PROVIDERS.deepseek.defaultModel;
    console.log(`summarize-book-sections: using DeepSeekProvider (${summaryModel}).`);
  }

  const outcomes = await summarizeBookSections(untyped, bookId, provider, summarizedBy, summaryModel, { force });

  const counts = { summarized: 0, skipped_already_summarized: 0, skipped_no_chunks: 0, failed: 0 };
  for (const o of outcomes) {
    counts[o.status]++;
    if (o.status === "failed") console.error(`  FAILED section ${o.sectionId}: ${o.error}`);
  }
  console.log(
    `summarize-book-sections: ${outcomes.length} section(s) — ${counts.summarized} summarized, ` +
      `${counts.skipped_already_summarized} already had a summary, ${counts.skipped_no_chunks} had no chunks, ${counts.failed} failed.`,
  );
  if (counts.failed > 0) process.exit(1);
}

// RUN ONLY WHEN INVOKED AS A SCRIPT — never on import. Same guard, same
// reasoning, as scripts/backfill-review-state-after.ts's own header: an
// unguarded top-level call would fire `main()` (and its `process.exit`
// calls) the moment anything imports this module, including a future test
// file that imports it for coverage. Checked on argv, not `import.meta.url`
// or `require.main`, for the same tsx-vs-vitest dual-runtime reason that
// file documents.
const INVOKED_AS_SCRIPT = (process.argv[1] ?? "").includes("summarize-book-sections");

if (INVOKED_AS_SCRIPT) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
