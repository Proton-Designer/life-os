import type { SupabaseClient } from "@supabase/supabase-js";

// `lecture_recordings` (migration 211) isn't in the generated Database type
// yet -- `.from()` on the typed client rejects unknown table names at
// compile time. Same shim as lib/self-mastery/untyped-from.ts and
// lib/ai/preferences.ts's own local copy -- this repo's convention is one
// small per-domain copy rather than a cross-domain import, so each domain's
// lib/ stays self-contained. Delete this, and every call site's use of it,
// the moment lib/supabase/database.types.ts is regenerated against 211;
// call sites should then type-check against the real client with no other
// changes beyond swapping this call for a plain `supabase.from`.
export function untypedFrom(supabase: SupabaseClient, table: string) {
  return (supabase as unknown as { from: (t: string) => ReturnType<SupabaseClient["from"]> }).from(table);
}
