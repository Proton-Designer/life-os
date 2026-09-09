"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { deleteWidgetCore } from "@/lib/widgets/actions-core";

/**
 * The one cookie-authed affordance this pass ships for widgets: removing
 * one, directly from its rendered card on Home. Not a full management UI
 * (listing/editing/reordering widgets from inside the app) — that's a
 * real, separate piece of Settings work, out of scope here. Without even
 * this much, a widget the AI created badly (or a prompt-injected one)
 * would have no removal path except asking the AI again — a real gap, not
 * something to leave silently.
 *
 * This calls `deleteWidgetCore` (a real DELETE), not the archive path
 * `widget_manage`'s MCP "delete" uses — deliberately: this is a person
 * removing their own widget from their own dashboard, the same
 * actor-based distinction PROGRAM-PLAN R9 draws between the app's own
 * `unmarkPrayer` (real DELETE) and an MCP-originated "unlog" (status
 * change only). See lib/widgets/actions-core.ts's header for the full
 * reasoning.
 */
export async function removeWidget(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await deleteWidgetCore(supabase, userId, id);
  revalidatePath("/");
}
