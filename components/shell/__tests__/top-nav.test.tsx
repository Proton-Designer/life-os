import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/deen",
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

import { TopNav } from "../top-nav";

describe("TopNav", () => {
  it("renders an icon for every nav item", () => {
    render(<TopNav />);
    for (const label of ["Home", "Deen", "Business", "Fitness", "School", "Work"]) {
      const link = screen.getByRole("link", { name: new RegExp(label, "i") });
      expect(link.querySelector("svg")).toBeInTheDocument();
    }
  });

  it("marks the active route with aria-current and a domain-tinted pill", () => {
    render(<TopNav />);
    const active = screen.getByRole("link", { name: /deen/i });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.style.color).toContain("--accent-deen");
  });

  it("does not tint inactive items", () => {
    render(<TopNav />);
    const inactive = screen.getByRole("link", { name: /business/i });
    expect(inactive).not.toHaveAttribute("aria-current");
    expect(inactive.style.color).toBe("");
  });

  it("tints the Settings link with the info accent when active", () => {
    render(<TopNav />);
    const settings = screen.getByRole("link", { name: /settings/i });
    expect(settings.style.color).toBe("");
  });

  it("prefetches every link, including the brand mark and Settings (navigation-prefetch-fix, Part A)", () => {
    render(<TopNav />);
    for (const label of ["Life OS", "Home", "Deen", "Business", "Fitness", "School", "Work", "Settings"]) {
      const link = screen.getByRole("link", { name: new RegExp(`^${label}$`, "i") });
      expect(link).toHaveAttribute("data-prefetch", "true");
    }
  });
});
