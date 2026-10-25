/**
 * PHASE 1 ITEM 3 -- METERED CALIBRATION, NOT THE FULL BOOK RUN.
 *
 * Explicit boundary from the Lead: "Do NOT run 66 chunks blind... run a
 * calibration pass on 2-3 real chunks only, fully metered... Report those
 * numbers to me with a full-book extrapolation. I decide whether we run the
 * whole book or a subset." This script is exactly that calibration pass --
 * nothing more. It does NOT touch ingestion_jobs, does NOT run the real
 * worker-stages.ts pipeline, and does NOT write to the operator's real
 * account: it creates one throwaway auth user (same convention as
 * scripts/item7-run.ts) purely so `gatewayChat`/`resolveApiKeyWithSource`
 * and `ai_usage_log`'s NOT NULL `user_id` FK have something real to resolve
 * against. The real book run, in the operator's real account, is a
 * SEPARATE, larger decision the Lead makes after reading this run's numbers.
 *
 * Pulls 3 REAL chunks from the REAL target PDF (the same chunker
 * (`chunkBook`) and structure detector (`parseStructure`) the real
 * pipeline uses, so these numbers are representative of a real chunk's
 * token count/shape, not a synthetic stand-in), and calls
 * `GatewayLlmProvider.extractLessons` / `checkEntailment` / `generateCards`
 * directly -- the three methods Phase 1 item 3 implemented -- through the
 * real gateway (`gatewayChat`), against the real, operator-funded
 * `DEEPSEEK_API_KEY`, with `thinking: false` on every call (the deliberate
 * cost decision this item is built around).
 *
 * Usage: npx tsx scripts/item3-calibration.ts
 * (reads NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/DEEPSEEK_API_KEY
 * from .env.local; reads the PDF from the path below)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import type { Database } from "../lib/supabase/database.types";
import { loadPdf, extractPages, extractOutline } from "../lib/self-mastery/ingestion/pdf";
import { parseStructure } from "../lib/self-mastery/ingestion/structure";
import { chunkBook } from "../lib/self-mastery/ingestion/chunk";
import { GatewayLlmProvider, type DeepSeekUsage } from "../lib/self-mastery/ingestion/llm/gateway-provider";
import type { CandidateLesson } from "../lib/self-mastery/ingestion/llm/types";

const PDF_PATH = `${process.env.HOME}/mnt/Downloads/_OceanofPDF.com_Actionable_Gamification_-_Yu-kai_Chou.pdf`;
const CALIBRATION_CHUNK_COUNT = 3;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`item3-calibration: missing required env var ${name}`);
  return v;
}

interface MeteredCall {
  kind: "extract" | "entailment" | "cards";
  usage: DeepSeekUsage;
}

async function fetchBalance(apiKey: string): Promise<unknown> {
  const res = await fetch("https://api.deepseek.com/user/balance", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    return { error: `HTTP ${res.status}`, body: await res.text().catch(() => "") };
  }
  return res.json();
}

function summarize(calls: MeteredCall[], kind: MeteredCall["kind"]) {
  const rows = calls.filter((c) => c.kind === kind);
  const sum = (f: (u: DeepSeekUsage) => number) => rows.reduce((s, c) => s + f(c.usage), 0);
  return {
    calls: rows.length,
    promptTokens: sum((u) => u.promptTokens),
    cachedPromptTokens: sum((u) => u.cachedPromptTokens),
    completionTokens: sum((u) => u.completionTokens),
    reasoningTokens: sum((u) => u.reasoningTokens),
    costUsd: sum((u) => u.costUsd),
  };
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const deepseekKey = requireEnv("DEEPSEEK_API_KEY");
  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[item3-calibration] starting ${new Date().toISOString()}`);

  const balanceBefore = await fetchBalance(deepseekKey);
  console.log("[item3-calibration] DeepSeek balance BEFORE:", JSON.stringify(balanceBefore));

  // --- Throwaway user, calibration-only, never the operator's real account ---
  const email = `item3-calibration-${Date.now()}@ulm-test.local`;
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (userError || !userData.user) throw new Error(`item3-calibration: createUser failed: ${userError?.message}`);
  const userId = userData.user.id;
  console.log(`[item3-calibration] throwaway user ${userId} (${email}) -- no user_api_keys row, so gatewayChat resolves the shared server DEEPSEEK_API_KEY`);

  // --- Real chunks from the real target book, via the real pipeline's own chunker ---
  const pdfBytes = new Uint8Array(await readFile(PDF_PATH));
  const pdf = await loadPdf(pdfBytes);
  const pages = await extractPages(pdf);
  const outline = await extractOutline(pdf);
  const sections = parseStructure(pages, outline);
  const chunks = chunkBook(pages, sections);
  console.log(`[item3-calibration] ${pages.length} pages, ${sections.length} sections, ${chunks.length} chunks (target ~3000 tokens/chunk)`);

  // Spread through the middle of the book, skipping the first/last ~10% to
  // avoid front matter (title page, TOC, dedication) and back matter
  // (index, about-the-author) that would understate a typical chunk's real
  // extraction yield.
  const skip = Math.floor(chunks.length * 0.1);
  const usable = chunks.slice(skip, chunks.length - skip);
  const stride = Math.floor(usable.length / CALIBRATION_CHUNK_COUNT);
  const selected = Array.from({ length: CALIBRATION_CHUNK_COUNT }, (_, i) => usable[i * stride]!);
  console.log(
    `[item3-calibration] selected chunk sort_orders: ${selected.map((c) => c.sortOrder).join(", ")} (~${selected.map((c) => Math.ceil(c.text.length / 4)).join(", ")} est. tokens each)`,
  );

  const provider = new GatewayLlmProvider(supabase, userId);
  const calls: MeteredCall[] = [];
  const allCandidates: CandidateLesson[] = [];

  for (const chunk of selected) {
    const startedAt = Date.now();
    const candidates = await provider.extractLessons({
      chunkText: chunk.text,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      sourceChunkId: `calibration-${chunk.sortOrder}`,
    });
    const elapsedMs = Date.now() - startedAt;
    if (provider.lastUsage) calls.push({ kind: "extract", usage: provider.lastUsage });
    console.log(
      `[item3-calibration] extractLessons(chunk ${chunk.sortOrder}): ${candidates.length} candidate(s), ${elapsedMs}ms, usage=${JSON.stringify(provider.lastUsage)}`,
    );
    allCandidates.push(...candidates);
  }

  // checkEntailment: up to 2 real lessons, same call shape verifyGroundingStage
  // uses in production (one call per surviving lesson).
  for (const candidate of allCandidates.slice(0, 2)) {
    const startedAt = Date.now();
    const verdict = await provider.checkEntailment({ claim: candidate.coreClaim, quote: candidate.provenanceQuote });
    const elapsedMs = Date.now() - startedAt;
    if (provider.lastUsage) calls.push({ kind: "entailment", usage: provider.lastUsage });
    console.log(`[item3-calibration] checkEntailment: verdict=${verdict.verdict} (${elapsedMs}ms) usage=${JSON.stringify(provider.lastUsage)}`);
  }

  // generateCards: 1 real lesson, same call shape generatingCardsStage uses.
  if (allCandidates[0]) {
    const startedAt = Date.now();
    const cards = await provider.generateCards({ lesson: allCandidates[0] });
    const elapsedMs = Date.now() - startedAt;
    if (provider.lastUsage) calls.push({ kind: "cards", usage: provider.lastUsage });
    console.log(`[item3-calibration] generateCards: ${cards.length} card(s) (${elapsedMs}ms) usage=${JSON.stringify(provider.lastUsage)}`);
  }

  const balanceAfter = await fetchBalance(deepseekKey);
  console.log("[item3-calibration] DeepSeek balance AFTER:", JSON.stringify(balanceAfter));

  const extractSummary = summarize(calls, "extract");
  const entailmentSummary = summarize(calls, "entailment");
  const cardsSummary = summarize(calls, "cards");
  const totalCostUsd = extractSummary.costUsd + entailmentSummary.costUsd + cardsSummary.costUsd;
  const lessonsPerChunk = allCandidates.length / selected.length;

  console.log("\n=== CALIBRATION SUMMARY ===");
  console.log("extractLessons:", extractSummary);
  console.log("checkEntailment:", entailmentSummary);
  console.log("generateCards:", cardsSummary);
  console.log(`TOTAL cost for this calibration run: $${totalCostUsd.toFixed(6)}`);
  console.log(`Candidates extracted: ${allCandidates.length} across ${selected.length} chunks (${lessonsPerChunk.toFixed(2)}/chunk)`);

  const perChunkExtractCost = extractSummary.calls > 0 ? extractSummary.costUsd / selected.length : 0;
  const perLessonEntailmentCost = entailmentSummary.calls > 0 ? entailmentSummary.costUsd / entailmentSummary.calls : 0;
  const perLessonCardsCost = cardsSummary.calls > 0 ? cardsSummary.costUsd / cardsSummary.calls : 0;
  const FULL_BOOK_CHUNKS = 66;
  const estimatedLessons = Math.round(lessonsPerChunk * FULL_BOOK_CHUNKS);
  const extrapolatedExtract = perChunkExtractCost * FULL_BOOK_CHUNKS;
  const extrapolatedEntailment = perLessonEntailmentCost * estimatedLessons;
  const extrapolatedCards = perLessonCardsCost * estimatedLessons;
  console.log("\n=== FULL-BOOK EXTRAPOLATION (66 chunks) ===");
  console.log(`  assumed lessons-per-chunk (measured): ${lessonsPerChunk.toFixed(2)} -> ~${estimatedLessons} lessons for the whole book`);
  console.log(`  extractLessons: 66 chunks x $${perChunkExtractCost.toFixed(6)}/chunk = $${extrapolatedExtract.toFixed(4)}`);
  console.log(`  checkEntailment: ~${estimatedLessons} lessons x $${perLessonEntailmentCost.toFixed(6)}/lesson = $${extrapolatedEntailment.toFixed(4)}`);
  console.log(`  generateCards: ~${estimatedLessons} lessons x $${perLessonCardsCost.toFixed(6)}/lesson = $${extrapolatedCards.toFixed(4)}`);
  console.log(`  ESTIMATED FULL-BOOK TOTAL: $${(extrapolatedExtract + extrapolatedEntailment + extrapolatedCards).toFixed(4)}`);
}

main().catch((err) => {
  console.error("[item3-calibration] FAILED:", err);
  process.exit(1);
});
