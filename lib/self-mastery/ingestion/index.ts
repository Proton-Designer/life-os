// Ported from ULM's packages/core/src/ingestion/ + src/llm/ (R9 item 5 /
// boss-handoff assignment, 2026-09-02). Pure, no I/O, no schema dependency
// beyond the two enum types pulled from the generated Database type
// (llm/types.ts) — nothing here touches Supabase, a filesystem, or a network
// call except the two LlmProvider implementations' own model calls.
//
// NOT PORTED, on purpose: the worker's process/transport layer
// (apps/worker/src/pipeline.ts in ULM's reference implementation — the
// resumable/cursor-shaped orchestration is tracking-app's own, evolving
// design per migration `109`, not something to import wholesale). This
// directory is the pipeline's pure logic; wiring it into a real worker,
// chunk by chunk, under the cursor model is a separate task.
//
// DO-NOT-PORT annotations from ULM's own migrations (see
// ULM/boss-handoff/03-ULM-IN-THE-MERGED-PLATFORM.md Part C) are all
// SQL/RPC-side (book_memory_strength, weekly_recap, claim_ingestion_job,
// heartbeat_ingestion_job) — none of them live in packages/core/src/
// ingestion or src/llm, so there was nothing to clear here; grepped both
// source directories for "DO NOT PORT"/"⚠️" before starting and found zero
// matches.
export * from "./types";
export * from "./sentences";
export * from "./text-repair";
export * from "./guards";
export * from "./structure";
export * from "./chunk";
export * from "./merge";
export * from "./cards";
export * from "./invariants";
export * from "./evidence-strength";
export * from "./promotion";
export * from "./pdf";
export * from "./telemetry";
export * from "./worker-stages";
export * from "./llm";
