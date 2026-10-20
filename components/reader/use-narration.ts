"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocWords } from "@/lib/reader/doc-words";
import { createNarrator, type Narrator, type SpeechVoiceInfo } from "@/lib/reader/narration";
import { createWebSpeechBackend, isSpeechSupported, watchVoices } from "@/lib/reader/web-speech-backend";

export interface NarrationControls {
  /** False on the server, while mounting, and in browsers without the Web Speech API. */
  supported: boolean;
  voices: SpeechVoiceInfo[];
  speaking: boolean;
  error: string | null;
  start(wordIndex: number): void;
  /** Stops speaking and returns the word it stopped at. */
  pause(): number;
  /** Re-speak from the current word with the latest rate/voice (no-op when idle). */
  restart(): void;
}

/** Browser wiring for the narrator. Settings and callbacks are read through refs so one narrator lives per document. */
export function useNarration(opts: {
  words: DocWords;
  rate: number;
  voiceUri: string | null;
  onWord: (index: number) => void;
  onFinish: () => void;
}): NarrationControls {
  const { words } = opts;
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechVoiceInfo[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const narratorRef = useRef<Narrator | null>(null);
  const live = useRef(opts);
  useEffect(() => {
    live.current = opts;
  });

  useEffect(() => {
    if (!isSpeechSupported()) return;
    // Feature detection has to wait for mount: the server render cannot know the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(true);
    return watchVoices(setVoices);
  }, []);

  useEffect(() => {
    const backend = createWebSpeechBackend();
    if (!backend) return;
    const narrator = createNarrator({
      backend,
      words,
      getSettings: () => ({ rate: live.current.rate, voiceUri: live.current.voiceUri }),
      onWord: (i) => live.current.onWord(i),
      onFinish: () => {
        setSpeaking(false);
        live.current.onFinish();
      },
      onError: (code) => {
        setSpeaking(false);
        setError(code);
      },
    });
    narratorRef.current = narrator;
    return () => {
      narrator.destroy();
      narratorRef.current = null;
    };
  }, [words]);

  const start = useCallback((i: number) => {
    const n = narratorRef.current;
    if (!n) return;
    setError(null);
    n.start(i);
    setSpeaking(n.speaking);
  }, []);
  const pause = useCallback(() => {
    const n = narratorRef.current;
    if (!n) return 0;
    const w = n.pause();
    setSpeaking(false);
    return w;
  }, []);
  const restart = useCallback(() => narratorRef.current?.restart(), []);

  return { supported, voices, speaking, error, start, pause, restart };
}
