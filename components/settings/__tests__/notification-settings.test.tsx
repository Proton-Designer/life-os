import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationSettings } from "../notification-settings";

const subscribeToPushMock = vi.fn();
vi.mock("@/lib/pwa/push-subscribe", () => ({
  subscribeToPush: (...args: unknown[]) => subscribeToPushMock(...args),
}));

function stubNotificationPermission(permission: "default" | "granted" | "denied") {
  Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
  // @ts-expect-error test-only global override
  globalThis.Notification = { permission };
}

describe("NotificationSettings", () => {
  beforeEach(() => {
    subscribeToPushMock.mockReset();
  });

  it("shows an unsupported message when push isn't available in this browser", () => {
    // @ts-expect-error test-only deletion
    delete globalThis.Notification;
    render(<NotificationSettings />);
    expect(screen.getByText(/aren't supported/i)).toBeInTheDocument();
  });

  it("shows 'Enable notifications' when permission hasn't been decided yet", () => {
    stubNotificationPermission("default");
    render(<NotificationSettings />);
    expect(screen.getByRole("button", { name: "Enable notifications" })).toBeInTheDocument();
  });

  it("shows 'Re-enable notifications' when already granted", () => {
    stubNotificationPermission("granted");
    render(<NotificationSettings />);
    expect(screen.getByRole("button", { name: "Re-enable notifications" })).toBeInTheDocument();
  });

  it("shows the real failure reason from subscribeToPush, not a generic message", async () => {
    stubNotificationPermission("denied");
    subscribeToPushMock.mockResolvedValue({ ok: false, reason: "Notifications are blocked — re-enable them in your browser." });
    render(<NotificationSettings />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Enable notifications" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/blocked/i);
    });
  });

  it("shows a success message when subscribeToPush succeeds", async () => {
    stubNotificationPermission("default");
    subscribeToPushMock.mockResolvedValue({ ok: true });
    render(<NotificationSettings />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Enable notifications" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/enabled/i);
    });
  });
});
