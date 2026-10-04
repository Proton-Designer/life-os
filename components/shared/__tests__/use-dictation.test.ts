// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDictation } from "../use-dictation";

/**
 * P2-16 — this hook is a pure extraction of what
 * `components/capture/global-capture-sheet.tsx` already had inline
 * (verified byte-identical at extraction time); these tests exist because
 * the inline version was never covered, and this is now shared by TWO
 * callers (the capture sheet, Self-Mastery's free-recall answer), so a
 * regression here breaks both silently without one.
 */
class FakeSpeechRecognition {
  lang = "";
  interimResults = false;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  start() {
    this.started = true;
  }
  // Test helpers, not part of the real API.
  emitResult(transcript: string) {
    this.onresult?.({ results: { 0: { 0: { transcript } } } });
  }
  emitEnd() {
    this.onend?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDictation", () => {
  it("reports unsupported when no SpeechRecognition constructor exists on window, and toggle() is a safe no-op", () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation(onTranscript));

    expect(result.current.supported).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.dictating).toBe(false);
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("supported when webkitSpeechRecognition exists; toggle() starts recognition, sets dictating, and a result invokes onTranscript with the raw transcript", () => {
    let instance: FakeSpeechRecognition | null = null;
    vi.stubGlobal(
      "webkitSpeechRecognition",
      class {
        constructor() {
          instance = new FakeSpeechRecognition();
          return instance;
        }
      }
    );
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation(onTranscript));

    expect(result.current.supported).toBe(true);
    act(() => result.current.toggle());

    expect(result.current.dictating).toBe(true);
    expect(instance!.started).toBe(true);
    expect(instance!.lang).toBe("en-US");
    expect(instance!.interimResults).toBe(false);

    act(() => instance!.emitResult("photosynthesis converts light to energy"));
    expect(onTranscript).toHaveBeenCalledWith("photosynthesis converts light to energy");

    act(() => instance!.emitEnd());
    expect(result.current.dictating).toBe(false);
  });

  it("reset() clears dictating without needing onend to fire (e.g. a caller advancing to a new card mid-listen)", () => {
    vi.stubGlobal(
      "webkitSpeechRecognition",
      class {
        constructor() {
          return new FakeSpeechRecognition();
        }
      }
    );
    const { result } = renderHook(() => useDictation(vi.fn()));

    act(() => result.current.toggle());
    expect(result.current.dictating).toBe(true);

    act(() => result.current.reset());
    expect(result.current.dictating).toBe(false);
  });

  it("an empty transcript result never calls onTranscript", () => {
    let instance: FakeSpeechRecognition | null = null;
    vi.stubGlobal(
      "SpeechRecognition",
      class {
        constructor() {
          instance = new FakeSpeechRecognition();
          return instance;
        }
      }
    );
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation(onTranscript));

    act(() => result.current.toggle());
    act(() => instance!.emitResult(""));

    expect(onTranscript).not.toHaveBeenCalled();
  });
});
