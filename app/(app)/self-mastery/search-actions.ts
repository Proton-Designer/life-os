"use server";

import { requireUser } from "@/lib/supabase/auth";
import { searchLibrary, type SearchLibraryResult } from "@/lib/self-mastery/semantic-search";

export type { SearchLibraryResult, SearchHit } from "@/lib/self-mastery/semantic-search";

/** P2-13D -- thin wrapper over searchLibrary (lib/self-mastery/semantic-search.ts). */
export async function searchSelfMasteryLibrary(query: string): Promise<SearchLibraryResult> {
  const { supabase, userId } = await requireUser();
  return searchLibrary(supabase, userId, query);
}
