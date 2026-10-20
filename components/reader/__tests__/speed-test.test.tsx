import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPEED_TEST_QUESTIONS } from "@/lib/reader/speed-test-passage";

const update = vi.fn();
vi.mock("@/app/(app)/personal/reader-actions", () => ({ updateReaderSettings: (p: unknown) => update(p) }));

import { SpeedTest } from "../speed-test";

function answerAll(correct: boolean[]) {
  SPEED_TEST_QUESTIONS.forEach((q, i) => {
    const pick = correct[i] ? q.answer : (q.answer + 1) % q.options.length;
    fireEvent.click(screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).name === `q${i}`)[pick]);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  update.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());

describe("SpeedTest", () => {
  it("start -> done -> answer -> result with wpm, comprehension and a button that saves the speed", async () => {
    render(<SpeedTest />);
    fireEvent.click(screen.getByText("Start"));
    expect(screen.getByTestId("speed-test-passage")).toBeInTheDocument();
    vi.advanceTimersByTime(60_000);
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("speed-test-passage")).toBeNull(); // hidden while answering
    answerAll([true, true, true]);
    fireEvent.click(screen.getByText("See my result"));
    const result = screen.getByTestId("speed-test-result");
    expect(result).toHaveTextContent("3 of 3 (100%)");
    const wpmText = /(\d+) words per minute/.exec(result.textContent ?? "");
    expect(Number(wpmText?.[1])).toBeGreaterThan(200); // ~280 words in 60 s
    const use = screen.getByRole("button", { name: /Use \d+ wpm in the reader/ });
    vi.useRealTimers();
    fireEvent.click(use);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toEqual({ wpm: Number(/Use (\d+) wpm/.exec(use.textContent ?? "")?.[1]) });
    expect(await screen.findByRole("status")).toHaveTextContent(/Saved/);
  });

  it("pressing Done at once is 'too quick to measure' with no save button (positive control for the guard)", () => {
    render(<SpeedTest />);
    fireEvent.click(screen.getByText("Start"));
    vi.advanceTimersByTime(300);
    fireEvent.click(screen.getByText("Done"));
    answerAll([true, true, true]);
    fireEvent.click(screen.getByText("See my result"));
    expect(screen.getByTestId("speed-test-result")).toHaveTextContent("too quick to measure");
    expect(screen.queryByRole("button", { name: /Use \d+ wpm/ })).toBeNull();
  });

  it("poor comprehension gets the 'slower' explanation and a lower suggestion", () => {
    render(<SpeedTest />);
    fireEvent.click(screen.getByText("Start"));
    vi.advanceTimersByTime(60_000);
    fireEvent.click(screen.getByText("Done"));
    answerAll([false, false, false]);
    fireEvent.click(screen.getByText("See my result"));
    expect(screen.getByTestId("speed-test-result")).toHaveTextContent("Understanding comes first");
  });
});
