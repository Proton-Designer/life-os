"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createWebhookCore, listWebhooksCore, deleteWebhookCore, testFireWebhookCore, type WebhookStatus } from "@/lib/mcp/webhooks";

/**
 * P4-22 -- outbound webhook management (vertical slice: add, list, test-fire,
 * remove; ONE event type, write.ok). Same "no function here ever returns a
 * secret back out of a successful creation" rule as mcp-token-actions.ts.
 */

export type { WebhookStatus };

export interface CreateWebhookResult {
  ok: boolean;
  message: string;
  secret?: string;
  status?: WebhookStatus;
}

export async function getWebhookStatuses(): Promise<WebhookStatus[]> {
  const { supabase, userId } = await requireUser();
  return listWebhooksCore(supabase, userId);
}

export async function createWebhook(url: string): Promise<CreateWebhookResult> {
  const { supabase, userId } = await requireUser();
  const result = await createWebhookCore(supabase, userId, url);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export interface WebhookActionResult {
  ok: boolean;
  message: string;
}

export async function deleteWebhook(id: string): Promise<WebhookActionResult> {
  const { supabase, userId } = await requireUser();
  const result = await deleteWebhookCore(supabase, userId, id);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function testFireWebhook(id: string): Promise<WebhookActionResult> {
  const { supabase, userId } = await requireUser();
  return testFireWebhookCore(supabase, userId, id);
}
