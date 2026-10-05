import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn(async (..._a: unknown[]): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true }));
vi.mock("@/app/(app)/morning-brief-actions", () => ({ setMorningBriefCollapsed: (...a: unknown[]) => save(...a) }));

import { MorningBriefPanel, MorningBriefProvider, MorningBriefToggle } from "../morning-brief";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

function Page(props: { hasBrief?: boolean; initialCollapsed?: boolean; date?: string }) {
  return (
    <MorningBriefProvider briefDate={props.date ?? "2026-10-05"} hasBrief={props.hasBrief ?? true} initialCollapsed={props.initialCollapsed ?? false}>
      <header>
        <MorningBriefToggle />
        <button type="button">edit widgets</button>
      </header>
      {props.hasBrief === false ? null : <MorningBriefPanel text="Today: three things." />}
    </MorningBriefProvider>
  );
}

describe("morning brief minimize (HOME-01b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyedQueuesForTests();
  });

  it("expanded by default: the brief shows with a minimize button; no header button yet", () => {
    render(<Page />);
    expect(screen.getByTestId("morning-brief")).toHaveTextContent("Today: three things.");
    expect(screen.getByTestId("brief-minimize")).toBeInTheDocument();
    expect(screen.queryByTestId("brief-expand")).not.toBeInTheDocument();
  });

  it("minimize folds it at once (optimistic) into a header button placed immediately LEFT of the edit button, and saves collapsed=true for that brief date", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    save.mockImplementationOnce(() => new Promise((r) => (release = () => r({ ok: true }))));
    render(<Page />);
    await user.click(screen.getByTestId("brief-minimize"));
    expect(screen.queryByTestId("morning-brief")).not.toBeInTheDocument(); // before the write finished
    const header = screen.getByRole("banner");
    const buttons = [...header.querySelectorAll("button")];
    expect(buttons[0]).toBe(screen.getByTestId("brief-expand"));
    expect(buttons[1]).toHaveTextContent("edit widgets");
    await waitFor(() => expect(save).toHaveBeenCalledWith("2026-10-05", true));
    release();
  });

  it("tapping the header button expands it again and saves collapsed=false", async () => {
    const user = userEvent.setup();
    render(<Page initialCollapsed />);
    expect(screen.queryByTestId("morning-brief")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("brief-expand"));
    expect(screen.getByTestId("morning-brief")).toBeInTheDocument();
    await waitFor(() => expect(save).toHaveBeenCalledWith("2026-10-05", false));
  });

  it("a failed save rolls back (the brief reappears) and says why", async () => {
    save.mockResolvedValueOnce({ ok: false, message: "Couldn't save that." });
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByTestId("brief-minimize"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that.");
    expect(screen.getByTestId("morning-brief")).toBeInTheDocument();
    expect(screen.queryByTestId("brief-expand")).not.toBeInTheDocument();
  });

  it("no brief today: no header button, even if a stale collapsed flag were set (positive control: with a brief it appears)", () => {
    const { unmount } = render(<Page hasBrief={false} initialCollapsed />);
    expect(screen.queryByTestId("brief-expand")).not.toBeInTheDocument();
    unmount();
    render(<Page hasBrief initialCollapsed />);
    expect(screen.getByTestId("brief-expand")).toBeInTheDocument();
  });

  it("a NEW day's brief opens expanded (initialCollapsed false for the new brief date)", () => {
    const { rerender } = render(<Page initialCollapsed date="2026-10-05" />);
    expect(screen.queryByTestId("morning-brief")).not.toBeInTheDocument();
    rerender(<Page initialCollapsed={false} date="2026-10-06" />);
    expect(screen.getByTestId("morning-brief")).toBeInTheDocument();
  });

  it("quick minimize then expand lands in order, last tap wins", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByTestId("brief-minimize"));
    await user.click(screen.getByTestId("brief-expand"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls.map((c) => c[1])).toEqual([true, false]);
    expect(screen.getByTestId("morning-brief")).toBeInTheDocument();
  });

  // eng1 review L4: a failed EXPAND must be visible, not screen-reader-only.
  it("a failed expand shows a visible message next to the header button and stays folded", async () => {
    save.mockResolvedValueOnce({ ok: false, message: "Couldn't save that." });
    const user = userEvent.setup();
    render(<Page initialCollapsed />);
    await user.click(screen.getByTestId("brief-expand"));
    const msg = await screen.findByTestId("brief-expand-error");
    expect(msg).toHaveTextContent("Couldn't show the brief");
    expect(msg.className).not.toContain("sr-only");
    expect(screen.queryByTestId("morning-brief")).not.toBeInTheDocument();
  });
});
