import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationPermissionNudge } from "../notification-permission-nudge";

const subscribeToPushMock = vi.fn();
vi.mock("@/lib/pwa/push-subscribe", () => ({
  subscribeToPush: (...args: unknown[]) => subscribeToPushMock(...args),
}));

function stubNotificationPermission(permission: "default" | "granted" | "denied") {
  // @ts-expect-error test-only global override
  globalThis.Notification = { permission };
}

describe("NotificationPermissionNudge", () => {
  beforeEach(() => {
    subscribeToPushMock.mockReset();
  });

  it("renders nothing once permission is already granted", () => {
    stubNotificationPermission("granted");
    const { container } = render(<NotificationPermissionNudge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when Notification isn't supported in this browser", () => {
    // @ts-expect-error test-only deletion
    delete globalThis.Notification;
    const { container } = render(<NotificationPermissionNudge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an Enable prompt when permission hasn't been decided yet", () => {
    stubNotificationPermission("default");
    render(<NotificationPermissionNudge />);
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(screen.getByText(/every 2 hours/i)).toBeInTheDocument();
  });

  it("shows a blocked message with no Enable button when permission is denied", () => {
    stubNotificationPermission("denied");
    render(<NotificationPermissionNudge />);
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
  });

  it("shows the real success message from subscribeToPush after a click", async () => {
    stubNotificationPermission("default");
    subscribeToPushMock.mockResolvedValue({ ok: true });
    render(<NotificationPermissionNudge />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/enabled/i);
    });
  });
});
