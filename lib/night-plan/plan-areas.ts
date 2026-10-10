import "server-only";
import { getProfile } from "@/lib/supabase/auth";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { hasBusinessKillList } from "@/lib/night-plan/kill-list-mirror";
import { PLAN_AREAS, isPlanArea, type PlanArea } from "@/lib/plan/plan-behavior";

/**
 * Which domains a plan line can be attached to: the person's own, in their own order. A domains-mode account gets its
 * active `user_domains` (Faith only while Deen Mode is on); a legacy account (predates domain selection) has the
 * classic set. Also whether a Business Kill List exists to add to, from the SAME read as the nav so the two agree.
 */
/** One of the person's Work tabs: what a Work plan line can be pointed at. `kind` decides which widgets it reaches (business -> Kill List, job -> Backlog). */
export type PlanWorkTab = { key: string; label: string; kind: "job" | "business" | null };

export type PlanAreaOptions = { areas: PlanArea[]; killList: boolean; workTabs: PlanWorkTab[] };

const LEGACY_AREAS: readonly PlanArea[] = ["business", "school", "work", "body"];

export async function loadPlanAreaOptions(): Promise<PlanAreaOptions> {
  const [profile, userDomains] = await Promise.all([getProfile(), getUserDomains()]);
  const deen = isDeenModeOn(profile);
  if (userDomains.mode === "legacy") {
    return { areas: [...LEGACY_AREAS, ...(deen ? (["faith"] as const) : [])], killList: true, workTabs: [] };
  }
  const nav = computeNavDomainState(userDomains.domains, userDomains.subdomains, deen);
  const areas = userDomains.domains.map((d) => d.key).filter(isPlanArea).filter((k) => deen || k !== "faith");
  return { areas: areas.length > 0 ? areas : [...PLAN_AREAS].filter((k) => k !== "faith"), killList: hasBusinessKillList("domains", nav), workTabs: nav.hasWork ? nav.workSubdomains : [] };
}
