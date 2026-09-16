"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { getLayoutCore, saveLayoutCore, type LayoutItem, type SaveLayoutItem } from "@/lib/page-layout/actions-core";

export type { LayoutItem, SaveLayoutItem };

/** WIDGET-01 -- thin wrapper over getLayoutCore (lib/page-layout/actions-core.ts). Every domain page + WIDGET-02's picker dialog call this to read the caller's own layout. */
export async function getPageLayout(domainKey: string): Promise<LayoutItem[]> {
  const { supabase, userId } = await requireUser();
  return getLayoutCore(supabase, userId, domainKey);
}

export type SavePageLayoutResult = { ok: true } | { ok: false; message: string };

/**
 * WIDGET-01 -- thin wrapper over saveLayoutCore. Takes the FULL desired
 * layout for one domain and applies it atomically (see saveLayoutCore's
 * own header). Nothing persists until this is called -- the draft lives
 * in WIDGET-02's own dialog state until Save.
 */
export async function savePageLayout(domainKey: string, items: SaveLayoutItem[]): Promise<SavePageLayoutResult> {
  const { supabase, userId } = await requireUser();
  try {
    await saveLayoutCore(supabase, userId, domainKey, items);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save your layout. Try again." };
  }
  // Every domain page reads its own layout on render -- revalidate broadly
  // rather than trying to map domainKey back to its own route(s) one by
  // one (self_mastery alone renders at two different paths).
  revalidatePath("/", "layout");
  return { ok: true };
}
