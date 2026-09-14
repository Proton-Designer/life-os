import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const deleteMyAccountMock = vi.fn();
vi.mock("@/app/(app)/settings/account-actions", () => ({
  deleteMyAccount: (...args: unknown[]) => deleteMyAccountMock(...args),
}));

import { DeleteAccountSection } from "../delete-account-section";

describe("DeleteAccountSection", () => {
  beforeEach(() => {
    deleteMyAccountMock.mockReset();
    // jsdom doesn't implement navigation — stub it so the success path's
    // window.location.href assignment doesn't throw ("not implemented").
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, href: "" },
    });
  });

  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /delete account/i }));
  }

  it("the confirm button stays disabled until the exact phrase DELETE is typed — the confirmation flow's teeth", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await openDialog(user);

    const confirmButton = screen.getByRole("button", { name: /permanently delete/i });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText(/type delete to confirm/i), "delete"); // wrong case
    expect(confirmButton).toBeDisabled();
    expect(deleteMyAccountMock).not.toHaveBeenCalled();
  });

  it("enables the confirm button once DELETE is typed exactly, and calls deleteMyAccount on click", async () => {
    deleteMyAccountMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await openDialog(user);

    await user.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    const confirmButton = screen.getByRole("button", { name: /permanently delete/i });
    expect(confirmButton).not.toBeDisabled();

    await user.click(confirmButton);
    expect(deleteMyAccountMock).toHaveBeenCalledWith("DELETE");
  });

  it("shows the server's error inline and never navigates away on failure", async () => {
    deleteMyAccountMock.mockResolvedValue({ ok: false, error: "Something went wrong." });
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await openDialog(user);
    await user.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    await user.click(screen.getByRole("button", { name: /permanently delete/i }));

    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    expect(window.location.href).toBe("");
  });

  it("cancel closes the dialog and clears the typed confirmation", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await openDialog(user);
    await user.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await openDialog(user);
    expect(screen.getByLabelText(/type delete to confirm/i)).toHaveValue("");
  });
});
