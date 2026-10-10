import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const prefetchMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/deen",
  useRouter: () => ({ prefetch: prefetchMock }),
}));

// Real next/link never forwards `prefetch` to the DOM (destructured out,
// consumed internally), so intercept it before Link eats it. Mirrors real
// rendering for every other prop this file's other assertions rely on.
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

import { resetIntentPrefetchForTests } from "../intent-link";
import { MobileIsland } from "../mobile-island";

describe("MobileIsland", () => {
  it("renders exactly 7 top-level nav targets — Home, Faith, Business, School, Fitness, Work, More (batch 3, item 2)", () => {
    render(<MobileIsland />);
    expect(screen.getAllByTestId(/^mobile-island-item-/)).toHaveLength(7);
  });

  it("reveals Insights and Settings links when tapping More", async () => {
    const user = userEvent.setup();
    render(<MobileIsland />);

    expect(screen.queryByRole("link", { name: /insights/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /more/i }));

    expect(screen.getByRole("link", { name: /insights/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
  });

  // IA-P2/P3: Today, Review, Worries, Goals, Habits and Weekly Review left More; Insights (and Settings) stay.
  it("does not reveal the retired destinations under More, but keeps Insights", async () => {
    const user = userEvent.setup();
    render(<MobileIsland />);
    await user.click(screen.getByRole("button", { name: /more/i }));
    for (const name of [/^today$/i, /^review$/i, /^worries$/i, /^goals$/i, /^habits$/i, /^weekly review$/i]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /^insights$/i })).toBeInTheDocument();
  });

  it("also reveals the Ask AI platform links under More, without growing the fixed icon row", async () => {
    const user = userEvent.setup();
    render(<MobileIsland />);

    // The row of 7 fixed touch targets (see the other test in this file) is
    // calculated to the 320px floor — Ask AI must not add an 8th.
    expect(screen.getAllByTestId(/^mobile-island-item-/)).toHaveLength(7);

    await user.click(screen.getByRole("button", { name: /more/i }));

    for (const name of ["Claude", "ChatGPT", "Gemini"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("marks the active route with aria-current", () => {
    render(<MobileIsland />);
    expect(screen.getByTestId("mobile-island-item-deen")).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByTestId("mobile-island-item-home")).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("renders a Lucide icon for every top-level item, no emoji", () => {
    render(<MobileIsland />);
    for (const key of ["home", "deen", "business", "school", "fitness", "work"]) {
      expect(screen.getByTestId(`mobile-island-item-${key}`).querySelector("svg")).toBeInTheDocument();
    }
  });

  it("tints the active item with its domain accent", () => {
    render(<MobileIsland />);
    expect(screen.getByTestId("mobile-island-item-deen").style.color).toContain("--accent-deen");
    expect(screen.getByTestId("mobile-island-item-home").style.color).toBe("");
  });

  // NAV-03b: one-shot imperative intent prefetch (touchstart fires before the click on a phone).
  it("nothing prefetches up front; hovering/touching a target (or a More item) calls router.prefetch(href, full)", async () => {
    prefetchMock.mockClear();
    resetIntentPrefetchForTests();
    const user = userEvent.setup();
    render(<MobileIsland />);
    for (const key of ["home", "deen", "business", "school", "fitness", "work"]) {
      expect(screen.getByTestId(`mobile-island-item-${key}`)).toHaveAttribute("data-prefetch", "false");
    }
    expect(prefetchMock).not.toHaveBeenCalled();
    await user.hover(screen.getByTestId("mobile-island-item-school"));
    expect(prefetchMock).toHaveBeenCalledWith("/school", { kind: "full" });
    expect(prefetchMock).toHaveBeenCalledTimes(1); // neighbours untouched
    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.hover(screen.getByRole("link", { name: /insights/i }));
    expect(prefetchMock).toHaveBeenCalledWith("/insights", { kind: "full" });
  });

  // L10 (docs/ai-connector/PROGRAM-PLAN.md).
  describe("hiddenFeatures", () => {
    it("Faith Mode OFF (deen folded into hiddenFeatures) hides the Faith slot only", () => {
      render(<MobileIsland hiddenFeatures={["deen"]} />);
      expect(screen.queryByTestId("mobile-island-item-deen")).not.toBeInTheDocument();
      for (const key of ["home", "business", "school", "fitness", "work"]) {
        expect(screen.getByTestId(`mobile-island-item-${key}`)).toBeInTheDocument();
      }
    });

    it("omits the matching item from the fixed icon row, leaves the rest and the row's own touch-target math intact", () => {
      render(<MobileIsland hiddenFeatures={["business"]} />);
      expect(screen.queryByTestId("mobile-island-item-business")).not.toBeInTheDocument();
      for (const key of ["home", "deen", "school", "fitness", "work"]) {
        expect(screen.getByTestId(`mobile-island-item-${key}`)).toBeInTheDocument();
      }
    });

    it("also omits Insights from the More popover when hidden", async () => {
      const user = userEvent.setup();
      render(<MobileIsland hiddenFeatures={["insights"]} />);
      await user.click(screen.getByRole("button", { name: /more/i }));
      expect(screen.queryByRole("link", { name: /^insights$/i })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
    });

    it("never hides Home, even given a bad value that bypasses FeatureId's type", () => {
      render(<MobileIsland hiddenFeatures={["home"] as never} />);
      expect(screen.getByTestId("mobile-island-item-home")).toBeInTheDocument();
    });

    it("defaults to hiding nothing when the prop is omitted", () => {
      render(<MobileIsland />);
      expect(screen.getAllByTestId(/^mobile-island-item-/)).toHaveLength(7);
    });
  });
});
