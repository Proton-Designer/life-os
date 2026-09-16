import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/app/(app)/settings/whoop-actions", () => ({
  disconnectWhoop: vi.fn(),
}));

import { disconnectWhoop } from "@/app/(app)/settings/whoop-actions";
import { WhoopSettings } from "../whoop-settings";

describe("WhoopSettings (P3-18)", () => {
  beforeEach(() => vi.mocked(disconnectWhoop).mockReset());

  it("shows the honest 'not configured' message when the env vars are absent -- the only reachable state tonight -- and no Connect/Disconnect control at all", () => {
    render(<WhoopSettings initialStatus={{ configured: false, connected: false, accessTokenLast4: null, connectedAt: null, scope: null }} />);
    expect(screen.getByText(/isn't configured on this deployment yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("configured, not connected: shows a real link to /api/whoop/authorize (a full-page navigation, not a client action)", () => {
    render(<WhoopSettings initialStatus={{ configured: true, connected: false, accessTokenLast4: null, connectedAt: null, scope: null }} />);
    const link = screen.getByRole("link", { name: "Connect Whoop" });
    expect(link).toHaveAttribute("href", "/api/whoop/authorize");
  });

  it("configured and connected: shows the last4 hint and a Disconnect button, never the full token", () => {
    render(<WhoopSettings initialStatus={{ configured: true, connected: true, accessTokenLast4: "abcd", connectedAt: "2026-09-15T12:00:00Z", scope: "offline read:sleep" }} />);
    expect(screen.getByText("····abcd")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("clicking Disconnect calls the Server Action and flips back to the not-connected state", async () => {
    vi.mocked(disconnectWhoop).mockResolvedValue({ ok: true, message: "Disconnected." });
    const user = userEvent.setup();
    render(<WhoopSettings initialStatus={{ configured: true, connected: true, accessTokenLast4: "abcd", connectedAt: "2026-09-15T12:00:00Z", scope: "offline" }} />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(disconnectWhoop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("link", { name: "Connect Whoop" })).toBeInTheDocument());
  });
});
