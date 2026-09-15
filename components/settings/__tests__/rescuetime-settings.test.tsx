import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { RescueTimeSettings } from "../rescuetime-settings";
import type { RescueTimeConnectionStatus } from "@/app/(app)/settings/rescuetime-actions";

const connectRescueTimeMock = vi.fn(async (..._args: unknown[]) => ({ ok: true, message: "Connected." }));
const disconnectRescueTimeMock = vi.fn(async () => ({ ok: true, message: "Disconnected." }));
const syncRescueTimeSummariesMock = vi.fn(async () => ({ ok: true, message: "Synced 3 days." }));
vi.mock("@/app/(app)/settings/rescuetime-actions", () => ({
  connectRescueTime: (...args: unknown[]) => connectRescueTimeMock(...args),
  disconnectRescueTime: () => disconnectRescueTimeMock(),
  syncRescueTimeSummaries: () => syncRescueTimeSummariesMock(),
}));

const DISCONNECTED: RescueTimeConnectionStatus = { connected: false, keyLast4: null, lastSyncedAt: null, lastSyncError: null };
const CONNECTED: RescueTimeConnectionStatus = { connected: true, keyLast4: "abcd", lastSyncedAt: null, lastSyncError: null };

describe("RescueTimeSettings", () => {
  beforeEach(() => {
    connectRescueTimeMock.mockClear();
    disconnectRescueTimeMock.mockClear();
    syncRescueTimeSummariesMock.mockClear();
  });

  it("shows the connect form when disconnected, disabled until a key is typed", () => {
    render(<RescueTimeSettings initialStatus={DISCONNECTED} storageConfigured />);
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("connecting calls connectRescueTime with the trimmed key", async () => {
    const user = userEvent.setup();
    render(<RescueTimeSettings initialStatus={DISCONNECTED} storageConfigured />);

    await user.type(screen.getByLabelText("RescueTime API key"), "  rt-key-123  ");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(connectRescueTimeMock).toHaveBeenCalledWith("rt-key-123"));
  });

  it("shows connected status, Sync and Disconnect once connected", () => {
    render(<RescueTimeSettings initialStatus={CONNECTED} storageConfigured />);
    expect(screen.getByText(/····abcd/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("shows the last sync error when present", () => {
    render(<RescueTimeSettings initialStatus={{ ...CONNECTED, lastSyncError: "RescueTime rejected that key." }} storageConfigured />);
    expect(screen.getByText("RescueTime rejected that key.")).toBeInTheDocument();
  });

  it("Sync surfaces a message when the action itself rejects (defense in depth, P2-22-style)", async () => {
    syncRescueTimeSummariesMock.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<RescueTimeSettings initialStatus={CONNECTED} storageConfigured />);

    await user.click(screen.getByRole("button", { name: "Sync" }));

    expect(await screen.findByText("network down")).toBeInTheDocument();
  });

  it("Disconnect returns to the connect form", async () => {
    const user = userEvent.setup();
    render(<RescueTimeSettings initialStatus={CONNECTED} storageConfigured />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(await screen.findByLabelText("RescueTime API key")).toBeInTheDocument();
  });

  it("shows the storage-not-configured notice and keeps the form disabled", () => {
    render(<RescueTimeSettings initialStatus={DISCONNECTED} storageConfigured={false} />);
    expect(screen.getByText(/Key storage isn't configured/)).toBeInTheDocument();
    expect(screen.getByLabelText("RescueTime API key")).toBeDisabled();
  });
});
