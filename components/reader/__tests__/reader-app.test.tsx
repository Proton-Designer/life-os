import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import { buildDocWords } from "@/lib/reader/doc-words";
import { delayMs } from "@/lib/reader/rsvp";
import { resetBodyPinForTests } from "@/lib/client/use-body-pin";
import { ReaderApp } from "../reader-app";

const dw = buildDocWords(SAMPLE_DOC);
const POS_KEY = "lifeos.reader.position.b1";

function mount(props: Partial<React.ComponentProps<typeof ReaderApp>> = {}) {
  render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/self-mastery" {...props} />);
}
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(document.body, { key: k, ...init }));
const shownWord = () => screen.getByTestId("rsvp-word").getAttribute("aria-label");
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("ReaderApp", () => {
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

  it("opens on the first word in fast mode, paused, with progress and the default speed", () => {
    mount();
    expect(shownWord()).toBe(dw.words[0]);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByTestId("reader-wpm")).toHaveTextContent("300");
    expect(screen.getByTestId("reader-progress")).toHaveTextContent("0%");
    expect(screen.getByTestId("reader-root")).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("link", { name: "Back to library" })).toHaveAttribute("href", "/self-mastery");
  });

  it("Space plays and pauses; words advance on the clock and stop when paused", () => {
    mount();
    key(" ");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    tick(delayMs(dw.words[0], 300, { paragraphEnd: false }));
    expect(shownWord()).toBe(dw.words[1]);
    key(" ");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    tick(10_000);
    expect(shownWord()).toBe(dw.words[1]);
  });

  it("the play button works the same way", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("arrow keys step by sentence and paragraph; back goes to the start of the sentence first", () => {
    mount();
    key("ArrowRight");
    const afterFirst = shownWord();
    expect(afterFirst).not.toBe(dw.words[0]);
    key("ArrowRight");
    key("ArrowLeft"); // from a sentence start, goes to the previous sentence start
    expect(shownWord()).toBe(afterFirst);
    // afterFirst is the first word of the first paragraph (block 1, after the chapter heading)
    expect(afterFirst).toBe(dw.words[SAMPLE_DOC.blocks[1].firstWord]);
    key("ArrowRight", { shiftKey: true });
    expect(shownWord()).toBe(dw.words[SAMPLE_DOC.blocks[2].firstWord]);
    key("ArrowLeft", { shiftKey: true });
    expect(shownWord()).toBe(afterFirst);
  });

  it("up/down change the speed in steps of 25 and remember it", () => {
    mount();
    key("ArrowUp");
    key("ArrowUp");
    expect(screen.getByTestId("reader-wpm")).toHaveTextContent("350");
    key("ArrowDown");
    expect(screen.getByTestId("reader-wpm")).toHaveTextContent("325");
    expect(JSON.parse(localStorage.getItem("lifeos.reader.settings")!).wpm).toBe(325);
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    expect(screen.getByTestId("reader-wpm")).toHaveTextContent("350");
    fireEvent.click(screen.getByRole("button", { name: "Slower" }));
    expect(screen.getByTestId("reader-wpm")).toHaveTextContent("325");
  });

  it("a speed change applies to how fast the next words arrive", () => {
    mount();
    for (let i = 0; i < 4; i++) key("ArrowUp"); // 400
    key(" ");
    const d = delayMs(dw.words[0], 400);
    tick(d - 1);
    expect(shownWord()).toBe(dw.words[0]);
    tick(1);
    expect(shownWord()).toBe(dw.words[1]);
  });

  it("the scrubber seeks and the progress line follows", () => {
    mount();
    const half = Math.floor((dw.words.length - 1) / 2);
    fireEvent.change(screen.getByLabelText("Position in book"), { target: { value: String(half) } });
    expect(shownWord()).toBe(dw.words[half]);
    expect(screen.getByTestId("reader-progress")).toHaveTextContent("50%");
    expect(screen.getByTestId("reader-progress")).toHaveTextContent("min left");
  });

  it("saves the position as it moves and restores it on the next open", () => {
    mount();
    const target = 200;
    fireEvent.change(screen.getByLabelText("Position in book"), { target: { value: String(target) } });
    key(" ");
    key(" "); // pause flushes
    expect(JSON.parse(localStorage.getItem(POS_KEY)!).index).toBeGreaterThanOrEqual(target);
    const saved = JSON.parse(localStorage.getItem(POS_KEY)!).index as number;

    document.body.innerHTML = "";
    resetBodyPinForTests();
    mount();
    expect(shownWord()).toBe(dw.words[saved]);
  });

  it("restores the newer of the local and server positions", () => {
    localStorage.setItem(POS_KEY, JSON.stringify({ index: 10, updatedAt: 1000 }));
    mount({ serverPosition: { index: 300, updatedAt: 2000 } });
    expect(shownWord()).toBe(dw.words[300]);
  });

  it("ignores a corrupt saved position instead of breaking", () => {
    localStorage.setItem(POS_KEY, "{broken");
    mount();
    expect(shownWord()).toBe(dw.words[0]);
  });

  it("Page view highlights the current word, tap-to-seek moves it, and switching back keeps the index", () => {
    mount();
    const target = SAMPLE_DOC.blocks[1].firstWord + 6;
    fireEvent.change(screen.getByLabelText("Position in book"), { target: { value: String(target) } });
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    const view = screen.getByTestId("page-view");
    expect(view.querySelector('[data-active="true"]')).toHaveTextContent(dw.words[target]);

    const other = view.querySelector<HTMLElement>(`[data-word="${target + 3}"]`)!;
    fireEvent.click(other);
    expect(view.querySelector('[data-active="true"]')).toHaveTextContent(dw.words[target + 3]);

    fireEvent.click(screen.getByRole("button", { name: "Fast" }));
    expect(shownWord()).toBe(dw.words[target + 3]);
  });

  it("tapping a paragraph other than the current one jumps to its first word when the browser has no caret API", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    const view = screen.getByTestId("page-view");
    const lastBlock = SAMPLE_DOC.blocks.length - 1;
    const p = view.querySelector<HTMLElement>(`[data-block="${lastBlock}"]`)!;
    fireEvent.click(p);
    expect(view.querySelector('[data-active="true"]')).toHaveTextContent(dw.words[SAMPLE_DOC.blocks[lastBlock].firstWord]);
  });

  it("Page view keeps Up/Down for scrolling (no speed change), Fast view does not", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    key("ArrowUp");
    expect(screen.getByTestId("reader-wpm")).toHaveTextContent("300");
  });

  it("the view mode is remembered per book", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    document.body.innerHTML = "";
    resetBodyPinForTests();
    mount();
    expect(screen.getByTestId("page-view")).toBeInTheDocument();
  });

  it("chapters: the dialog lists them, marks the current one, and jumps", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Chapters" }));
    const list = screen.getByTestId("chapter-list");
    const items = within(list).getAllByRole("button");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    fireEvent.click(items[2]);
    expect(shownWord()).toBe(dw.words[SAMPLE_DOC.chapters[2].firstWord]);
    expect(screen.getByTestId("reader-progress").parentElement).toHaveTextContent(SAMPLE_DOC.chapters[2].title);
  });

  it("settings: theme, text size, guide lines and speed apply and persist", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reader settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Sepia" }));
    expect(screen.getByTestId("reader-root")).toHaveAttribute("data-theme", "sepia");
    expect(screen.getByTestId("reader-root").style.getPropertyValue("--reader-bg")).toBe("#f4ecd8");

    fireEvent.click(screen.getByLabelText("Focus guide lines"));
    expect(screen.queryByTestId("focal-lines")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "500" } });
    expect(screen.getByTestId("reader-wpm")).toHaveTextContent("500");
    fireEvent.change(screen.getByLabelText("Text size"), { target: { value: "1.5" } });

    expect(JSON.parse(localStorage.getItem("lifeos.reader.settings")!)).toMatchObject({
      theme: "sepia",
      focalLines: false,
      wpm: 500,
      fontScale: 1.5,
    });
  });

  it("applies saved settings on open", () => {
    localStorage.setItem("lifeos.reader.settings", JSON.stringify({ wpm: 450, theme: "light", focalLines: false }));
    mount();
    expect(screen.getByTestId("reader-wpm")).toHaveTextContent("450");
    expect(screen.getByTestId("reader-root")).toHaveAttribute("data-theme", "light");
    expect(screen.queryByTestId("focal-lines")).not.toBeInTheDocument();
  });

  it("keys do not reach the reader while a dialog is open", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reader settings" }));
    const dialog = screen.getByRole("dialog");
    act(() => void fireEvent.keyDown(within(dialog).getByLabelText("Speed"), { key: " " }));
    act(() => void fireEvent.keyDown(within(dialog).getByRole("button", { name: "Dark" }), { key: "ArrowRight" }));
    expect(shownWord()).toBe(dw.words[0]);
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("pins the page behind the reader and releases it on unmount", () => {
    const { unmount } = render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" />);
    expect(document.body.style.position).toBe("fixed");
    unmount();
    expect(document.body.style.position).toBe("");
  });

  it("an empty document says so instead of crashing", () => {
    mount({ doc: { ...SAMPLE_DOC, blocks: [], chapters: [], wordCount: 0 } });
    expect(screen.getByText(/nothing to read/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("runs the whole book to the end and reports it finished", () => {
    mount({ doc: { ...SAMPLE_DOC, blocks: SAMPLE_DOC.blocks.slice(0, 2), chapters: SAMPLE_DOC.chapters.slice(0, 1) } });
    for (let i = 0; i < 30; i++) key("ArrowUp"); // clamp to 1000
    key(" ");
    // Each shown word re-renders before the next is scheduled, so advance in small steps instead of one big jump.
    for (let i = 0; i < 400; i++) tick(250);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByTestId("reader-progress")).toHaveTextContent("100%");
    expect(screen.getByTestId("reader-progress")).toHaveTextContent("finished");
  });
});
