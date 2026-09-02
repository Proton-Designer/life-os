// Durable harness (R9 item 5 / boss-handoff, 2026-09-02) — folded in from the
// scratch investigation that answered R12.4: is the ~13-minute `merging`
// stage an un-batched-embedding artifact? Reproduces BOTH the buggy
// (per-candidate) and fixed (whole-array) `embed()` call patterns against
// the REAL local model. No DB, no PDF, no API key.
//
// Run: node lib/self-mastery/ingestion/merge-bench.mjs [N]  (default N=300)
//
// @huggingface/transformers is an OPTIONAL, UNINSTALLED dependency. Install it
// when you want to run this:   npm i -D @huggingface/transformers
//
// WHY IT IS NOT IN package.json (LifeOS lead's call, 2026-09-02):
// It was added as a devDependency and I backed it out. Three reasons, and the
// second is the one that decided it:
//
//   1. The pipeline this benchmarks HAS NO RUNTIME. There is no worker, and
//      ingestion is blocked on a funding decision. Carrying a heavyweight ML
//      dependency to benchmark a stage whose caller does not exist is the
//      mechanism-ahead-of-its-caller pattern, one layer up.
//   2. "Dev-only, so `npm audit --omit=dev` is clean" is TRUE TODAY AND EXPIRES.
//      ADR-003 makes this a PRODUCTION dependency the moment the worker lands,
//      at which point sharp/libvips and adm-zip enter the production tree. The
//      original header said "whoever wires the worker: re-run npm audit" — but
//      a note asking a future person to remember is not a mechanism. That is
//      the same shape as every deferred check this project has been burned by.
//   3. Every `npm install` in this shared tree was building sharp/libvips — a
//      recurring cost paid by every agent and every CI run, today, for a
//      benchmark nobody can meaningfully run yet.
//
// With it removed, `npm audit` (NOT `--omit=dev`) reports 0 vulnerabilities
// across the whole tree. That is a stronger position than a clean production
// audit plus a promise.
//
// REVERSIBLE IN ONE LINE. When the worker lands and ADR-003 is confirmed, add
// it to `dependencies` (not dev) and run a full `npm audit` then — which is the
// honest sequence, and it happens at the moment someone is actually looking.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "../../../package.json"));
let pipeline;
try {
  ({ pipeline } = require("@huggingface/transformers"));
} catch {
  // Fail with an instruction, not a stack trace. A harness that dies opaquely
  // is how an instrument stops being run and then stops being trusted.
  console.error(
    "\nmerge-bench needs @huggingface/transformers, which is deliberately not installed.\n" +
      "  npm i -D @huggingface/transformers\n" +
      "See this file's header for why it is optional.\n"
  );
  process.exit(2);
}

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const BATCH_SIZE = 16; // matches the local-embeddings convention (CLAUDE.md: transformers.js, no API key)

let extractorPromise = null;
function getExtractor() {
  extractorPromise ??= pipeline("feature-extraction", MODEL_ID);
  return extractorPromise;
}

async function embedTexts(texts) {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const results = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    results.push(...output.tolist());
  }
  return results;
}

function cosineSimilarity(a, b) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Shape of clusterAndRank's hot loop (merge.ts's clusterAndRank) — greedy, first-match-wins.
function clusterHotLoop(embeddings, threshold = 0.86) {
  const clusters = [];
  for (const emb of embeddings) {
    let placed = false;
    for (const c of clusters) {
      if (cosineSimilarity(c[0], emb) >= threshold) { c.push(emb); placed = true; break; }
    }
    if (!placed) clusters.push([emb]);
  }
  return clusters.length;
}

const N = Number(process.argv[2] ?? 300);
const SUBJECTS = ["deliberate practice", "sleep debt", "compound interest", "negotiation anchoring", "habit stacking", "cognitive load", "loss aversion", "spaced retrieval", "deep work", "social proof", "default effects", "identity-based habits", "the planning fallacy", "implementation intentions", "psychological safety"];
const VERBS = ["improves", "undermines", "predicts", "accelerates", "masks", "reverses", "amplifies", "constrains"];
const OBJECTS = ["long-term retention", "decision quality", "team throughput", "emotional regulation", "creative output", "risk appetite", "recovery time", "attention span"];
// Genuinely varied so the greedy cluster loop forms many clusters — a
// near-identical first draft collapsed to ONE cluster and made the O(n^2)
// loop best-case, which would have flattered the result.
const claims = Array.from({ length: N }, (_, i) =>
  `Lesson ${i}: ${SUBJECTS[i % SUBJECTS.length]} ${VERBS[(i * 7) % VERBS.length]} ${OBJECTS[(i * 11) % OBJECTS.length]} because the underlying mechanism operates over ${(i % 9) + 2} weeks rather than instantly, and the effect compounds when conditions ${i % 5} hold.`);

const t = async (label, fn) => {
  const s = performance.now();
  const r = await fn();
  const ms = performance.now() - s;
  console.log(`${label.padEnd(46)} ${(ms / 1000).toFixed(2)}s`);
  return [r, ms];
};

console.log(`\nN = ${N} candidate claims, model = ${MODEL_ID}\n`);
await t("COLD START (model load, first call)", () => embedTexts([claims[0]]));

const [, perCandidateMs] = await t(
  "BEFORE THE FIX: one embedTexts call PER candidate (the ULM/pre-port bug)",
  () => Promise.all(claims.map((c) => embedTexts([c]))));

const [batched, batchedMs] = await t(
  "AFTER THE FIX: one embedTexts call, whole array (heuristic-provider.ts / ollama-provider.ts today)",
  () => embedTexts(claims));

const [clusters, clusterMs] = await t(
  "clusterAndRank hot loop (O(n^2) cosine)", async () => clusterHotLoop(batched));

console.log(`\nclusters formed: ${clusters}`);
console.log(`speedup on the embed step: ${(perCandidateMs / batchedMs).toFixed(1)}x`);
console.log(`REDUCE total, before fix : ${((perCandidateMs + clusterMs) / 1000).toFixed(2)}s`);
console.log(`REDUCE total, after fix  : ${((batchedMs + clusterMs) / 1000).toFixed(2)}s`);
console.log(`Vercel ceiling           : 300.00s\n`);
