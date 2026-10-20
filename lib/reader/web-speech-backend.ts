import type { SpeechBackend, SpeechVoiceInfo } from "./narration";

// Browser adapter for narration. Returns null when the Web Speech API is absent so callers can hide the Listen button.

type Synth = SpeechSynthesis;

function getSynth(): Synth | null {
  if (typeof window === "undefined") return null;
  const s = (window as { speechSynthesis?: Synth }).speechSynthesis;
  return s && typeof SpeechSynthesisUtterance !== "undefined" ? s : null;
}

export function isSpeechSupported(): boolean {
  return getSynth() !== null;
}

export function createWebSpeechBackend(): SpeechBackend | null {
  const synth = getSynth();
  if (!synth) return null;
  // Chrome garbage-collects an utterance that nothing references and then never fires onend: keep it alive here.
  let _live: SpeechSynthesisUtterance | null = null;
  return {
    speak(text, { rate, voiceUri }, handlers) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = Math.min(2.5, Math.max(0.5, rate));
      const voice = voiceUri ? synth.getVoices().find((v) => v.voiceURI === voiceUri) : undefined;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.onboundary = (e) => {
        if (e.name === undefined || e.name === "word") handlers.onBoundary(e.charIndex);
      };
      u.onend = () => handlers.onEnd();
      u.onerror = (e) => handlers.onError(String(e.error ?? "error"));
      _live = u;
      synth.speak(u);
    },
    cancel() {
      _live = null;
      synth.cancel();
    },
  };
}

function toInfo(v: SpeechSynthesisVoice): SpeechVoiceInfo {
  return { uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService };
}

/** Voices in a useful order: the browser language first, on-device before network voices, then by name. */
export function sortVoices(voices: SpeechVoiceInfo[], preferredLang: string): SpeechVoiceInfo[] {
  const base = preferredLang.toLowerCase().split("-")[0];
  const rank = (v: SpeechVoiceInfo) => (v.lang.toLowerCase().startsWith(base) ? 0 : 2) + (v.local ? 0 : 1);
  return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Calls `cb` with the current voice list now and again whenever the browser finishes loading more. Returns an unsubscribe. */
export function watchVoices(cb: (voices: SpeechVoiceInfo[]) => void): () => void {
  const synth = getSynth();
  if (!synth) return () => {};
  const lang = typeof navigator !== "undefined" ? navigator.language || "en" : "en";
  const emit = () => cb(sortVoices(synth.getVoices().map(toInfo), lang));
  emit();
  synth.addEventListener?.("voiceschanged", emit);
  return () => synth.removeEventListener?.("voiceschanged", emit);
}
