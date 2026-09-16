import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const createWebhook = vi.fn();
const deleteWebhook = vi.fn();
const testFireWebhook = vi.fn();
vi.mock("@/app/(app)/settings/webhook-actions", () => ({
  createWebhook: (...args: unknown[]) => createWebhook(...args),
  deleteWebhook: (...args: unknown[]) => deleteWebhook(...args),
  testFireWebhook: (...args: unknown[]) => testFireWebhook(...args),
}));

import { WebhookSettings } from "../webhook-settings";
import type { WebhookStatus } from "@/app/(app)/settings/webhook-actions";

function webhook(overrides: Partial<WebhookStatus> & { id: string }): WebhookStatus {
  return {
    url: "https://example.com/hook",
    secretLast4: "abcd",
    event: "write.ok",
    active: true,
    failureCount: 0,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    lastDeliveryError: null,
    createdAt: "2026-09-16T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  createWebhook.mockReset();
  deleteWebhook.mockReset();
  testFireWebhook.mockReset();
});

describe("WebhookSettings", () => {
  it("shows 'No webhooks yet.' with nothing to reveal, when there are none", () => {
    render(<WebhookSettings initialWebhooks={[]} />);
    expect(screen.getByText("No webhooks yet.")).toBeInTheDocument();
  });

  it("creating a webhook shows the raw secret exactly once, and adds it to the list", async () => {
    const user = userEvent.setup();
    createWebhook.mockResolvedValue({ ok: true, message: "Webhook created.", secret: "raw-secret-abc", status: webhook({ id: "wh-1" }) });
    render(<WebhookSettings initialWebhooks={[]} />);

    await user.type(screen.getByLabelText(/URL to receive deliveries/), "https://example.com/hook");
    await user.click(screen.getByRole("button", { name: "Add webhook" }));

    expect(await screen.findByText("raw-secret-abc")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/hook")).toBeInTheDocument();
  });

  it("a failed create surfaces the error message and never shows a fabricated secret", async () => {
    const user = userEvent.setup();
    createWebhook.mockResolvedValue({ ok: false, message: "That host can't be used." });
    render(<WebhookSettings initialWebhooks={[]} />);

    await user.type(screen.getByLabelText(/URL to receive deliveries/), "https://10.0.0.5/hook");
    await user.click(screen.getByRole("button", { name: "Add webhook" }));

    expect(await screen.findByText("That host can't be used.")).toBeInTheDocument();
    expect(screen.queryByText(/signing secret will not be shown again/)).not.toBeInTheDocument();
  });

  it("test-firing calls the Server Action with this webhook's id and shows the result message", async () => {
    const user = userEvent.setup();
    testFireWebhook.mockResolvedValue({ ok: true, message: "Test delivery sent -- check your receiver." });
    render(<WebhookSettings initialWebhooks={[webhook({ id: "wh-1" })]} />);

    await user.click(screen.getByRole("button", { name: "Test fire" }));

    expect(testFireWebhook).toHaveBeenCalledWith("wh-1");
    expect(await screen.findByText("Test delivery sent -- check your receiver.")).toBeInTheDocument();
  });

  it("removing a webhook calls the Server Action and drops it from the list", async () => {
    const user = userEvent.setup();
    deleteWebhook.mockResolvedValue({ ok: true, message: "Webhook removed." });
    render(<WebhookSettings initialWebhooks={[webhook({ id: "wh-1" })]} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(deleteWebhook).toHaveBeenCalledWith("wh-1");
    await screen.findByText("No webhooks yet.");
  });

  it("shows a disabled webhook's own status honestly, not as if it were healthy", () => {
    render(<WebhookSettings initialWebhooks={[webhook({ id: "wh-1", active: false, failureCount: 3, lastDeliveryStatus: "failed", lastDeliveryAt: "2026-09-16T00:00:00Z", lastDeliveryError: "HTTP 500" })]} />);
    expect(screen.getByText(/disabled after repeated failures/)).toBeInTheDocument();
    expect(screen.getByText("HTTP 500")).toBeInTheDocument();
  });
});
