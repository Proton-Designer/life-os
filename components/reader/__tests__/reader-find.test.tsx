import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import { buildDocWords } from "@/lib/reader/doc-words";
import { findWordIndex } from "@/lib/reader/find-word";
import { resetBodyPinForTests } from "@/lib/client/use-body-pin";
import { ReaderApp } from "../reader-app";

const dw = buildDocWords(SAMPLE_DOC);
const PHRASE = "notice THE red letter";
const TARGET = findWordIndex(dw.words, PHRASE)!;
const activeWord = () => document.querySelector<HTMLElement>('[data-active="true"]')?.getAttribute("data-word");

function mount(props: Partial<React.ComponentProps<typeof ReaderApp>>) {
  render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/self-mastery" {...props} />);
}

describe("ReaderApp ?find=", () => {
  beforeEach(() => {
    resetBodyPinForTests();
    localStorage.clear();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("positive control: the phrase really is a few words into the book", () => {
    expect(TARGET).toBeGreaterThan(20);
  });

  it("opens the Page view at the first place the words appear", () => {
    mount({ find: PHRASE });
    expect(screen.getByTestId("page-view")).toBeInTheDocument();
    expect(activeWord()).toBe(String(TARGET));
  });

  it("?at wins over ?find", () => {
    mount({ startAt: 5, find: PHRASE });
    expect(activeWord()).toBe("5");
  });

  it("words that aren't in the book behave as no param: the saved position, fast mode", () => {
    localStorage.setItem("lifeos.reader.position.b1", JSON.stringify({ index: 10, updatedAt: 1000 }));
    mount({ find: "this passage is not in the sample book" });
    expect(screen.queryByTestId("page-view")).toBeNull();
    expect(screen.getByTestId("rsvp-word").getAttribute("aria-label")).toBe(dw.words[10]);
  });
});
