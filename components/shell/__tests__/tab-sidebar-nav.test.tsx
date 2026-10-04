import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// Real next/link never forwards `prefetch` to the DOM — intercept it before
// Link eats it, same pattern as sidebar-nav.test.tsx.
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockLink(
      { href, prefetch, children, ...rest }: React.ComponentPropsWithoutRef<"a"> & { prefetch?: unknown },
      ref: React.Ref<HTMLAnchorElement>
    ) {
      return (
        <a ref={ref} href={href} data-prefetch={String(prefetch)} {...rest}>
          {children}
        </a>
      );
    }),
    useLinkStatus: () => ({ pending: false }),
  };
});

import { TabSidebarNav } from "../tab-sidebar-nav";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";

const DOMAIN_STATE: NavDomainState = {
  hasPersonalGrowth: true,
  hasWork: true,
  hasSchool: true,
  personalSubdomains: [{ key: "faith", label: "Faith", kind: null }],
  workSubdomains: [],
};

describe("TabSidebarNav", () => {
  // UX-02: /business had zero click-path in domains-mode nav — confirmed
  // live on teamb-domains (fully functional page, unreachable except by
  // direct URL). Same dead-end shape S6/Phase 1 already fixed for
  // /worries, /goals, /habits in sidebar-nav.tsx (the LEGACY renderer);
  // this is the domains-mode renderer's own copy of that gap.
  it("links Business to /business under SYSTEM", () => {
    render(<TabSidebarNav variant="expanded" navDomainState={DOMAIN_STATE} />);
    expect(screen.getByRole("link", { name: /^business$/i })).toHaveAttribute("href", "/business");
  });

  // WORK-W1: with a Business tab on the Work screen, the SYSTEM "Business" link would be a second
  // door to the same screen (/business redirects there), so it is hidden. Without one it stays.
  it("hides the SYSTEM Business link iff the account has a Business work tab", () => {
    const withTab: NavDomainState = { ...DOMAIN_STATE, workSubdomains: [{ key: "shop", label: "Shop", kind: "business" }] };
    const { unmount } = render(<TabSidebarNav variant="expanded" navDomainState={withTab} />);
    expect(screen.queryByRole("link", { name: /^business$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^settings$/i })).toBeInTheDocument(); // rest of SYSTEM intact
    unmount();
    const jobOnly: NavDomainState = { ...DOMAIN_STATE, workSubdomains: [{ key: "co-op", label: "Co-op", kind: "job" }] };
    render(<TabSidebarNav variant="expanded" navDomainState={jobOnly} />);
    expect(screen.getByRole("link", { name: /^business$/i })).toHaveAttribute("href", "/business");
  });

  it("keeps the rest of SYSTEM's items reachable alongside Business", () => {
    render(<TabSidebarNav variant="expanded" navDomainState={DOMAIN_STATE} />);
    for (const [label, href] of [
      ["Insights", "/insights"],
      ["Calendar", "/calendar"],
      ["Settings", "/settings"],
    ] as const) {
      expect(screen.getByRole("link", { name: new RegExp(`^${label}$`, "i") })).toHaveAttribute("href", href);
    }
  });

  // IA-P2: Today and Review left the nav (the day lives on Home; the topbar moon link opens /close).
  it("does not list Today or Review under SYSTEM and none of the retired week screens (IA-P3); Insights is still there", () => {
    render(<TabSidebarNav variant="expanded" navDomainState={DOMAIN_STATE} />);
    expect(screen.queryByRole("link", { name: /^today$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^review$/i })).not.toBeInTheDocument();
    for (const name of [/^worries$/i, /^goals$/i, /^habits$/i, /^weekly review$/i]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /^insights$/i })).toBeInTheDocument();
  });
});
