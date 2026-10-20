import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import { buildDocWords } from "@/lib/reader/doc-words";
import { resetBodyPinForTests } from "@/lib/client/use-body-pin";
import { ReaderApp } from "../reader-app";
import { ReaderControls } from "../reader-controls";
import { HighlightsDialog } from "../highlights-dialog";
import { readerKeyAction } from "../reader-keys";

const dw = buildDocWords(SAMPLE_DOC);

function controls(over: Partial<React.ComponentProps<typeof ReaderControls>> = {}) {
  const noop = () => {};
  return render(
    <ReaderControls totalWords={1000} index={410} playing={false} wpm={300} chapterTitle="Chapter 2" onToggle={noop} onBack={noop} onForward={noop} onSeek={noop} onWpm={noop} {...over} />
  );
}

describe("reader controls a11y", () => {
  it("gives the position slider a human value: chapter and percent", () => {
    controls();
    expect(screen.getByRole("slider", { name: "Position in book" })).toHaveAttribute("aria-valuetext", "Chapter 2, 41%");
  });

  it("omits the chapter from the slider value when the book has none", () => {
    controls({ chapterTitle: null });
    expect(screen.getByRole("slider", { name: "Position in book" })).toHaveAttribute("aria-valuetext", "41%");
  });

  it("announces the place on pause and says nothing while playing (positive control: the paused text is non-empty)", () => {
    const { rerender } = controls({ playing: false });
    expect(screen.getByTestId("reader-status")).toHaveTextContent("Paused. Chapter 2, 41% read, word 411 of 1000.");
    const noop = () => {};
    rerender(<ReaderControls totalWords={1000} index={420} playing wpm={300} chapterTitle="Chapter 2" onToggle={noop} onBack={noop} onForward={noop} onSeek={noop} onWpm={noop} />);
    expect(screen.getByTestId("reader-status")).toBeEmptyDOMElement();
    expect(screen.getByTestId("reader-status")).toHaveAttribute("role", "status");
  });

  it("keeps the names the e2e flow clicks", () => {
    controls();
    for (const name of ["Back one sentence", "Play", "Forward one sentence", "Slower", "Faster"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("RSVP word is not a live region", () => {
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

  it("has no aria-live on the word or its ancestors up to the reading area", () => {
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/self-mastery" />);
    const word = screen.getByTestId("rsvp-word");
    expect(word).toHaveAttribute("role", "img");
    expect(word.getAttribute("aria-label")).toBe(dw.words[0]);
    for (let el: HTMLElement | null = word; el && el !== document.body; el = el.parentElement) {
      expect(el.getAttribute("aria-live")).toBeNull();
      expect(el.getAttribute("role")).not.toBe("status");
    }
  });

  it("makes the page text a labelled, focusable region so the keyboard can scroll it", () => {
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/self-mastery" />);
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    const region = screen.getByRole("region", { name: "Book text" });
    expect(region).toHaveAttribute("tabindex", "0");
  });
});

describe("keys never fire from controls that own them", () => {
  const base = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false };
  it("leaves the arrows and space alone on the range sliders and dialogs (positive control: body gets them)", () => {
    const slider = document.createElement("input");
    slider.type = "range";
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    dialog.append(inside);
    expect(readerKeyAction({ ...base, key: "ArrowLeft", target: slider }, "rsvp")).toBeNull();
    expect(readerKeyAction({ ...base, key: " ", target: inside }, "rsvp")).toBeNull();
    expect(readerKeyAction({ ...base, key: "ArrowLeft", target: document.body }, "rsvp")).toBe("back");
  });
});

describe("highlight delete buttons are distinguishable", () => {
  it("names each delete button after its highlight", () => {
    const hs = [
      { id: "a", startWord: 1, endWord: 4, text: "First passage here", note: null, createdAt: "2026-10-19T12:00:00Z" },
      { id: "b", startWord: 10, endWord: 14, text: "Second passage there", note: null, createdAt: "2026-10-19T12:00:00Z" },
    ];
    render(<HighlightsDialog open onOpenChange={() => {}} highlights={hs} chapters={[]} onJump={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("button", { name: "Delete highlight: First passage here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete highlight: Second passage there" })).toBeInTheDocument();
  });
});

