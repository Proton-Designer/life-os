import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// Real next/link never forwards `prefetch` to the DOM (destructured out,
// consumed internally), so intercept it before Link eats it. Mirrors real
// rendering for every other prop this file's other assertions rely on.
// Also covers SidebarNav/AccountBlock, both rendered here.
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

import { AppSidebar } from "../app-sidebar";

describe("AppSidebar", () => {
  it("renders the logo linking home", () => {
    render(<AppSidebar account={{ displayName: "Ayman", email: "ayman@example.com" }} />);
    expect(screen.getAllByRole("link", { name: "Life OS" })[0]).toHaveAttribute("href", "/");
  });

  it("renders both the icon-rail and expanded nav content (CSS toggles which shows)", () => {
    render(<AppSidebar account={{ displayName: "Ayman", email: "ayman@example.com" }} />);
    // Both variants render simultaneously in jsdom (no real responsive CSS) —
    // same convention as the pre-existing TopNav/MobileIsland coexistence.
    expect(screen.getAllByRole("link", { name: "Home" }).length).toBeGreaterThanOrEqual(2);
  });

  it("renders the account block in both variants", () => {
    render(<AppSidebar account={{ displayName: "Ayman", email: "ayman@example.com" }} />);
    expect(screen.getAllByRole("button", { name: /account menu/i }).length).toBeGreaterThanOrEqual(2);
  });

  it("prefetches the logo link, in both variants (navigation-prefetch-fix, Part A)", () => {
    render(<AppSidebar account={{ displayName: "Ayman", email: "ayman@example.com" }} />);
    for (const link of screen.getAllByRole("link", { name: "Life OS" })) {
      expect(link).toHaveAttribute("data-prefetch", "true");
    }
  });
});
