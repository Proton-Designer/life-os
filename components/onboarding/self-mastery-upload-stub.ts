// STUB — Self-Mastery / ULM's book ingestion pipeline and its storage table
// do not exist yet (Phase 2, per the ULM lead's ruling on PHASE-1-SPEC.md).
// This function exists so the onboarding UI has something real to call and
// await, without inventing a books table or a fake ingestion queue. Replace
// the body with the real upload-and-enqueue call once ULM's storage lands —
// the call site (self-mastery-step.tsx) does not need to change, only this
// function's implementation.
export async function stubStoreSelfMasteryUpload(file: File): Promise<{ ok: true }> {
  void file;
  return { ok: true };
}
