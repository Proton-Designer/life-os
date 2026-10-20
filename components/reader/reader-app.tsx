"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Headphones, List, Settings2 } from "lucide-react";
import { useBodyPin } from "@/lib/client/use-body-pin";
import { buildDocWords, chapterIndexAt } from "@/lib/reader/doc-words";
import { effectiveSpeechRate } from "@/lib/reader/narration";
import { WPM_STEP } from "@/lib/reader/rsvp";
import {
  browserStorage,
  createPositionSaver,
  loadMode,
  loadPosition,
  loadSettings,
  pickNewestPosition,
  saveMode,
  saveSettings,
  type ReaderMode,
  type StoredPosition,
} from "@/lib/reader/reader-storage";
import { readerThemeVars } from "@/lib/reader/themes";
import { DEFAULT_READER_SETTINGS, type ReaderDoc, type ReaderSettings } from "@/lib/reader/types";
import { cn } from "@/lib/utils";
import { ChapterDialog } from "./chapter-dialog";
import { PageView } from "./page-view";
import { READER_BTN, ReaderControls } from "./reader-controls";
import { readerKeyAction } from "./reader-keys";
import { ReaderSettingsDialog } from "./reader-settings-dialog";
import { RsvpView } from "./rsvp-view";
import { useNarration } from "./use-narration";
import { useRsvpPlayer } from "./use-rsvp-player";
import { useWakeLock } from "./use-wake-lock";

interface Boot {
  settings: ReaderSettings;
  position: StoredPosition | null;
  mode: ReaderMode;
}

/**
 * The reader. Everything it needs arrives as plain props (the document, an optional server-held position), so the data
 * source is swapped in one place: the route's loader. Browser-local state (settings, position, view mode) is read after
 * mount, so the first paint matches the server render.
 */
export function ReaderApp({
  bookId,
  doc,
  backHref,
  serverPosition = null,
  serverSettings = null,
  onPositionWrite,
  onLeave,
  onSettingsChange,
}: {
  bookId: string;
  doc: ReaderDoc;
  backHref: string;
  /** Position held by the server (R3); the newer of this and the local copy wins. */
  serverPosition?: StoredPosition | null;
  /** Settings held by the server (they follow the person across devices); win over this browser's copy. */
  serverSettings?: ReaderSettings | null;
  /** Every local position write (throttled to ~2/s): the loader forwards the newest to the server. */
  onPositionWrite?: (index: number, updatedAt: number, wpm: number) => void;
  /** Reading paused / tab hidden / page closing: send anything unsent now. */
  onLeave?: () => void;
  onSettingsChange?: (patch: Partial<ReaderSettings>) => void;
}) {
  const [boot, setBoot] = useState<Boot | null>(null);
  useEffect(() => {
    const storage = browserStorage();
    // Reading browser storage has to wait for mount: doing it during render would not match the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBoot({
      settings: serverSettings ?? loadSettings(storage),
      position: pickNewestPosition(loadPosition(storage, bookId), serverPosition),
      mode: loadMode(storage, bookId) ?? "rsvp",
    });
    // Boot once per book; a later server position must not yank the reader mid-sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  if (!boot) {
    return <div className="h-dvh w-full" style={{ ...readerThemeVars(DEFAULT_READER_SETTINGS.theme), background: "var(--reader-bg)" }} aria-busy="true" />;
  }
  return <ReaderSession key={bookId} bookId={bookId} doc={doc} backHref={backHref} boot={boot} hooks={{ onPositionWrite, onLeave, onSettingsChange }} />;
}

interface SessionHooks {
  onPositionWrite?: (index: number, updatedAt: number, wpm: number) => void;
  onLeave?: () => void;
  onSettingsChange?: (patch: Partial<ReaderSettings>) => void;
}

