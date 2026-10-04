import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

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

import { TabMobileIsland } from "../tab-mobile-island";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";

const DOMAIN_STATE: NavDomainState = {
  hasPersonalGrowth: true,
  hasWork: true,
  hasSchool: true,
  personalSubdomains: [{ key: "faith", label: "Faith", kind: null }],
  workSubdomains: [],
};

describe("TabMobileIsland", () => {
  // UX-02: same gap as tab-sidebar-nav.tsx's own test — /business is fully
  // functional but reachable only by direct URL on domains-mode mobile too.
  it("reveals Business under More, linked to /business", async () => {
    const user = userEvent.setup();
    render(<TabMobileIsland navDomainState={DOMAIN_STATE} />);

    expect(screen.queryByRole("link", { name: /^business$/i })).not.toBeInTheDocument();

    await user.click(screen.getByTestId("tab-mobile-island-item-more"));

    expect(screen.getByRole("link", { name: /^business$/i })).toHaveAttribute("href", "/business");
  });

  // WORK-W1: hidden iff the account has a Business work tab (positive control: still there without one).
  it("hides Business under More iff the account has a Business work tab", async () => {
    const user = userEvent.setup();
    const withTab: NavDomainState = { ...DOMAIN_STATE, workSubdomains: [{ key: "shop", label: "Shop", kind: "business" }] };
    const { unmount } = render(<TabMobileIsland navDomainState={withTab} />);
    await user.click(screen.getByTestId("tab-mobile-island-item-more"));
    expect(screen.queryByRole("link", { name: /^business$/i })).not.toBeInTheDocument();
    unmount();
    render(<TabMobileIsland navDomainState={DOMAIN_STATE} />);
    await user.click(screen.getByTestId("tab-mobile-island-item-more"));
    expect(screen.getByRole("link", { name: /^business$/i })).toBeInTheDocument();
  });

  it("keeps the rest of the More popover reachable alongside Business", async () => {
    const user = userEvent.setup();
    render(<TabMobileIsland navDomainState={DOMAIN_STATE} />);
    await user.click(screen.getByTestId("tab-mobile-island-item-more"));
    for (const [label, href] of [
      ["Insights", "/insights"],
      ["Calendar", "/calendar"],
      ["Worries", "/worries"],
      ["Goals", "/goals"],
      ["Habits", "/habits"],
      ["Weekly Review", "/weekly-review"],
      ["Settings", "/settings"],
    ] as const) {
      expect(screen.getByRole("link", { name: new RegExp(`^${label}$`, "i") })).toHaveAttribute("href", href);
    }
  });

  // IA-P2: Today and Review left the nav (the day lives on Home; the topbar moon link opens /close).
  it("does not list Today or Review under More (positive control: Weekly Review is still there)", async () => {
    const user = userEvent.setup();
    render(<TabMobileIsland navDomainState={DOMAIN_STATE} />);
    await user.click(screen.getByTestId("tab-mobile-island-item-more"));
    expect(screen.queryByRole("link", { name: /^today$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^review$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^weekly review$/i })).toBeInTheDocument();
  });
});
