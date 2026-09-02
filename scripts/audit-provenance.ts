/**
 * audit-provenance.ts — re-verify, independently, that every stored lesson's
 * provenance quote really is in its source chunk.
 *
 * WHY THIS EXISTS. CLAUDE.md's hard constraint is that a lesson without a
 * verbatim-matching grounding quote is dropped before it reaches the database.
 * The pipeline enforces that at write time with `isGrounded`. This script asks
 * a different question: *is the constraint actually true of the rows that are
 * there now?* A write-time gate proves what was intended; only a read-back
 * proves what happened. ULM's own headline L2 exit test did exactly this and
 * was never ported — this is that test.
 *
 * THE CONTROL IS NOT THE SUBJECT. It would be easy, and useless, to audit with
 * the same `isGrounded` the pipeline used: if that function is wrong, the audit
 * agrees with the bug. So every quote is checked TWICE:
 *
 *   STRICT    whitespace collapsed, nothing else. A naive reader's idea of
 *             "this sentence appears in that page."
 *   PIPELINE  the real normalizeForGroundingCheck — additionally folds smart
 *             quotes, and the several dash characters, to their ASCII forms.
 *
 * The interesting number is neither total on its own. It is:
 *   - BOTH FAIL      a violation of the hard constraint. Non-zero exit.
 *   - PIPELINE ONLY  rows that are grounded only because of character folding.
 *                    Legitimate on an OCR'd scan full of typographic quotes —
 *                    but it should be a REPORTED number, not an invisible one,
 *                    because it is the exact gap between "verbatim" as the
 *                    constraint says it and "verbatim" as the code means it.
 *   - UNAUDITABLE    lessons with no source_chunk_id. These are NOT passes.
 *                    Counting an unanswerable row as clean is the failure this
 *                    project has now hit three times.
 *
 * READ-ONLY. It writes nothing, so it takes no --allow-production; it still
 * requires --target and prints the host, because a report that does not name
 * the database it read is not evidence.
 *
 * Usage:
 *   npx tsx scripts/audit-provenance.ts --target <postgres-url> --book <uuid>
 */
import { execFileSync } from "node:child_process";
import { normalizeForGroundingCheck } from "../lib/self-mastery/ingestion/llm/grounding";

interface Row {
  id: string;
  title: string;
  status: string;
  provenance_quote: string;
  source_chunk_id: string | null;
  chunk_text: string | null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Whitespace only. Deliberately does NOT fold quotes or dashes. */
function strictNormalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function main(): void {
  const target = arg("--target");
  const book = arg("--book");
  if (!target || !book) {
    console.error("usage: npx tsx scripts/audit-provenance.ts --target <postgres-url> --book <uuid>");
    console.error("  Read-only. Both arguments are required and neither is guessed.");
    process.exit(2);
  }

  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    console.error(`audit-provenance: --target is not a valid URL: ${target}`);
    process.exit(2);
  }
  console.error(`audit-provenance: READING ${host} (read-only), book ${book}`);

  const sql = `
    select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (
      select l.id, l.title, l.status::text as status, l.provenance_quote,
             l.source_chunk_id, sc.text as chunk_text
        from public.lessons l
        left join public.source_chunks sc on sc.id = l.source_chunk_id
       where l.book_id = '${book}'
    ) t;`;

