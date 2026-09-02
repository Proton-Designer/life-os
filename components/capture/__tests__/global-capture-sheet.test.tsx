import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalCaptureSheet } from "../global-capture-sheet";

const captureTaskMock = vi.fn(async (_input: unknown) => {});
const captureDistractionMock = vi.fn(async (_input: unknown) => {});
const captureDumpMock = vi.fn(async (_input: unknown) => {});
vi.mock("@/lib/capture/actions", () => ({
  captureTask: (input: unknown) => captureTaskMock(input),
  captureDistraction: (input: unknown) => captureDistractionMock(input),
  captureDump: (input: unknown) => captureDumpMock(input),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Capture" }));
}

// The Boss's brief (2026-09-02): "an ambiguous utterance persists ZERO rows... a
// resolvable one persists exactly one" — asserted here by counting calls to the mocked
// persistence functions before and after, not by the absence of a toast/error message.
describe("GlobalCaptureSheet", () => {
  beforeEach(() => {
    captureTaskMock.mockClear();
    captureDistractionMock.mockClear();
    captureDumpMock.mockClear();
  });

  it("an ambiguous utterance (temporal words with nothing left to title) persists zero rows — Confirm is disabled", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.type(screen.getByLabelText("Capture input"), "tomorrow at 6pm");
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    await user.click(confirm); // disabled — userEvent must not fire the handler either
    expect(captureTaskMock).toHaveBeenCalledTimes(0);
    expect(captureDistractionMock).toHaveBeenCalledTimes(0);
    expect(captureDumpMock).toHaveBeenCalledTimes(0);
  });

  it("an empty utterance also persists zero rows", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("a resolvable task utterance persists exactly one row, through captureTask only", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.type(screen.getByLabelText("Capture input"), "Submit lab report tomorrow at 5pm");
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).not.toBeDisabled();
    await user.click(confirm);
    expect(captureTaskMock).toHaveBeenCalledTimes(1);
    expect(captureDistractionMock).toHaveBeenCalledTimes(0);
    expect(captureDumpMock).toHaveBeenCalledTimes(0);
  });

  it("the parsed title reaches captureTask, and a resolved date is passed through", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.type(screen.getByLabelText("Capture input"), "Submit lab report tomorrow");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(captureTaskMock).toHaveBeenCalledWith({ title: "Submit lab report", dueDate: expect.any(String) });
  });

  it("a distraction capture routes through captureDistraction only, with the shown category confirmed", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Distraction" }));
    expect(screen.getByLabelText("Distraction category")).toBeInTheDocument(); // default category is SHOWN
    await user.type(screen.getByLabelText("Capture input"), "Checked phone");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(captureDistractionMock).toHaveBeenCalledTimes(1);
    expect(captureTaskMock).toHaveBeenCalledTimes(0);
    expect(captureDumpMock).toHaveBeenCalledTimes(0);
  });

  // R57, re-enabled 2026-09-02 (migrations 119/120 on production). Worry and Note are
  // both routed to captureDump with just {title} — no source distinction is passed from
  // here, because dump_source is this surface's own provenance ("capture"), not a
  // reflection of which button the user pressed (that's a content hint for them, not a
  // persisted fact — see global-capture-sheet.tsx's own comment and captureDump's).
  it("a worry capture routes through captureDump only, with no source field leaking through", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Worry" }));
    await user.type(screen.getByLabelText("Capture input"), "Worried about the exam");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(captureDumpMock).toHaveBeenCalledTimes(1);
    expect(captureDumpMock).toHaveBeenCalledWith({ title: "Worried about the exam" });
    expect(captureTaskMock).toHaveBeenCalledTimes(0);
    expect(captureDistractionMock).toHaveBeenCalledTimes(0);
  });

  it("a note capture also routes through captureDump only, identically to a worry capture", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Note" }));
    await user.type(screen.getByLabelText("Capture input"), "Remember this idea");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(captureDumpMock).toHaveBeenCalledTimes(1);
    expect(captureDumpMock).toHaveBeenCalledWith({ title: "Remember this idea" });
  });

  it("closing and reopening resets the input, so a stale draft never persists on a later, unrelated confirm", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.type(screen.getByLabelText("Capture input"), "Submit lab report tomorrow");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await openSheet(user);
    expect(screen.getByLabelText("Capture input")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});