function ReaderSession({ bookId, doc, backHref, boot, hooks }: { bookId: string; doc: ReaderDoc; backHref: string; boot: Boot; hooks: SessionHooks }) {
  const hooksRef = useRef(hooks);
  const wpmRef = useRef(boot.settings.wpm);
  useEffect(() => {
    hooksRef.current = hooks;
  });
  const dw = useMemo(() => buildDocWords(doc), [doc]);
  const [settings, setSettings] = useState(boot.settings);
  const [mode, setMode] = useState<ReaderMode>(boot.mode);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [onWrite] = useState(() => (pos: StoredPosition) => hooksRef.current.onPositionWrite?.(pos.index, pos.updatedAt, wpmRef.current));
  const saver = useMemo(() => createPositionSaver({ storage: browserStorage(), bookId, onWrite }), [bookId, onWrite]);
  const leave = useCallback(() => {
    saver.flush();
    hooksRef.current.onLeave?.();
  }, [saver]);
  const player = useRsvpPlayer({
    words: dw,
    wpm: settings.wpm,
    initialIndex: boot.position?.index ?? 0,
    onIndexChange: (i) => saver.push(i),
    onPause: () => leave(),
  });
  const { index, playing } = player;

  // Listen mode: the narrator drives the position (via onWord) instead of the RSVP clock.
  const [listenMode, setListenMode] = useState(false);
  const lastAudioIndex = useRef(-1);
  const seekRef = useRef(player.seek);
  useEffect(() => {
    seekRef.current = player.seek;
  });
  const narration = useNarration({
    words: dw,
    rate: effectiveSpeechRate(settings.speechRate, settings.wpm),
    voiceUri: settings.voiceUri,
    onWord: (i) => {
      lastAudioIndex.current = i;
      seekRef.current(i);
    },
    onFinish: () => leave(),
  });
  const narrating = narration.speaking;

  useBodyPin(true);
  useWakeLock(playing || narrating);

  // The reader moved the position themselves (scrubber, tap, sentence skip, chapter): speak from there.
  useEffect(() => {
    if (narrating && index !== lastAudioIndex.current) narration.start(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  // A voice or rate change re-speaks the current sentence with the new settings.
  const speechRate = effectiveSpeechRate(settings.speechRate, settings.wpm);
  useEffect(() => {
    narration.restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechRate, settings.voiceUri]);

  const toggleListenMode = useCallback(() => {
    if (listenMode) {
      narration.pause();
      leave();
      setListenMode(false);
    } else {
      player.pause();
      setListenMode(true);
      lastAudioIndex.current = index;
      narration.start(index);
    }
  }, [listenMode, narration, player, leave, index]);

  const togglePlay = useCallback(() => {
    if (!listenMode) return player.toggle();
    if (narrating) {
      narration.pause();
      leave();
    } else {
      lastAudioIndex.current = index;
      narration.start(index);
    }
  }, [listenMode, narrating, narration, player, leave, index]);

  // Never lose the place: write on hide/close as well as on pause.
  useEffect(() => {
    const flush = () => leave();
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [leave]);

  const updateSettings = useCallback(
    (patch: Partial<ReaderSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        saveSettings(browserStorage(), next);
        return next;
      });
      if (patch.wpm !== undefined) {
        player.setWpm(patch.wpm);
        wpmRef.current = patch.wpm;
      }
      hooksRef.current.onSettingsChange?.(patch);
    },
    [player]
  );

  const changeMode = useCallback(
    (next: ReaderMode) => {
      setMode(next);
      saveMode(browserStorage(), bookId, next);
    },
    [bookId]
  );

  // Keyboard: Space, arrows. Refs keep one stable listener while the handlers change every tick.
  const live = useRef({ player, mode, updateSettings, togglePlay, toggleListenMode, canListen: narration.supported });
  useEffect(() => {
    live.current = { player, mode, updateSettings, togglePlay, toggleListenMode, canListen: narration.supported };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const { player: p, mode: m, updateSettings: update, togglePlay: toggle, toggleListenMode: listen, canListen } = live.current;
      const action = readerKeyAction(e, m);
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "toggle": toggle(); break;
        case "listen": if (canListen) listen(); break;
        case "back": p.backSentence(); break;
        case "forward": p.forwardSentence(); break;
        case "backParagraph": p.backParagraph(); break;
        case "forwardParagraph": p.forwardParagraph(); break;
        case "wpmUp": update({ wpm: p.wpm + WPM_STEP }); break;
        case "wpmDown": update({ wpm: p.wpm - WPM_STEP }); break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const chapterIdx = chapterIndexAt(doc.chapters, index);
  const word = dw.words[index] ?? "";
  const before = dw.words.slice(Math.max(0, index - 4), index);
  const after = dw.words.slice(index + 1, index + 9);

  return (
    <div
      data-testid="reader-root"
      data-theme={settings.theme}
      style={{ ...readerThemeVars(settings.theme), background: "var(--reader-bg)", color: "var(--reader-fg)" }}
      className="flex h-dvh w-full flex-col overflow-hidden overscroll-none"
    >
      <header className="flex items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <Link href={backHref} aria-label="Back to library" className={cn(READER_BTN, "size-11")}>
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{doc.title}</h1>
        {/* R7 slot: today's words / daily goal ring and highlight button. */}
        {narration.supported ? (
          <button
            type="button"
            aria-label="Listen"
            aria-pressed={listenMode}
            onClick={toggleListenMode}
            className={cn(READER_BTN, "size-11", listenMode && "border-[var(--reader-focal)] text-[var(--reader-focal)]")}
          >
            <Headphones className="size-5" />
          </button>
        ) : null}
        <div role="group" aria-label="View" className="flex rounded-full border border-[var(--reader-border)] bg-[var(--reader-surface)] p-0.5 text-sm">
          {(["rsvp", "page"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => changeMode(m)}
              className={cn("min-h-10 rounded-full px-3", mode === m ? "bg-[var(--reader-fg)] text-[var(--reader-bg)]" : "text-[var(--reader-muted)]")}
            >
              {m === "rsvp" ? "Fast" : "Page"}
            </button>
          ))}
        </div>
        {doc.chapters.length > 1 ? (
          <button type="button" aria-label="Chapters" onClick={() => setChaptersOpen(true)} className={cn(READER_BTN, "size-11")}>
            <List className="size-5" />
          </button>
        ) : null}
        <button type="button" aria-label="Reader settings" onClick={() => setSettingsOpen(true)} className={cn(READER_BTN, "size-11")}>
          <Settings2 className="size-5" />
        </button>
      </header>

      <main className="min-h-0 flex-1">
        {dw.words.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--reader-muted)]">There is nothing to read in this book yet.</p>
        ) : mode === "rsvp" ? (
          <RsvpView word={word} before={before} after={after} fontScale={settings.fontScale} focalLines={settings.focalLines} />
        ) : (
          <PageView doc={doc} dw={dw} index={index} playing={playing} fontScale={settings.fontScale} onSeek={player.seek} />
        )}
      </main>

      <ReaderControls
        totalWords={dw.words.length}
        index={index}
        playing={listenMode ? narrating : playing}
        wpm={player.wpm}
        chapterTitle={chapterIdx >= 0 ? doc.chapters[chapterIdx].title : null}
        onToggle={togglePlay}
        onBack={player.backSentence}
        onForward={player.forwardSentence}
        onSeek={player.seek}
        onWpm={(w) => updateSettings({ wpm: w })}
      />

      <ChapterDialog open={chaptersOpen} onOpenChange={setChaptersOpen} chapters={doc.chapters} currentChapter={chapterIdx} onPick={player.seek} />
      <ReaderSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onChange={updateSettings} speech={{ supported: narration.supported, voices: narration.voices }} />
    </div>
  );
}