  let raw: string;
  try {
    raw = execFileSync("psql", [target, "-X", "-q", "-t", "-A", "-c", sql], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    // A query that did not run is a FAILED AUDIT, never an empty one.
    console.error("audit-provenance: the query did not run. This is not a clean result.");
    console.error(String((err as { stderr?: string }).stderr ?? err).trim());
    process.exit(1);
  }

  const rows: Row[] = JSON.parse(raw.trim() || "[]");
  if (rows.length === 0) {
    console.error(`audit-provenance: book ${book} has no lessons. Nothing was audited — that is not a pass.`);
    process.exit(1);
  }

  if (process.argv.includes("--self-test")) {
    // Prove the COMPARISON can fail before trusting it passing. The query path
    // is already proven to fail loudly (a wrong password and an empty book both
    // exit non-zero); this is the other half — that the checker itself
    // discriminates, rather than returning true for everything.
    const sample = rows.find((r) => r.chunk_text);
    if (!sample) {
      console.error("self-test: no row with a source chunk to work from. COVERAGE GAP, not a pass.");
      process.exit(1);
    }
    const chunk = sample.chunk_text as string;
    const real = sample.provenance_quote;
    const hallucinated = "This sentence appears in no book ever written, least of all this one.";
    // The folding case needs a quote that HAS a foldable character. Picking
    // the first row and hoping is how that assertion turns into a SKIP, which
    // leaves the folding discrimination untested — so search for one.
    const foldable = rows.find((r) => r.chunk_text && /['-]/.test(r.provenance_quote)) ?? sample;
    const foldableChunk = foldable.chunk_text as string;
    const foldingOnly = foldable.provenance_quote.replace(/'/g, "\u2019").replace(/-/g, "\u2014");

    const strict = (q: string) => strictNormalize(chunk).includes(strictNormalize(q)) && strictNormalize(q).length > 0;
    const pipe = (q: string) =>
      normalizeForGroundingCheck(chunk).includes(normalizeForGroundingCheck(q)) &&
      normalizeForGroundingCheck(q).length > 0;

    const results = [
      ["the real quote passes both", strict(real) && pipe(real), true],
      ["a hallucinated quote fails both", !strict(hallucinated) && !pipe(hallucinated), true],
      ["an empty quote fails both", !strict("") && !pipe(""), true],
      // Only meaningful if the real quote actually contained a foldable
      // character; otherwise the substitution is a no-op and this says nothing.
      [
        "smart-quote substitution is folding-dependent (strict fails, pipeline passes)",
        foldingOnly === foldable.provenance_quote
          ? null
          : !(strictNormalize(foldableChunk).includes(strictNormalize(foldingOnly))) &&
            normalizeForGroundingCheck(foldableChunk).includes(normalizeForGroundingCheck(foldingOnly)),
        true,
      ],
    ] as const;

    let failed = false;
    for (const [name, got] of results) {
      if (got === null) {
        console.log(`  SKIP  ${name} — the sample quote has no foldable characters. Not a pass.`);
        continue;
      }
      console.log(`  ${got ? "PASS" : "FAIL"}  ${name}`);
      if (!got) failed = true;
    }
    process.exit(failed ? 1 : 0);
  }

  const unauditable: Row[] = [];
  const bothFail: Row[] = [];
  const pipelineOnly: Row[] = [];
  let bothPass = 0;

  for (const row of rows) {
    if (!row.source_chunk_id || row.chunk_text === null) {
      unauditable.push(row);
      continue;
    }
    const strictOk = strictNormalize(row.chunk_text).includes(strictNormalize(row.provenance_quote))
      && strictNormalize(row.provenance_quote).length > 0;
    const pipelineOk = normalizeForGroundingCheck(row.chunk_text).includes(
      normalizeForGroundingCheck(row.provenance_quote),
    ) && normalizeForGroundingCheck(row.provenance_quote).length > 0;

    if (strictOk && pipelineOk) bothPass++;
    else if (pipelineOk) pipelineOnly.push(row);
    else bothFail.push(row);
  }

  console.log("");
  console.log(`  lessons audited        ${rows.length}`);
  console.log(`  grounded (both checks) ${bothPass}`);
  console.log(`  grounded ONLY after character folding  ${pipelineOnly.length}`);
  console.log(`  NOT GROUNDED by either check           ${bothFail.length}`);
  console.log(`  unauditable (no source chunk)          ${unauditable.length}`);
  console.log("");

  for (const row of pipelineOnly.slice(0, 5)) {
    console.log(`  [folding-dependent] ${row.title.slice(0, 48)}`);
    console.log(`     quote: ${row.provenance_quote.slice(0, 110)}`);
  }
  for (const row of bothFail) {
    console.log(`  [NOT GROUNDED] ${row.id}  status=${row.status}  ${row.title.slice(0, 48)}`);
    console.log(`     quote: ${row.provenance_quote.slice(0, 160)}`);
  }
  for (const row of unauditable.slice(0, 5)) {
    console.log(`  [unauditable] ${row.id}  ${row.title.slice(0, 48)}  (source_chunk_id=${row.source_chunk_id ?? "null"})`);
  }

  if (bothFail.length > 0) {
    console.error(`\nFAIL: ${bothFail.length} lesson(s) violate the hallucination firewall — a stored quote is not in its source chunk.`);
    process.exit(1);
  }
  if (unauditable.length > 0) {
    console.error(`\nINCOMPLETE: ${unauditable.length} lesson(s) could not be checked at all. Not a pass.`);
    process.exit(1);
  }
  console.log(`OK: every stored quote is present in its own source chunk.`);
  if (pipelineOnly.length > 0) {
    console.log(`     ${pipelineOnly.length} of them only after folding smart quotes/dashes — expected on an OCR'd scan, and now a number rather than an assumption.`);
  }
}

main();
