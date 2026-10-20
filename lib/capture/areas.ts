import type { NavDomainState } from "@/lib/shell/nav-domain-state";
import { hasBusinessKillList } from "@/lib/night-plan/kill-list-mirror";

/**
 * Where a captured Task lands (IA-P1a). `tasks.domain` is CHECK-constrained to school/co_op,
 * so those are the only two areas with a task home; "none" is the Inbox — a `domain: null`,
 * `dump_source: 'capture'` row the evening close triages (lib/inbox/inbox-core.ts).
 * "business" (the "+" sheet only, never the Inbox triage) is a Business plan line that is mirrored into the Kill List.
 */
export type CaptureArea = "school" | "co_op" | "business" | "none";
export type CaptureAreaOption = { value: CaptureArea; label: string };

/** Plain serializable data the shell hands to the "+" sheet (never a function). */
export type CaptureAreaConfig = { options: CaptureAreaOption[]; workTabs: { key: string; kind: "job" | "business" | null }[] };

export function buildCaptureAreaConfig(navMode: "legacy" | "domains", nav: NavDomainState | null): CaptureAreaConfig {
  const options = captureAreaOptions(navMode, nav);
  // Business: the Kill List is its task home, offered only when the account has one (same test the plan stage uses).
  if (hasBusinessKillList(navMode, nav)) options.splice(options.length - 1, 0, { value: "business", label: "Business (Kill List)" });
  return {
    options,
    workTabs: (nav?.workSubdomains ?? []).map((s) => ({ key: s.key, kind: s.kind })),
  };
}

export const NO_AREA_LABEL = "No area (Inbox)";

const ALL_AREAS: readonly CaptureArea[] = ["school", "co_op", "business", "none"];
export function isCaptureArea(v: unknown): v is CaptureArea {
  return typeof v === "string" && (ALL_AREAS as readonly string[]).includes(v);
}

/** The areas this account actually has: legacy = today's two (School, Work); domains = whichever of those it turned on. "No area" is always last. */
export function captureAreaOptions(navMode: "legacy" | "domains", nav: NavDomainState | null): CaptureAreaOption[] {
  const out: CaptureAreaOption[] = [];
  if (navMode === "legacy" || nav === null) {
    out.push({ value: "school", label: "School" }, { value: "co_op", label: "Work" });
  } else {
    if (nav.hasSchool) out.push({ value: "school", label: "School" });
    // Work tasks live on the job/Work screen; an account whose only Work tabs are Business tabs has no task home there.
    const hasJobHome = nav.hasWork && (nav.workSubdomains.length === 0 || nav.workSubdomains.some((s) => s.kind !== "business"));
    if (hasJobHome) out.push({ value: "co_op", label: "Work" });
  }
  out.push({ value: "none", label: NO_AREA_LABEL });
  return out;
}

/** The area preselected for the current route — shown and changeable, never applied silently. Falls back to "none" (the Inbox) whenever the route's area isn't one the account has. */
export function defaultCaptureArea(pathname: string, config: CaptureAreaConfig): CaptureArea {
  const { options, workTabs } = config;
  const offered = (a: CaptureArea) => options.some((o) => o.value === a);
  let want: CaptureArea = "none";
  if (pathname === "/school" || pathname.startsWith("/school/")) want = "school";
  else if (pathname === "/business" || pathname.startsWith("/business/")) want = "business";
  else if (pathname === "/work" || pathname.startsWith("/work/")) {
    const key = pathname.split("/")[2];
    const sub = key ? workTabs.find((s) => s.key === safeDecode(key)) : undefined;
    want = sub?.kind === "business" ? "business" : "co_op";
  }
  return offered(want) ? want : "none";
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
