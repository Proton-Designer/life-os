import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CapturePageClient } from "../capture-page-client";

const captureTaskMock = vi.fn(async (_input: unknown) => {});
const captureDistractionMock = vi.fn(async (_input: unknown) => {});
const captureDumpMock = vi.fn(async (_input: unknown) => {});
vi.mock("@/lib/capture/actions", () => ({
  captureTask: (input: unknown) => captureTaskMock(input),
  captureDistraction: (input: unknown) => captureDistractionMock(input),
  captureDump: (input: unknown) => captureDumpMock(input),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/capture",
  useRouter: () => ({ push: pushMock }),
}));

async function typeAndSave(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText("Capture input"), text);
  await user.click(screen.getByRole("button", { name: "Save" }));
}

// P3-17: the dedicated /capture route's own client shell. The underlying
// classify/parse/confirm behavior is CaptureForm's own, already fully
// covered by global-capture-sheet.test.tsx (which now exercises the same
// component) -- these tests are specifically about what's DIFFERENT here:
// no dialog, stays open for repeat captures, Close navigates Home.
describe("CapturePageClient", () => {
  beforeEach(() => {
    captureTaskMock.mockClear();
    captureDistractionMock.mockClear();
    captureDumpMock.mockClear();
    pushMock.mockClear();
  });

  it("Deen Mode: the distraction category offers Deen only when deenMode is on (fails closed by default)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CapturePageClient timezone="America/Chicago" />);
    await user.click(screen.getByRole("button", { name: "Distraction" }));
    expect(screen.getByLabelText("Distraction category")).not.toHaveTextContent("Deen");
    expect(screen.getByLabelText("Distraction category")).toHaveTextContent("Business");
    unmount();
    render(<CapturePageClient timezone="America/Chicago" deenMode />);
    await user.click(screen.getByRole("button", { name: "Distraction" }));
    expect(screen.getByLabelText("Distraction category")).toHaveTextContent("Deen");
  });

  it("renders the form directly -- no dialog role, no trigger button to open first", async () => {
    render(<CapturePageClient timezone="America/Chicago" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Capture input")).toBeInTheDocument();
  });

  it("a successful capture stays on the page and resets for another entry, rather than navigating away", async () => {
    const user = userEvent.setup();
    render(<CapturePageClient timezone="America/Chicago" />);

    await typeAndSave(user, "Submit lab report tomorrow at 5pm");

    expect(captureTaskMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByLabelText("Capture input")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a second capture after the first also persists -- the remounted form isn't stuck on old state", async () => {
    const user = userEvent.setup();
    render(<CapturePageClient timezone="America/Chicago" />);

    await typeAndSave(user, "First thing tomorrow");
    await typeAndSave(user, "Second thing tomorrow");

    expect(captureTaskMock).toHaveBeenCalledTimes(2);
  });

  it("Close navigates Home, not just closes a sheet that doesn't exist here", async () => {
    const user = userEvent.setup();
    render(<CapturePageClient timezone="America/Chicago" />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(pushMock).toHaveBeenCalledWith("/");
  });
});
