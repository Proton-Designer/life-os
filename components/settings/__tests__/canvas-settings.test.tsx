import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/app/(app)/settings/canvas-actions", () => ({
  connectCanvas: vi.fn(),
  disconnectCanvas: vi.fn(),
  refreshCanvasCourses: vi.fn(),
  getCanvasConnectionStatus: vi.fn(),
  getCanvasCourseMappings: vi.fn(async () => []),
  setCourseMapping: vi.fn(),
  saveCanvasIcsFeedUrl: vi.fn(),
  reconcileCanvasIcs: vi.fn(),
}));

import { saveCanvasIcsFeedUrl, reconcileCanvasIcs, type CanvasConnectionStatus } from "@/app/(app)/settings/canvas-actions";
import { CanvasSettings } from "../canvas-settings";

const CONNECTED_NO_FEED: CanvasConnectionStatus = {
  connected: true,
  instanceUrl: "https://school.instructure.com",
  tokenLast4: "abcd",
  canvasUserName: "A. Student",
  tokenStatus: "ok",
  lastSyncedAt: null,
  lastSyncError: null,
  icsFeedConnected: false,
  icsFeedLast4: null,
  lastIcsReconcileAt: null,
};

const CONNECTED_WITH_FEED: CanvasConnectionStatus = {
  ...CONNECTED_NO_FEED,
  icsFeedConnected: true,
  icsFeedLast4: "wxyz",
  lastIcsReconcileAt: null,
};

describe("CanvasSettings -- ICS calendar-feed reconciliation (P3-13)", () => {
  beforeEach(() => {
    vi.mocked(saveCanvasIcsFeedUrl).mockReset();
    vi.mocked(reconcileCanvasIcs).mockReset();
  });

  it("shows a feed-URL paste form when connected but no feed is saved yet", () => {
    render(<CanvasSettings initialStatus={CONNECTED_NO_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    expect(screen.getByPlaceholderText(/feeds\/calendars/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save feed URL" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconcile now" })).not.toBeInTheDocument();
  });

  it("saving a feed URL calls the Server Action and flips to the connected-feed state, never re-displaying the pasted URL", async () => {
    vi.mocked(saveCanvasIcsFeedUrl).mockResolvedValue({ ok: true, message: "Calendar feed saved." });
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={CONNECTED_NO_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.type(screen.getByPlaceholderText(/feeds\/calendars/), "https://school.instructure.com/feeds/calendars/user_secret123.ics");
    await user.click(screen.getByRole("button", { name: "Save feed URL" }));

    await waitFor(() => expect(saveCanvasIcsFeedUrl).toHaveBeenCalledWith("https://school.instructure.com/feeds/calendars/user_secret123.ics"));
    await waitFor(() => expect(screen.getByText(/feed connected/)).toBeInTheDocument());
    // last4 of the URL with its trailing ".ics" stripped first (every real
    // feed URL ends in ".ics", so a naive slice(-4) would show ".ics" for
    // every user and tell nobody anything) -- computed client-side for
    // display only, never echoes the full secret back.
    expect(screen.getByText(/····t123/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/feeds\/calendars/)).not.toBeInTheDocument();
  });

  it("a failed save keeps the form visible and shows the error message", async () => {
    vi.mocked(saveCanvasIcsFeedUrl).mockResolvedValue({ ok: false, message: "That host resolves to a private or internal address, which isn't allowed." });
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={CONNECTED_NO_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.type(screen.getByPlaceholderText(/feeds\/calendars/), "http://169.254.169.254/feed.ics");
    await user.click(screen.getByRole("button", { name: "Save feed URL" }));

    await waitFor(() => expect(screen.getByText(/private or internal address/)).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/feeds\/calendars/)).toBeInTheDocument();
  });

  it("once a feed is connected, shows 'Reconcile now' instead of the paste form", () => {
    render(<CanvasSettings initialStatus={CONNECTED_WITH_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    expect(screen.getByRole("button", { name: "Reconcile now" })).toBeInTheDocument();
    expect(screen.getByText("Never reconciled yet.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/feeds\/calendars/)).not.toBeInTheDocument();
  });

  it("clicking 'Reconcile now' calls the Server Action and shows the result summary message", async () => {
    vi.mocked(reconcileCanvasIcs).mockResolvedValue({
      ok: true,
      message: "Found 2 new assignments from your calendar feed, staged for your review.",
      summary: { parsedAssignmentEvents: 5, alreadyCovered: 3, linkedToExisting: 0, unmapped: 0, newlyStaged: 2 },
    });
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={CONNECTED_WITH_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "Reconcile now" }));

    expect(reconcileCanvasIcs).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/Found 2 new assignments/)).toBeInTheDocument());
  });

  it("a rate-limited reconcile attempt surfaces the server's cooldown message honestly, without retrying itself", async () => {
    vi.mocked(reconcileCanvasIcs).mockResolvedValue({ ok: false, message: "Reconciled recently -- try again in 240s." });
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={CONNECTED_WITH_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "Reconcile now" }));

    await waitFor(() => expect(screen.getByText(/try again in 240s/)).toBeInTheDocument());
    expect(reconcileCanvasIcs).toHaveBeenCalledTimes(1);
  });

  it("the calendar-feed section is hidden entirely while the token is expired (reconnect takes priority)", () => {
    render(<CanvasSettings initialStatus={{ ...CONNECTED_NO_FEED, tokenStatus: "expired" }} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    expect(screen.queryByText("Calendar feed reconciliation")).not.toBeInTheDocument();
  });
});
