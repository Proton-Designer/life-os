import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));
vi.mock("@/app/(app)/actions", () => ({
  signOut: signOutMock,
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
  };
});

import { AccountBlock } from "../account-block";

describe("AccountBlock", () => {
  it("shows the display name and truncated email", () => {
    render(<AccountBlock displayName="Ayman" email="ayman.mohammed@newtonbev.com" variant="expanded" />);
    expect(screen.getByText("Ayman")).toBeInTheDocument();
    expect(screen.getByText("ayman.mohammed@newtonbev.com")).toBeInTheDocument();
  });

  it("opens an overflow menu with Settings, Export data, and Sign out", async () => {
    const user = userEvent.setup();
    render(<AccountBlock displayName="Ayman" email="ayman.mohammed@newtonbev.com" variant="expanded" />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: /export data/i })).toHaveAttribute("href", "/settings/export");
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("calls signOut when Sign out is submitted", async () => {
    const user = userEvent.setup();
    render(<AccountBlock displayName="Ayman" email="ayman.mohammed@newtonbev.com" variant="expanded" />);
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOutMock).toHaveBeenCalled();
  });

  it("icon-rail variant renders only the avatar trigger, no name/email text", () => {
    render(<AccountBlock displayName="Ayman" email="ayman.mohammed@newtonbev.com" variant="icon-rail" />);
    expect(screen.queryByText("Ayman")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /account menu/i })).toBeInTheDocument();
  });

  it("prefetches Settings, a real screen — but not Export data, a route handler that downloads a file rather than rendering one (navigation-prefetch-fix, Part A)", async () => {
    const user = userEvent.setup();
    render(<AccountBlock displayName="Ayman" email="ayman.mohammed@newtonbev.com" variant="expanded" />);
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("data-prefetch", "true");
    expect(screen.getByRole("link", { name: /export data/i })).toHaveAttribute("data-prefetch", "undefined");
  });
});
