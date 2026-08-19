import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Topbar itself no longer reads the route (title moved to PageHeader), but
// its drawer renders SidebarNav, which does.
vi.mock("next/navigation", () => ({
  usePathname: () => "/deen",
}));

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));
vi.mock("@/app/(app)/actions", () => ({
  signOut: signOutMock,
}));

// Real next/link never forwards `prefetch` to the DOM (destructured out,
// consumed internally), so intercept it before Link eats it. Mirrors real
// rendering for every other prop this file's other assertions rely on.
// Also covers SidebarNav/AccountBlock, both rendered inside Topbar's drawer.
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

import { Topbar } from "../topbar";

const ACCOUNT = { displayName: "Ayman", email: "ayman@example.com" };

describe("Topbar", () => {
  it("does not render a page title — PageHeader owns it, to avoid rendering it twice", () => {
    render(<Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("shows the Life OS wordmark (visible only below lg, where the sidebar's own logo is hidden)", () => {
    render(<Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} />);
    expect(screen.getByRole("link", { name: /life os/i })).toHaveAttribute("href", "/");
  });

  it("shows today's date", () => {
    render(<Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} />);
    expect(screen.getByText("Fri, Aug 15")).toBeInTheDocument();
  });

  it("has no search field — deliberately rejected per spec", () => {
    render(<Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders a menu button that opens a drawer with the full nav", async () => {
    const user = userEvent.setup();
    render(<Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} />);

    await user.click(screen.getByRole("button", { name: /open menu/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Insights" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Weekly Planning" })).toBeInTheDocument();
  });

  it("closes the drawer on Escape", async () => {
    const user = userEvent.setup();
    render(<Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} />);
    await user.click(screen.getByRole("button", { name: /open menu/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the account trigger", () => {
    render(<Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} />);
    expect(screen.getByRole("button", { name: /account menu/i })).toBeInTheDocument();
  });

  it("prefetches its own cross-screen links (navigation-prefetch-fix, Part A)", () => {
    render(<Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} />);
    expect(screen.getByRole("link", { name: /life os/i })).toHaveAttribute("data-prefetch", "true");
    expect(
      screen.getByRole("link", { name: /no active lock-in session|lock-in session active/i })
    ).toHaveAttribute("data-prefetch", "true");
  });
});
