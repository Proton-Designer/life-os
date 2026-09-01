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
