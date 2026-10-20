import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import type { HighlightItem } from "@/lib/reader/highlights";
import type { ReadingStats } from "@/lib/reader/server/stats";
import { resetBodyPinForTests } from "@/lib/client/use-body-pin";
import { ReaderApp } from "../reader-app";

const saved = (over: Partial<HighlightItem> = {}): HighlightItem => ({ id: "h1", startWord: 0, endWord: 3, text: "saved passage", note: null, createdAt: "2026-10-19T12:00:00Z", ...over });
const STATS: ReadingStats = { today: "2026-10-19", todayWords: 320, dailyWordGoal: 1000, goalMet: false, streak: 3, avgWpm: 300, last7: [] };

describe("ReaderApp highlights + sessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBodyPinForTests();
    localStorage.clear();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    vi.useRealTimers();
    resetBodyPinForTests();
  });

  it("the highlight button saves the current sentence and lists it", async () => {
    const onCreateHighlight = vi.fn(async (r: { startWord: number; endWord: number; text: string }) => saved({ id: "new", ...r }));
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" onCreateHighlight={onCreateHighlight} />);
    fireEvent.click(screen.getByRole("button", { name: "Highlight this sentence" }));
    await act(async () => {});
    expect(onCreateHighlight).toHaveBeenCalledTimes(1);
    const arg = onCreateHighlight.mock.calls[0][0];
    expect(arg.startWord).toBe(0);
    expect(arg.endWord).toBeGreaterThan(0);
    expect(arg.text.split(" ")).toHaveLength(arg.endWord - arg.startWord + 1);
    expect(screen.getByText("Highlight saved")).toHaveAttribute("role", "status");
    fireEvent.click(screen.getByRole("button", { name: "Highlights (1)" }));
    expect(screen.getByTestId("highlight-list")).toHaveTextContent(arg.text);
  });

  it("a failed save says so and adds nothing", async () => {
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" onCreateHighlight={async () => null} />);
    fireEvent.click(screen.getByRole("button", { name: "Highlight this sentence" }));
    await act(async () => {});
    expect(screen.getByText(/Couldn.t save/)).toHaveAttribute("role", "status");
    expect(screen.queryByRole("button", { name: /Highlights \(/ })).toBeNull();
  });

  it("tapping a saved highlight jumps to it in the page view; delete removes it on the server", async () => {
    const onDeleteHighlight = vi.fn(async () => true);
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" highlights={[saved({ startWord: 12, endWord: 15 })]} onDeleteHighlight={onDeleteHighlight} />);
    fireEvent.click(screen.getByRole("button", { name: "Highlights (1)" }));
    fireEvent.click(screen.getByText("saved passage"));
    expect(screen.getByTestId("page-view")).toBeInTheDocument();
    expect(screen.getByTestId("page-view").querySelector("[data-highlight]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Highlights (1)" }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete highlight/ }));
    await act(async () => {});
    expect(onDeleteHighlight).toHaveBeenCalledWith("h1");
    expect(screen.queryByRole("button", { name: /Highlights \(/ })).toBeNull();
  });

  it("opens in the page view at startAt", () => {
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" startAt={40} />);
    expect(screen.getByTestId("page-view")).toBeInTheDocument();
    expect(screen.getByTestId("reader-wpm")).toBeInTheDocument();
  });

  it("records a session when reading pauses", () => {
    const onSession = vi.fn();
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" onSession={onSession} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    for (let i = 0; i < 12; i++) act(() => void vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession.mock.calls[0][0]).toMatchObject({ mode: "rsvp" });
    expect(onSession.mock.calls[0][0].wordsRead).toBeGreaterThanOrEqual(5);
  });

  it("positive control: jumping with the scrubber is navigation, not reading", () => {
    const onSession = vi.fn();
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" onSession={onSession} />);
    fireEvent.change(screen.getByLabelText("Position in book"), { target: { value: "200" } });
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(onSession).not.toHaveBeenCalled();
  });

  it("shows today's progress and opens the stats", () => {
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" stats={STATS} />);
    expect(screen.getByTestId("stats-bar")).toHaveTextContent("320 / 1,000 words today · 3-day streak");
    fireEvent.click(screen.getByTestId("stats-bar"));
    expect(screen.getByTestId("reading-stats")).toBeInTheDocument();
  });

  it("no stats and no highlights means no extra bar", () => {
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" />);
    expect(screen.queryByTestId("stats-bar")).toBeNull();
  });
});
