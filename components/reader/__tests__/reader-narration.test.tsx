import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import { buildDocWords } from "@/lib/reader/doc-words";
import { resetBodyPinForTests } from "@/lib/client/use-body-pin";
import { ReaderApp } from "../reader-app";

const dw = buildDocWords(SAMPLE_DOC);

interface FakeUtterance { text: string; rate: number; onboundary?: (e: { charIndex: number; name: string }) => void; onend?: () => void; onerror?: (e: { error: string }) => void }
let spoken: FakeUtterance[] = [];
let cancels = 0;

function installSpeech() {
  spoken = [];
  cancels = 0;
  class U {
    text: string; rate = 1; voice: unknown = null; lang = "";
    onboundary?: FakeUtterance["onboundary"]; onend?: () => void; onerror?: FakeUtterance["onerror"];
    constructor(t: string) { this.text = t; }
  }
  vi.stubGlobal("SpeechSynthesisUtterance", U);
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak: (u: FakeUtterance) => spoken.push(u),
      cancel: () => { cancels++; },
      getVoices: () => [{ voiceURI: "v-en", name: "Ava", lang: "en-US", localService: true }],
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
}
const last = () => spoken[spoken.length - 1];
const shownWord = () => screen.getByTestId("rsvp-word").getAttribute("aria-label");

describe("ReaderApp narration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBodyPinForTests();
    localStorage.clear();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    resetBodyPinForTests();
  });

  it("hides the Listen button when speech synthesis is missing", () => {
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" />);
    expect(screen.queryByRole("button", { name: "Listen" })).toBeNull();
  });

  it("Listen speaks from the current word, the view follows boundary events, pause stops and resume continues", () => {
    installSpeech();
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(spoken.length).toBe(1);
    expect(last().text.startsWith(dw.words[0])).toBe(true);
    // the engine reports the third word of the chunk
    const third = last().text.split(" ")[2];
    const charIndex = last().text.indexOf(third);
    act(() => last().onboundary?.({ charIndex, name: "word" }));
    expect(shownWord()).toBe(dw.words[2]);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(cancels).toBeGreaterThan(0);
    const before = spoken.length;
    act(() => last().onend?.()); // late event from the cancelled utterance
    expect(spoken.length).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(last().text.startsWith(dw.words[2])).toBe(true);
  });

  it("navigating while listening re-speaks from the new position", () => {
    installSpeech();
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    const n = spoken.length;
    fireEvent.change(screen.getByLabelText("Position in book"), { target: { value: "500" } });
    expect(spoken.length).toBeGreaterThan(n);
    expect(last().text.startsWith(dw.words[500])).toBe(true);
  });

  it("changing the speaking speed re-speaks with the new rate", () => {
    installSpeech();
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    const rateBefore = last().rate;
    fireEvent.click(screen.getByRole("button", { name: "Reader settings" }));
    fireEvent.change(screen.getByLabelText("Speaking speed"), { target: { value: "2" } });
    expect(last().rate).toBe(2);
    expect(rateBefore).not.toBe(2);
  });

  it("closing listen mode stops the voice and the position survives", () => {
    installSpeech();
    render(<ReaderApp bookId="b1" doc={SAMPLE_DOC} backHref="/x" />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    act(() => last().onboundary?.({ charIndex: last().text.indexOf(last().text.split(" ")[1]), name: "word" }));
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(localStorage.getItem("lifeos.reader.position.b1")).toContain('"index":1');
  });
});
