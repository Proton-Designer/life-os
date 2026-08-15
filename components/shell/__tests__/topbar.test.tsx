import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/deen",
}));

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));
vi.mock("@/app/(app)/actions", () => ({
  signOut: signOutMock,
}));

import { Topbar } from "../topbar";

const ACCOUNT = { displayName: "Ayman", email: "ayman@example.com" };

describe("Topbar", () => {
  it("shows the current route's title as chrome, not a duplicate page heading", () => {
    render(<Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} />);
    // Not role "heading": the real <h1> belongs to the page's own PageHeader —
    // Topbar's title is persistent chrome, and two h1s per page would be an
    // a11y smell.
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Deen" })).not.toBeInTheDocument();
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
});
