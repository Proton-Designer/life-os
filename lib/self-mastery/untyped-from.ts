import type { SupabaseClient } from "@supabase/supabase-js";

// books/lessons/cards/card_states/source_chunks/ingestion_jobs aren't in
// the generated Database type yet — see types.ts's header. `.from()` on
// the typed client rejects unknown table names at compile time, so every
// query against these tables goes through this instead of an `as any`
// scattered through each call site. Delete this the moment
// lib/supabase/database.types.ts is regenerated against the migrated
// schema; call sites should then type-check against the real client with
// no other changes beyond swapping this call for a plain `supabase.from`.
export function untypedFrom(supabase: SupabaseClient, table: string) {
  return (supabase as unknown as { from: (t: string) => ReturnType<SupabaseClient["from"]> }).from(table);
}

// Same reasoning as untypedFrom, for `.rpc()` calls against a function this
// migration just created (`skip_ingestion_cursor_position`, 171) that
// hasn't reached a regenerated database.types.ts yet. Delete this call
// site's use of it once types are regenerated against 171 — same
// no-other-changes-needed swap untypedFrom's own header describes.
//
// AWAITS DIRECTLY, deliberately no `.single()`/`.returns()` chaining: the
// existing typed callers of claim_ingestion_job/advance_ingestion_cursor
// elsewhere in this repo (both, like this one, RETURN a single composite
// type, not SETOF) call `.rpc()` and await it directly with no chaining —
// this mirrors that exact runtime call shape so a function whose zero-row
// case matters (advance_ingestion_cursor's own `alreadyAdvanced: data ===
// null` pattern) behaves identically here, rather than risking `.single()`
// changing PostgREST's response handling for the null case in a way
// nothing in this codebase has verified.
export async function untypedRpc<T = unknown>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  return (
    supabase as unknown as {
      rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
    }
  ).rpc(fn, args);
}
