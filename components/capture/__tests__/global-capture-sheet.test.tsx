import { render, screen, within } from "@testing-library/react";
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
let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

// IA-P1a: the sheet drives the app's ONE distraction logger; stubbed here (its own suite covers it).
vi.mock("@/components/distractions/distraction-capture-dialog", () => ({
  DistractionCaptureDialog: ({ inline, onOpenChange }: { inline?: boolean; onOpenChange?: (o: boolean) => void }) => (
    <div data-testid="shared-logger" data-inline={String(!!inline)}>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        mock-logged
      </button>
    </div>
  ),
}));

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
    pathname = "/";
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
    expect(captureTaskMock).toHaveBeenCalledWith({
      title: "Submit lab report",
      area: "none",
      dueDate: expect.any(String),
      dueTime: null,
    });
  });

  // #30/#31: a spoken time used to be parsed into the preview (formatParsedWhen shows
  // it) and then silently dropped on confirm — captureTask never received it, so
  // get-day-shape's timeline, calendar's timed-block bucket, and get-priority-items'
  // urgency ranking all missed the task (none of them see an untimed task). This is the
  // test that actually guards the fix: it fails the moment `dueTime` stops reaching
  // captureTask, unlike the sibling test above (no time in the utterance, nothing to
  // drop).
  it("a spoken time reaches captureTask as dueTime — regression test for #30/#31", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.type(screen.getByLabelText("Capture input"), "Submit lab report tomorrow at 5pm");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(captureTaskMock).toHaveBeenCalledWith({
      title: "Submit lab report",
      area: "none",
      dueDate: expect.any(String),
      dueTime: "17:00",
    });
  });

  it("Distraction embeds the shared logger under the SAME tab bar (not a separate popup); the user can switch back to another type", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    expect(screen.queryByTestId("shared-logger")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Distraction" }));
    expect(screen.getByTestId("shared-logger")).toHaveAttribute("data-inline", "true");
    // the tab bar is still there, the text form is not
    for (const tab of ["Task", "Distraction", "Worry", "Note"]) expect(screen.getByRole("button", { name: tab })).toBeInTheDocument();
    expect(screen.queryByLabelText("Capture input")).toBeNull();
    // not stuck on Distraction: Worry brings the text form back
    await user.click(screen.getByRole("button", { name: "Worry" }));
    expect(screen.queryByTestId("shared-logger")).toBeNull();
    expect(screen.getByLabelText("Capture input")).toBeInTheDocument();
    expect(captureDistractionMock).toHaveBeenCalledTimes(0);
    expect(captureTaskMock).toHaveBeenCalledTimes(0);
    expect(captureDumpMock).toHaveBeenCalledTimes(0);
  });

  it("the sheet closes once the embedded logger reports a distraction logged", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Distraction" }));
    await user.click(screen.getByRole("button", { name: "mock-logged" }));
    expect(screen.queryByTestId("shared-logger")).toBeNull();
    expect(screen.queryByRole("button", { name: "Worry" })).toBeNull();
  });

  describe("Task area (IA-P1a)", () => {
    const domainsAreas = {
      options: [
        { value: "school" as const, label: "School" },
        { value: "co_op" as const, label: "Work" },
        { value: "none" as const, label: "No area (Inbox)" },
      ],
      workTabs: [
        { key: "job", kind: "job" as const },
        { key: "shop", kind: "business" as const },
      ],
    };

    async function addTask(areas: typeof domainsAreas | undefined) {
      const user = userEvent.setup();
      render(<GlobalCaptureSheet timezone="America/Chicago" areas={areas} />);
      await openSheet(user);
      return user;
    }

    it("offers the account's own areas, with 'No area' last", async () => {
      await addTask(domainsAreas);
      const labels = within(screen.getByRole("radiogroup", { name: "Area" }))
        .getAllByRole("radio")
        .map((r) => r.textContent);
      expect(labels).toEqual(["School", "Work", "No area (Inbox)"]);
    });

    it("a domains account without Work is never offered Work", async () => {
      await addTask({ options: [domainsAreas.options[0]!, domainsAreas.options[2]!], workTabs: [] });
      expect(screen.queryByRole("radio", { name: "Work" })).toBeNull();
    });

    it.each([
      ["/school", "School"],
      ["/work/job", "Work"],
      ["/work", "Work"],
      ["/work/shop", "No area (Inbox)"], // Business has no task home — never guessed
      ["/business", "No area (Inbox)"],
      ["/", "No area (Inbox)"],
    ])("on %s the preselected area is %s", async (route, label) => {
      pathname = route;
      await addTask(domainsAreas);
      expect(screen.getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
    });

    it("the chosen area (not a hard-wired school) reaches captureTask", async () => {
      pathname = "/school";
      const user = await addTask(domainsAreas);
      await user.click(screen.getByRole("radio", { name: "Work" }));
      await user.type(screen.getByLabelText("Capture input"), "Send invoice");
      await user.click(screen.getByRole("button", { name: "Confirm" }));
      expect(captureTaskMock).toHaveBeenCalledWith({ title: "Send invoice", area: "co_op", dueDate: null, dueTime: null });
    });

    it("never offers a faith/Deen area (tasks have no such home)", async () => {
      await addTask(domainsAreas);
      expect(screen.queryByRole("radio", { name: /faith|deen/i })).toBeNull();
    });
  });

  // R57, re-enabled 2026-09-02 (migrations 119/120 on production), corrected same day:
  // dump_source is NOT uniform. Worry is a KIND the Night Plan's seeding/anti-worry hour
  // must find regardless of surface, so the Worry button sends source: "worry"; Note is
  // an undifferentiated capture with no kind, so it sends source: "capture".
  it("a worry capture routes through captureDump with source 'worry'", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Worry" }));
    await user.type(screen.getByLabelText("Capture input"), "Worried about the exam");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(captureDumpMock).toHaveBeenCalledTimes(1);
    expect(captureDumpMock).toHaveBeenCalledWith({ title: "Worried about the exam", source: "worry" });
    expect(captureTaskMock).toHaveBeenCalledTimes(0);
    expect(captureDistractionMock).toHaveBeenCalledTimes(0);
  });

  it("a note capture routes through captureDump with source 'capture', not 'worry'", async () => {
    const user = userEvent.setup();
    render(<GlobalCaptureSheet timezone="America/Chicago" />);
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Note" }));
    await user.type(screen.getByLabelText("Capture input"), "Remember this idea");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(captureDumpMock).toHaveBeenCalledTimes(1);
    expect(captureDumpMock).toHaveBeenCalledWith({ title: "Remember this idea", source: "capture" });
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
