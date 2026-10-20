import { act, fireEvent, render, screen } from "@testing-library/react";
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

  const noop = () => {};
  const ui = (over: Partial<React.ComponentProps<typeof ReaderControls>> = {}) => (
    <ReaderControls totalWords={1000} index={410} playing={false} wpm={300} chapterTitle="Chapter 2" word="harbor" onToggle={noop} onBack={noop} onForward={noop} onSeek={noop} onWpm={noop} {...over} />
  );
  const status = () => screen.getByTestId("reader-status");

  it("names the word and place on play -> pause, and is silent while playing", () => {
    const { rerender } = render(ui({ playing: true }));
    expect(status()).toBeEmptyDOMElement();
    expect(status()).toHaveAttribute("role", "status");
    rerender(ui({ playing: false }));
    expect(status()).toHaveTextContent('Paused on "harbor". Chapter 2, 41% read, word 411 of 1000.');
    rerender(ui({ playing: true, index: 420, word: "next" }));
    expect(status()).toBeEmptyDOMElement();
  });

  it("does not re-announce when the position moves by itself while paused (scroll-follow); positive control: a pause does", () => {
    const { rerender } = render(ui({ playing: true }));
    rerender(ui({ playing: false }));
    const first = status().textContent;
    expect(first).toContain("harbor");
    rerender(ui({ playing: false, index: 600, word: "moved" }));
    expect(status().textContent).toBe(first);
  });

  it("announces again when announceSeq changes (a seek the person made), even if the index did not move", () => {
    const { rerender } = render(ui({ playing: true }));
    rerender(ui({ playing: false }));
    rerender(ui({ playing: false, index: 415, word: "after", announceSeq: 1 }));
    expect(status()).toHaveTextContent('Paused on "after".');
    expect(status()).toHaveTextContent("word 416 of 1000");
    rerender(ui({ playing: false, index: 415, word: "after", announceSeq: 2 }));
    expect(status()).toHaveTextContent('Paused on "after".'); // Back at the start of the book: still spoken
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

describe("seeks the person makes are announced while paused (ReaderApp)", () => {
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
  const said = () => screen.getByTestId("reader-status").textContent ?? "";

  it("a keyboard step announces; nothing is said before any seek (positive control)", () => {
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/self-mastery" />);
    expect(said()).toBe("");
    act(() => void fireEvent.keyDown(document.body, { key: "ArrowRight" }));
    expect(said()).toMatch(/^Paused on "/);
    const first = said();
    act(() => void fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true }));
    expect(said()).not.toBe(first);
  });

  it("a chapter pick announces the new place", () => {
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/self-mastery" />);
    fireEvent.click(screen.getByRole("button", { name: "Chapters" }));
    const items = screen.getByTestId("chapter-list").querySelectorAll("button");
    fireEvent.click(items[items.length - 1]);
    expect(said()).toMatch(/^Paused on "/);
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

