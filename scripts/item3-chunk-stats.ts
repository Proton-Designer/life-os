/**
 * ZERO-COST follow-up to item3-calibration.ts: no network calls, no
 * DeepSeek spend -- just runs the real PDF loader/structure detector/chunker
 * (the exact same functions worker-stages.ts's chunkingStage calls) against
 * the real target book, to check the Lead's "~66 chunks" estimate against
 * what the real chunker actually produces for this book.
 *
 * Usage: npx tsx scripts/item3-chunk-stats.ts
 */
import { readFile } from "node:fs/promises";
import { loadPdf, extractPages, extractOutline } from "../lib/self-mastery/ingestion/pdf";
import { parseStructure } from "../lib/self-mastery/ingestion/structure";
import { chunkBook } from "../lib/self-mastery/ingestion/chunk";

const PDF_PATH = `${process.env.HOME}/mnt/Downloads/_OceanofPDF.com_Actionable_Gamification_-_Yu-kai_Chou.pdf`;

async function main() {
  const pdfBytes = new Uint8Array(await readFile(PDF_PATH));
  const pdf = await loadPdf(pdfBytes);
  const pages = await extractPages(pdf);
  const outline = await extractOutline(pdf);
  const sections = parseStructure(pages, outline);
  const chunks = chunkBook(pages, sections);

  const tokenCounts = chunks.map((c) => c.tokenCount);
  const total = tokenCounts.reduce((a, b) => a + b, 0);
  const avg = total / chunks.length;
  const sorted = [...tokenCounts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  console.log(`pages: ${pages.length}`);
  console.log(`outline entries: ${outline.length}`);
  console.log(`detected sections: ${sections.length}`);
  console.log(`chunks: ${chunks.length}`);
  console.log(`total tokens across all chunks: ${total}`);
  console.log(`avg tokens/chunk: ${avg.toFixed(0)}  median: ${median}  min: ${min}  max: ${max}`);
  console.log(`chunks at/near the 3000-token target (>=2500): ${tokenCounts.filter((t) => t >= 2500).length}`);
  console.log(`chunks well under target (<1000 tokens): ${tokenCounts.filter((t) => t < 1000).length}`);
}

main().catch((err) => {
  console.error("item3-chunk-stats FAILED:", err);
  process.exit(1);
});
