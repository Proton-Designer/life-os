import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/app/(app)/settings/canvas-actions", () => ({
  connectCanvas: vi.fn(),
  disconnectCanvas: vi.fn(),
  refreshCanvasCourses: vi.fn(),
  importConcludedCanvasCourses: vi.fn(),
  getCanvasConnectionStatus: vi.fn(),
  getCanvasCourseMappings: vi.fn(async () => []),
  setCourseMapping: vi.fn(),
  saveCanvasIcsFeedUrl: vi.fn(),
  reconcileCanvasIcs: vi.fn(),
}));

import { saveCanvasIcsFeedUrl, reconcileCanvasIcs, refreshCanvasCourses, importConcludedCanvasCourses, disconnectCanvas, getCanvasConnectionStatus, type CanvasConnectionStatus } from "@/app/(app)/settings/canvas-actions";
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
    expect(screen.getByText(/Not checked yet/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/feeds\/calendars/)).not.toBeInTheDocument();
  });

  it("clicking 'Reconcile now' calls the Server Action and shows the result summary message", async () => {
    vi.mocked(reconcileCanvasIcs).mockResolvedValue({
      ok: true,
      message: "Found 2 new assignments from your calendar feed, staged for your review.",
      summary: { parsedAssignmentEvents: 5, alreadyCovered: 3, linkedToExisting: 0, unmapped: 0, newlyStaged: 2, courseImport: { created: 0, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 } },
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

  // CANVAS-LITE-01: this used to hide the whole section while the token was
  // expired ("reconnect takes priority") -- an unrelated gate the section
  // had only inherited from being nested inside the token-connected branch.
  // A stale TOKEN says nothing about an independent ICS connection, and the
  // whole point of this task is that the feed must stay reachable
  // regardless of token state, so this now asserts the opposite of the old
  // behavior deliberately, not by accident.
  it("the calendar-feed section stays visible even while the token is expired -- it's independent of token state", () => {
    render(<CanvasSettings initialStatus={{ ...CONNECTED_NO_FEED, tokenStatus: "expired" }} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    expect(screen.getByText("Calendar feed")).toBeInTheDocument();
    expect(screen.getByLabelText("Canvas calendar feed URL")).toBeInTheDocument();
  });
});

const DISCONNECTED: CanvasConnectionStatus = {
  connected: false,
  instanceUrl: null,
  tokenLast4: null,
  canvasUserName: null,
  tokenStatus: null,
  lastSyncedAt: null,
  lastSyncError: null,
  icsFeedConnected: false,
  icsFeedLast4: null,
  lastIcsReconcileAt: null,
};

// CANVAS-LITE-01: some schools (UTD) don't let students mint Canvas access
// tokens. Every Canvas capability must have a real, reachable path that
// needs no token -- the calendar feed (P3-13) especially, since it used to
// be nested inside the token-connected branch and a no-token student never
// saw it at all.
describe("CanvasSettings -- no-token paths (CANVAS-LITE-01)", () => {
  it("defaults to the token tab for a disconnected, no-ICS account -- a neutral default, not a preference", () => {
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    expect(screen.getByRole("button", { name: "My school allows access tokens" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByLabelText("Canvas instance URL")).toBeInTheDocument();
  });

  it("defaults to the no-token tab when an ICS feed is already connected with no token", () => {
    render(
      <CanvasSettings
        initialStatus={{ ...DISCONNECTED, icsFeedConnected: true, icsFeedLast4: "wxyz" }}
        initialMappings={[]}
        localClasses={[]}
        storageConfigured={true}
      />
    );
    expect(screen.getByRole("button", { name: "My school doesn't" })).toHaveAttribute("aria-current", "true");
  });

  it("the calendar feed is reachable on a fully disconnected account -- the exact gap the user reported", () => {
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    // Even on the default (token) tab, with no token connected at all.
    expect(screen.getByText("Calendar feed")).toBeInTheDocument();
    expect(screen.getByLabelText("Canvas calendar feed URL")).toBeInTheDocument();
  });

  it("switching to the no-token tab shows the honest explainer and hides the token entry form", async () => {
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "My school doesn't" }));

    expect(screen.queryByLabelText("Canvas instance URL")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Calendar feed/).length).toBeGreaterThan(0); // still reachable regardless of tab
    expect(screen.getByText(/Paste a syllabus or Canvas announcement/)).toBeInTheDocument();
    expect(screen.getByText(/Enter grades by hand/)).toBeInTheDocument();
    expect(screen.getByText(/Connect an AI agent/)).toBeInTheDocument();
  });

  // CANVAS-LITE-02 shipped the agent-import recipe; CANVAS-LITE-03 made
  // classes auto-create on import -- this copy now describes both as real,
  // available capabilities rather than "landing soon."
  it("the agent-path copy links to Connectors and describes the import as real, including auto-created classes", async () => {
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "My school doesn't" }));

    const connectorsLink = screen.getByRole("link", { name: "Connectors" });
    expect(connectorsLink).toHaveAttribute("href", "#connectors");
    expect(screen.getByText(/classes getting created automatically/)).toBeInTheDocument();
  });

  it("switching back to the token tab restores the connect form, and the calendar feed is still there", async () => {
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "My school doesn't" }));
    await user.click(screen.getByRole("button", { name: "My school allows access tokens" }));

    expect(screen.getByLabelText("Canvas instance URL")).toBeInTheDocument();
    expect(screen.getByText("Calendar feed")).toBeInTheDocument();
  });

  it("neither tab label reads as a downgrade -- both are plain, factual, and neutrally worded", () => {
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    expect(screen.queryByText(/basic|limited|workaround|instead of/i)).not.toBeInTheDocument();
  });
});

