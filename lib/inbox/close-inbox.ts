import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { captureAreaOptions } from "@/lib/capture/areas";
import { getInboxItems, type InboxItem } from "@/lib/inbox/inbox-core";

export type CloseInbox = { items: InboxItem[]; areas: { value: "school" | "co_op"; label: string }[] };

/** What the evening close's Inbox step needs: the parked items plus the task homes this account actually has (the same list the "+" sheet offers, minus "No area"). */
export async function loadCloseInbox(): Promise<CloseInbox> {
  const user = await getAuthedUser();
  if (!user) return { items: [], areas: [] };
  const [supabase, profile, userDomains] = await Promise.all([createClient(), getProfile(), getUserDomains()]);
  const nav = userDomains.mode === "domains" ? computeNavDomainState(userDomains.domains, userDomains.subdomains, isDeenModeOn(profile)) : null;
  const areas = captureAreaOptions(userDomains.mode, nav).filter((o): o is { value: "school" | "co_op"; label: string } => o.value !== "none");
  return { items: await getInboxItems(supabase, user.id), areas };
}
