import { redirect } from "next/navigation";
import { Moon, BookOpen, Dumbbell } from "lucide-react";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { SubdomainTabs, type SubdomainTabItem } from "@/components/shell/subdomain-tabs";
import type { AccentToken } from "@/lib/accent-tokens";

const SUBDOMAIN_META: Record<string, { label: string; icon: typeof Moon; accent: AccentToken }> = {
  faith: { label: "Faith", icon: Moon, accent: "deen" },
  self_mastery: { label: "Self-Mastery", icon: BookOpen, accent: "info" },
  fitness: { label: "Fitness", icon: Dumbbell, accent: "fitness" },
};

// mode:"legacy" accounts never reach this layout at all — the four-tab nav
// (the only thing that links here) doesn't render for them. A legacy
// account typing /personal/faith directly still gets a safe answer below
// rather than a crash, but that's defense in depth, not the primary guard.
export default async function PersonalSubdomainLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const userDomains = await getUserDomains();

  const kept =
    userDomains.mode === "domains"
      ? computeNavDomainState(userDomains.domains, userDomains.subdomains).personalSubdomains
      : [];

  if (kept.length === 0) {
    redirect("/");
  }
  if (!kept.some((s) => s.key === subdomain)) {
    redirect(`/personal/${kept[0].key}`);
  }

  const items: SubdomainTabItem[] = kept.map((s) => {
    const meta = SUBDOMAIN_META[s.key] ?? { label: s.label, icon: Moon, accent: "info" as AccentToken };
    return { key: s.key, href: `/personal/${s.key}`, label: meta.label, icon: meta.icon, accent: meta.accent, active: s.key === subdomain };
  });

  return (
    <>
      {/* Same horizontal rhythm as PageContainer (which every composed page
          below applies to its own content) but not the same component —
          nesting two PageContainers would double the vertical padding. Only
          rendered when there's actually more than one subdomain to switch
          between (SubdomainTabs returns null otherwise), so a single-
          subdomain account gets zero extra markup or spacing here. */}
      {items.length > 1 ? (
        <div className="mx-auto w-full max-w-[1600px] px-4 pt-6 md:px-6 md:pt-8 xl:px-8">
          <SubdomainTabs items={items} testIdPrefix="personal-subdomain-tab" />
        </div>
      ) : null}
      {children}
    </>
  );
}
