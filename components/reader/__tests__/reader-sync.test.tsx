import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import { DEFAULT_READER_SETTINGS } from "@/lib/reader/types";
import { resetBodyPinForTests } from "@/lib/client/use-body-pin";
import { ReaderApp } from "../reader-app";

describe("ReaderApp server hooks", () => {
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

  it("reports position writes with the current speed and flushes on pause", () => {
    const onPositionWrite = vi.fn();
    const onLeave = vi.fn();
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" onPositionWrite={onPositionWrite} onLeave={onLeave} />);
    fireEvent.change(screen.getByLabelText("Position in book"), { target: { value: "30" } });
    act(() => void vi.advanceTimersByTime(600));
    expect(onPositionWrite).toHaveBeenLastCalledWith(30, expect.any(Number), 300);
    onLeave.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onLeave).toHaveBeenCalled();
  });

  it("flushes when the page is hidden", () => {
    const onLeave = vi.fn();
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" onLeave={onLeave} />);
    onLeave.mockClear();
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(onLeave).toHaveBeenCalled();
  });

  it("starts from the server settings and reports a changed setting", () => {
    const onSettingsChange = vi.fn();
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" serverSettings={{ ...DEFAULT_READER_SETTINGS, wpm: 450, theme: "sepia" }} onSettingsChange={onSettingsChange} />);
    expect(screen.getByTestId("reader-wpm")).toHaveTextContent("450");
    expect(screen.getByTestId("reader-root")).toHaveAttribute("data-theme", "sepia");
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    expect(onSettingsChange).toHaveBeenCalledWith({ wpm: 475 });
  });
});
