import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import { buildDocWords } from "@/lib/reader/doc-words";
import { PageView } from "../page-view";

const dw = buildDocWords(SAMPLE_DOC);

// jsdom has no layout, so the test plays the browser: the scroll root and the word report whatever rect the test says.
// On a phone the first paint has the word inside the middle band; then the toolbar and the book's web font arrive, the
// root shrinks and the text grows, and the word ends up below the fold. The effect that centres the word only ran on
// mount, so the page stayed at the top.
let observers: ResizeObserverCallback[] = [];
let layout: { root: DOMRect; word: DOMRect };
const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe("PageView start position", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    observers = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          observers.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
    layout = { root: rect(62, 629), word: rect(463, 21) }; // first paint: word inside the 20%–80% band
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.getAttribute("data-testid") === "page-view") return layout.root;
      if (this.getAttribute("data-active") === "true") return layout.word;
      return rect(0, 0);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mount = () => render(<PageView doc={SAMPLE_DOC} dw={dw} index={40} playing={false} fontScale={1} onSeek={() => {}} />);
  const layoutShifts = () => observers.forEach((cb) => cb([], {} as ResizeObserver));

  it("positive control: a word that starts in the middle band is left where it is", () => {
    mount();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("centres the word when the layout shifts it out of the band after the first paint", () => {
    mount();
    layout = { root: rect(102, 589), word: rect(747, 21) }; // toolbar appeared, text reflowed: now below the fold
    layoutShifts();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("does not yank the page back once the person has scrolled it themselves", () => {
    const { getByTestId } = mount();
    const root = getByTestId("page-view");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5_000); // past any programmatic-scroll window
    fireEvent.scroll(root);
    layout = { root: rect(102, 589), word: rect(747, 21) };
    layoutShifts();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
