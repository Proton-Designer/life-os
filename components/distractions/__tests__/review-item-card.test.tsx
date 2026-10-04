import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewItemCard } from "../review-item-card";
import type { ReviewItem } from "@/lib/distractions/types";

const { saveMock, outcomeMock } = vi.hoisted(() => ({ saveMock: vi.fn(), outcomeMock: vi.fn() }));
vi.mock("@/app/(app)/distractions/actions", () => ({
  saveActionPlan: saveMock,
  recordPlanOutcome: outcomeMock,
  refreshDistractionViews: vi.fn(async () => {}),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const item = (over: { isNew?: boolean; followed?: number; skipped?: number } = {}): ReviewItem =>
  ({
    trigger: {
      id: "t1",
      name: "Doomscrolling",
      domain: "business",
      description: null,
      currentPlan: { body: "Phone in drawer", followedCount: over.followed ?? 1, skippedCount: over.skipped ?? 0 },
    },
    todayCount: 2,
    isNew: over.isNew ?? false,
  }) as unknown as ReviewItem;

describe("ReviewItemCard (PERF-4)", () => {
  beforeEach(() => {
    saveMock.mockReset();
    outcomeMock.mockReset();
  });

  it("collapses to Saved the instant a decision is made, submits once, then reports it reviewed", async () => {
    const write = deferred();
    outcomeMock.mockImplementation(() => write.promise);
    const onReviewed = vi.fn();
    render(<ReviewItemCard item={item()} onReviewed={onReviewed} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /didn't follow it/ }));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(onReviewed).not.toHaveBeenCalled();
    await act(async () => write.resolve());
    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith("t1", undefined));
    expect(outcomeMock).toHaveBeenCalledTimes(1);
  });

  it("a failed write brings the card back with an error and does not report it reviewed", async () => {
    saveMock.mockRejectedValue(new Error("nope"));
    const onReviewed = vi.fn();
    render(<ReviewItemCard item={item({ isNew: true })} onReviewed={onReviewed} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Plan of action"), "Drawer");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(onReviewed).not.toHaveBeenCalled();
  });

  it("a skip the server rejects falls back into the revise UI", async () => {
    outcomeMock.mockRejectedValue(new Error("must rewrite"));
    render(<ReviewItemCard item={item({ followed: 1, skipped: 0 })} onReviewed={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /didn't follow it/ }));
    expect(await screen.findByPlaceholderText("Rewritten plan")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a predicted forced rewrite opens the revise UI without calling the server", async () => {
    render(<ReviewItemCard item={item({ followed: 0, skipped: 2 })} onReviewed={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /didn't follow it/ }));
    expect(screen.getByPlaceholderText("Rewritten plan")).toBeInTheDocument();
    expect(outcomeMock).not.toHaveBeenCalled();
  });
});
