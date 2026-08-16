import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockUseLinkStatus = vi.fn();

vi.mock("next/link", () => ({
  useLinkStatus: () => mockUseLinkStatus(),
}));

import { NavLinkPendingHint } from "../nav-link-pending-hint";

describe("NavLinkPendingHint", () => {
  it("renders an always-present, hidden-from-a11y dot", () => {
    mockUseLinkStatus.mockReturnValue({ pending: false });
    render(<NavLinkPendingHint />);
    const dot = screen.getByTestId("nav-pending-dot");
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute("aria-hidden");
  });

  it("does not carry the is-pending class while idle", () => {
    mockUseLinkStatus.mockReturnValue({ pending: false });
    render(<NavLinkPendingHint />);
    expect(screen.getByTestId("nav-pending-dot")).not.toHaveClass("is-pending");
  });

  it("adds the is-pending class while the link's navigation is pending", () => {
    mockUseLinkStatus.mockReturnValue({ pending: true });
    render(<NavLinkPendingHint />);
    expect(screen.getByTestId("nav-pending-dot")).toHaveClass("is-pending");
  });
});
