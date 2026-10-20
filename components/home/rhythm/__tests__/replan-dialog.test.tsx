import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getReplanData = vi.fn(async () => ({ todayLines: [{ id: "l1", title: "Draft the memo" }], planSeeds: [], killList: false, areas: [], workTabs: [], timezone: "UTC" }));
vi.mock("@/app/(app)/close/actions", () => ({ getReplanData: () => getReplanData() }));

// The stage is stubbed: it hands the dialog a save whose result the test controls.
const flush = vi.fn<() => Promise<boolean>>();
vi.mock("@/components/evening-close/close-plan-stage", () => ({
  ClosePlanStage: ({ registerFlush }: { registerFlush?: (f: () => Promise<boolean>) => void }) => {
    registerFlush?.(() => flush());
    return <div data-testid="plan-stage">stage</div>;
  },
}));

import { ReplanDialog } from "../replan-dialog";

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  render(<ReplanDialog />);
  await user.click(screen.getByTestId("replan-open"));
  await screen.findByTestId("plan-stage");
}
const dialogGone = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

beforeEach(() => {
  flush.mockReset().mockResolvedValue(true);
});

describe("ReplanDialog saves when it closes", () => {
  it("the X button saves first, then closes", async () => {
    const user = userEvent.setup();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(flush).toHaveBeenCalledTimes(1);
    await dialogGone();
  });

  it("Escape saves first, then closes", async () => {
    const user = userEvent.setup();
    await openDialog(user);
    await user.keyboard("{Escape}");
    expect(flush).toHaveBeenCalledTimes(1);
    await dialogGone();
  });

  it("a tap outside saves first, then closes", async () => {
    const user = userEvent.setup();
    await openDialog(user);
    await user.click(document.body.querySelector('[data-slot="dialog-overlay"]') as HTMLElement);
    expect(flush).toHaveBeenCalledTimes(1);
    await dialogGone();
  });

  it("a save that fails keeps it open; closing again leaves without saving a second time", async () => {
    flush.mockResolvedValue(false);
    const user = userEvent.setup();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // positive control: it did NOT close
    await user.click(screen.getByRole("button", { name: "Close" }));
    await dialogGone();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("stays open while the save is in flight, and a second close during it does not save twice", async () => {
    let done!: (ok: boolean) => void;
    flush.mockImplementation(() => new Promise<boolean>((r) => (done = r)));
    const user = userEvent.setup();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.keyboard("{Escape}");
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => done(true));
    await dialogGone();
  });
});
