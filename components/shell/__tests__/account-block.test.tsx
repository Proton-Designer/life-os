import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));
vi.mock("@/app/(app)/actions", () => ({
  signOut: signOutMock,
}));

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
});