// CANVAS-LITE-03: "the mapping list is reachable without a token" -- a
// course seen via agent import (CANVAS-LITE-02) or the ICS feed can be
// mapped/unmapped the same way a token-synced one can. Previously this
// list only rendered inside the token-connected branch, so a no-token
// user could never see or unlink their own mappings.
describe("CanvasSettings -- course mapping list is reachable regardless of token connection (CANVAS-LITE-03)", () => {
  const MAPPING = { id: "map-1", canvasCourseId: "10", canvasCourseName: "Organic Chemistry II", canvasCourseCode: "CHEM-2412", classId: "class-1" };

  it("shows the mapping list on the no-token tab even though Canvas was never token-connected", async () => {
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[MAPPING]} localClasses={[{ id: "class-1", label: "Chem II" }]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "My school doesn't" }));

    expect(screen.getByText("Course mapping")).toBeInTheDocument();
    expect(screen.getByText(/Organic Chemistry II/)).toBeInTheDocument();
  });

  it("shows the mapping list even when disconnected on the token tab (an agent-import-only account)", () => {
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[MAPPING]} localClasses={[{ id: "class-1", label: "Chem II" }]} storageConfigured={true} />);
    expect(screen.getByText("Course mapping")).toBeInTheDocument();
  });

  it("renders nothing for the mapping section when there are no mappings yet -- no empty-state noise", () => {
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    expect(screen.queryByText("Course mapping")).not.toBeInTheDocument();
  });

  it("choosing 'Not mapped' calls setCourseMapping with a null class id -- this is the unlink action", async () => {
    const { setCourseMapping } = await import("@/app/(app)/settings/canvas-actions");
    vi.mocked(setCourseMapping).mockResolvedValue({ ok: true, message: "Unlinked. Won't be re-imported automatically." });
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={DISCONNECTED} initialMappings={[MAPPING]} localClasses={[{ id: "class-1", label: "Chem II" }]} storageConfigured={true} />);

    await user.selectOptions(screen.getByRole("combobox"), "");

    await waitFor(() => expect(setCourseMapping).toHaveBeenCalledWith("map-1", null));
  });
});

// CANVAS-LITE-04: "state the count and offer to import them, rather than
// skipping silently" -- concluded/inactive courses.
describe("CanvasSettings -- concluded-courses offer (CANVAS-LITE-04)", () => {
  beforeEach(() => {
    vi.mocked(refreshCanvasCourses).mockReset();
    vi.mocked(importConcludedCanvasCourses).mockReset();
  });

  it("offers to import concluded courses after a sync that finds some, and hides the offer when there are none", async () => {
    vi.mocked(refreshCanvasCourses).mockResolvedValue({ ok: true, message: "Synced 3 courses. 2 concluded courses skipped.", concludedCount: 2 });
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={CONNECTED_NO_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    expect(screen.queryByRole("button", { name: /Import \d concluded/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sync courses" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Import 2 concluded courses" })).toBeInTheDocument());
  });

  it("clicking the offer calls importConcludedCanvasCourses and hides the offer again once done", async () => {
    vi.mocked(refreshCanvasCourses).mockResolvedValue({ ok: true, message: "Synced 3 courses.", concludedCount: 1 });
    vi.mocked(importConcludedCanvasCourses).mockResolvedValue({ ok: true, message: "Imported 1 concluded course. (1 class added)" });
    const user = userEvent.setup();
    render(<CanvasSettings initialStatus={CONNECTED_NO_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "Sync courses" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 concluded course" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Import 1 concluded course" }));

    expect(importConcludedCanvasCourses).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Import \d concluded/ })).not.toBeInTheDocument());
    expect(screen.getByText("Imported 1 concluded course. (1 class added)")).toBeInTheDocument();
  });
});

