import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { captureAreaOptions } from "@/lib/capture/areas";
import { hasBusinessKillList } from "@/lib/night-plan/kill-list-mirror";
import { getInboxItems, type InboxItem } from "@/lib/inbox/inbox-core";
import { loadPlanAreaOptions } from "@/lib/night-plan/plan-areas";
import type { PlanArea } from "@/lib/plan/plan-behavior";

export type CloseInbox = { items: InboxItem[]; areas: { value: "school" | "co_op"; label: string }[]; killList: boolean; /** The person's own domains a plan line can be attached to. */ planAreas: PlanArea[]; timezone: string };

/** What the evening close's Inbox step needs: the parked items plus the task homes this account actually has (the same list the "+" sheet offers, minus "No area"). */
export async function loadCloseInbox(): Promise<CloseInbox> {
  const user = await getAuthedUser();
  if (!user) return { items: [], areas: [], killList: false, planAreas: [], timezone: "UTC" };
  const [supabase, profile, userDomains] = await Promise.all([createClient(), getProfile(), getUserDomains()]);
  const nav = userDomains.mode === "domains" ? computeNavDomainState(userDomains.domains, userDomains.subdomains, isDeenModeOn(profile)) : null;
  const areas = captureAreaOptions(userDomains.mode, nav).filter((o): o is { value: "school" | "co_op"; label: string } => o.value !== "none");
  const [items, planOptions] = await Promise.all([getInboxItems(supabase, user.id), loadPlanAreaOptions()]);
  return { items, areas, killList: hasBusinessKillList(userDomains.mode, nav), planAreas: planOptions.areas, timezone: profile?.timezone ?? "UTC" };
}

/** Whether this account has a Business Kill List the plan stage can mirror a starred line into (same domain read as the Inbox areas). */
export async function loadHasKillList(): Promise<boolean> {
  const [profile, userDomains] = await Promise.all([getProfile(), getUserDomains()]);
  const nav = userDomains.mode === "domains" ? computeNavDomainState(userDomains.domains, userDomains.subdomains, isDeenModeOn(profile)) : null;
  return hasBusinessKillList(userDomains.mode, nav);
}
