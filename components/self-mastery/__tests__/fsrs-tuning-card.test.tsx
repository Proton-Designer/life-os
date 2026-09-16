import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/app/(app)/personal/fsrs-tuning-actions", () => ({
  triggerFsrsTuning: vi.fn(),
  FSRS_TUNING_MIN_REVIEWS: 1000,
}));

import { triggerFsrsTuning } from "@/app/(app)/personal/fsrs-tuning-actions";
import { FsrsTuningCard } from "../fsrs-tuning-card";

describe("FsrsTuningCard (P3-20)", () => {
  beforeEach(() => vi.mocked(triggerFsrsTuning).mockReset());

  it("below the gate: shows a progress count, no Tune button", () => {
    render(<FsrsTuningCard status={{ reviewCount: 400, eligible: false, tunedAt: null, reviewCountAtTrain: null }} />);
    expect(screen.getByText(/400 of 1000 reviews logged/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("eligible, never tuned: shows 'Tune now'", () => {
    render(<FsrsTuningCard status={{ reviewCount: 1200, eligible: true, tunedAt: null, reviewCountAtTrain: null }} />);
    expect(screen.getByText(/Eligible to tune \(1200 reviews logged\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tune now" })).toBeInTheDocument();
  });

  it("already tuned: shows the trained-on count/date and 'Retune'", () => {
    render(<FsrsTuningCard status={{ reviewCount: 1500, eligible: true, tunedAt: "2026-09-10T12:00:00Z", reviewCountAtTrain: 1200 }} />);
    expect(screen.getByText(/Tuned on 1200 reviews/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retune" })).toBeInTheDocument();
  });

  it("clicking Tune now calls the Server Action and shows the result message", async () => {
    vi.mocked(triggerFsrsTuning).mockResolvedValue({ ok: true, message: "Tuned on 1200 reviews." });
    const user = userEvent.setup();
    render(<FsrsTuningCard status={{ reviewCount: 1200, eligible: true, tunedAt: null, reviewCountAtTrain: null }} />);

    await user.click(screen.getByRole("button", { name: "Tune now" }));

    expect(triggerFsrsTuning).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("Tuned on 1200 reviews.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retune" })).toBeInTheDocument();
  });

  it("a rejected (cooldown) attempt surfaces the server's message honestly, without flipping to the tuned state", async () => {
    vi.mocked(triggerFsrsTuning).mockResolvedValue({ ok: false, message: "Already tuned recently -- try again in about 23h." });
    const user = userEvent.setup();
    render(<FsrsTuningCard status={{ reviewCount: 1200, eligible: true, tunedAt: "2026-09-10T12:00:00Z", reviewCountAtTrain: 1100 }} />);

    await user.click(screen.getByRole("button", { name: "Retune" }));

    await waitFor(() => expect(screen.getByText(/try again in about 23h/)).toBeInTheDocument());
    expect(screen.getByText(/Tuned on 1100 reviews/)).toBeInTheDocument(); // status unchanged, not silently marked re-tuned
  });
});