// CANVAS-GAP-07: Disconnect must say plainly what it will and will not remove.
describe("CanvasSettings -- Disconnect copy (CANVAS-GAP-07)", () => {
  it("with an ICS feed also connected: says only the token is removed and the feed stays", () => {
    render(<CanvasSettings initialStatus={CONNECTED_WITH_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    expect(screen.getByText(/Disconnect removes only the Canvas token\. Your calendar feed and course mappings stay connected\./)).toBeInTheDocument();
  });

  it("with no ICS feed: says the token is removed and mappings are kept, without claiming a feed survives", () => {
    render(<CanvasSettings initialStatus={CONNECTED_NO_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);
    expect(screen.getByText(/Disconnect removes the Canvas token\. Your course mappings are kept in case you reconnect later\./)).toBeInTheDocument();
  });
});

// CANVAS-GAP-09: the CLIENT-side optimistic state after a successful
// Disconnect must never hardcode icsFeedConnected:false -- disconnectCanvas
// (CANVAS-GAP-07) genuinely preserves an independent ICS feed, so the UI
// must reflect the server's real post-disconnect state, not a guess.
describe("CanvasSettings -- post-disconnect state reflects a surviving ICS feed (CANVAS-GAP-09)", () => {
  beforeEach(() => {
    vi.mocked(disconnectCanvas).mockReset();
    vi.mocked(getCanvasConnectionStatus).mockReset();
  });

  it("disconnecting an account with BOTH a token and an ICS feed still shows the ICS feed section immediately, no reload", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectCanvas).mockResolvedValue({ ok: true, message: "Token disconnected. Your calendar feed stays connected." });
    const postDisconnectStatus: CanvasConnectionStatus = { ...CONNECTED_WITH_FEED, connected: false, instanceUrl: null, tokenLast4: null, tokenStatus: null };
    vi.mocked(getCanvasConnectionStatus).mockResolvedValue(postDisconnectStatus);
    render(<CanvasSettings initialStatus={CONNECTED_WITH_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(getCanvasConnectionStatus).toHaveBeenCalled());
    // The ICS feed section (only rendered when icsFeedConnected) must still
    // be there -- not the pre-GAP-09 bug where a hardcoded
    // DISCONNECTED_STATUS hid it until a manual reload.
    expect(await screen.findByText(new RegExp(`····${CONNECTED_WITH_FEED.icsFeedLast4}`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconcile now" })).toBeInTheDocument();
  });

  it("disconnecting an account with ONLY a token (no ICS feed) shows the plain connect form again", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectCanvas).mockResolvedValue({ ok: true, message: "Disconnected. Your course mappings are kept in case you reconnect later." });
    vi.mocked(getCanvasConnectionStatus).mockResolvedValue({ ...CONNECTED_NO_FEED, connected: false, instanceUrl: null, tokenLast4: null, tokenStatus: null });
    render(<CanvasSettings initialStatus={CONNECTED_NO_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(getCanvasConnectionStatus).toHaveBeenCalled());
    expect(await screen.findByLabelText("Canvas instance URL")).toBeInTheDocument();
  });

  it("a failed disconnect never calls getCanvasConnectionStatus -- the status stays whatever it actually still is", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectCanvas).mockResolvedValue({ ok: false, message: "Couldn't disconnect. Try again." });
    render(<CanvasSettings initialStatus={CONNECTED_WITH_FEED} initialMappings={[]} localClasses={[]} storageConfigured={true} />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.getByText("Couldn't disconnect. Try again.")).toBeInTheDocument());
    expect(getCanvasConnectionStatus).not.toHaveBeenCalled();
  });
});

describe("CanvasSettings -- the calendar feed's automatic refresh", () => {
  it("shows 'Last checked' as a 12-hour time in the account's zone (never 24-hour, never a raw UTC string) and says it is automatic", () => {
    render(
      <CanvasSettings
        initialStatus={{ ...CONNECTED_WITH_FEED, connected: false, instanceUrl: null, lastIcsReconcileAt: "2026-10-25T18:05:00Z", timezone: "America/Chicago" }}
        initialMappings={[]}
        localClasses={[]}
        storageConfigured
      />,
    );
    expect(screen.getByText(/Last checked 10\/25\/2026, 1:05 PM/)).toBeInTheDocument();
    expect(screen.getByText(/about every 6 hours/)).toBeInTheDocument();
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
  });

  it("a feed that failed (404 / reset) shows a visible error under the feed", () => {
    render(
      <CanvasSettings
        initialStatus={{ ...CONNECTED_WITH_FEED, connected: false, instanceUrl: null, lastIcsReconcileAt: "2026-10-25T18:05:00Z", timezone: "America/Chicago", icsError: "The calendar feed returned an error (HTTP 404). Your feed link may have been reset in Canvas: paste a new one." }}
        initialMappings={[]}
        localClasses={[]}
        storageConfigured
      />,
    );
    expect(screen.getByTestId("ics-error")).toHaveTextContent(/HTTP 404/);
  });

  it("with no error there is no alert", () => {
    render(<CanvasSettings initialStatus={{ ...CONNECTED_WITH_FEED, connected: false, instanceUrl: null }} initialMappings={[]} localClasses={[]} storageConfigured />);
    expect(screen.queryByTestId("ics-error")).not.toBeInTheDocument();
    expect(screen.getByText(/Not checked yet/)).toBeInTheDocument();
  });
});
