"use client";

import { useState } from "react";

/**
 * P2-16: extracted from `components/capture/global-capture-sheet.tsx` (the
 * app's original, and until now only, dictation caller) so Self-Mastery's
 * free-recall answer can REUSE the exact same in-browser Web Speech
 * mechanism rather than a second hand-rolled copy — same "one
 * implementation, not two that can drift" discipline as everywhere else in
 * this codebase. Behavior is byte-identical to what the capture sheet had
 * inline: same `en-US`/non-interim config, same on-result/on-end wiring.
 * The only change is the RESULT HANDOFF: the caller decides how to merge a
 * transcript into its own text state (append-with-a-space here, replace
 * there), so this hook stays state-shape-agnostic.
 *
 * Not in TypeScript's standard DOM lib (webkit-prefixed, non-standard API)
 * — `MinimalSpeechRecognition` below is the narrow slice this app actually
 * uses, not a claim about the full API.
 */
type MinimalSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
};

export function useDictation(onTranscript: (transcript: string) => void) {
  const [supported] = useState(
    () => typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
  const [dictating, setDictating] = useState(false);

  function toggle() {
    if (!supported) return;
    const SpeechRecognitionCtor = (
      window as unknown as {
        SpeechRecognition?: new () => MinimalSpeechRecognition;
        webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
      }
    ).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => MinimalSpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) onTranscript(transcript);
    };
    recognition.onend = () => setDictating(false);
    setDictating(true);
    recognition.start();
  }

  /** Resets the UI-only `dictating` flag — call on whatever "start over" a caller already has (global-capture-sheet's own `reset()`, a session card advancing). Never needed for `supported`, which is fixed for the page's lifetime. */
  function reset() {
    setDictating(false);
  }

  return { supported, dictating, toggle, reset };
}
