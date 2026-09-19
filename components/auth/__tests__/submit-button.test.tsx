import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthSubmitButton } from "../submit-button";

// ONB item 1: signup (and login) gave zero visual feedback on submit — the
// button didn't even disable — because the plain <form action={...}> path
// has no client JS. This proves the fix is a missing-feedback fix, not a
// speed fix: the action below is a real, uncontrolled-duration promise
// (nothing here makes it faster), and the assertion is purely about what
// the button LOOKS like while it's pending, not how long that takes.
describe("AuthSubmitButton (ONB item 1)", () => {
  it("disables immediately on submit and shows the pending label, then reverts once the action resolves — honest about latency, not hiding it", async () => {
    const user = userEvent.setup();
    let resolveAction!: () => void;
    const action = () => new Promise<void>((resolve) => { resolveAction = resolve; });

    render(
      <form action={action}>
        <AuthSubmitButton label="Sign up" pendingLabel="Signing up…" />
      </form>
    );

    const idleButton = screen.getByRole("button", { name: "Sign up" });
    expect(idleButton).not.toBeDisabled();

    await user.click(idleButton);

    await waitFor(() => {
      const pendingButton = screen.getByRole("button", { name: "Signing up…" });
      expect(pendingButton).toBeDisabled();
      expect(pendingButton).toHaveAttribute("aria-busy", "true");
    });

    resolveAction();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign up" })).not.toBeDisabled();
    });
  });

  it("renders the given label and stays enabled before any submission", () => {
    render(
      <form action={() => Promise.resolve()}>
        <AuthSubmitButton label="Sign in" pendingLabel="Signing in…" />
      </form>
    );
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy", "true");
  });
});
