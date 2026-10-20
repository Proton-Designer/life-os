"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { createHighlight, deleteHighlight, getReadingStats, prepareReaderDoc, recordReaderSession, updateReaderSettings } from "@/app/(app)/personal/reader-actions";
import { indexedDbDocCache, loadReaderDoc } from "@/lib/reader/doc-cache";
import type { HighlightItem } from "@/lib/reader/highlights";
import { createPositionSync, sendPositionBeacon } from "@/lib/reader/position-sync";
import type { ReadingStats } from "@/lib/reader/server/stats";
import type { ReadingStretch } from "@/lib/reader/session-tracker";
import { readerThemeVars } from "@/lib/reader/themes";
import { DEFAULT_READER_SETTINGS, type ReaderDoc, type ReaderSettings } from "@/lib/reader/types";
import { ReaderApp } from "./reader-app";

export interface ReaderLoaderProps {
  bookId: string;
  backHref: string;
  title: string;
  /** books.reader_status: 'ready' has a stored document; 'none'/'preparing' are built on the spot; 'failed' waits for a retry. */
  status: string;
  docUrl: string | null;
  docVersion: number | null;
  position: { wordIndex: number; clientUpdatedAt: string } | null;
  settings: ReaderSettings;
  highlights?: HighlightItem[];
  /** Open at this word in the Page view (a link from the highlights list). */
  startAt?: number | null;
}

type Phase = { kind: "loading" } | { kind: "preparing" } | { kind: "failed"; message: string } | { kind: "ready"; doc: ReaderDoc };

/**
 * Gets a real book onto the screen: opens the stored document (cache first), builds it first when this book has never
 * been opened in the reader ("Preparing for reading…"), and wires the reader's position and settings to the server.
 */
export function ReaderLoader(props: ReaderLoaderProps) {
  const { bookId, status, docUrl, docVersion } = props;
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(status === "ready" ? { kind: "loading" } : status === "failed" ? { kind: "failed", message: "This book couldn't be prepared for reading." } : { kind: "preparing" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const set = (p: Phase) => {
      if (!cancelled) setPhase(p);
    };
    (async () => {
      if (status === "ready") {
        const r = await loadReaderDoc({ bookId, version: docVersion, docUrl, cache: indexedDbDocCache() });
        set(r.ok ? { kind: "ready", doc: r.doc } : { kind: "failed", message: r.message });
        return;
      }
      if (status === "failed" && attempt === 0) return;
      set({ kind: "preparing" });
      const r = await prepareReaderDoc(bookId);
      if (cancelled) return;
      if (r.ok) router.refresh(); // the server now reports 'ready' with a signed document URL
      else set({ kind: "failed", message: r.message });
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, status, docUrl, docVersion, attempt, router]);

  const sync = useMemo(() => createPositionSync({ bookId, send: sendPositionBeacon }), [bookId]);
  useEffect(() => () => sync.flush(), [sync]);

  const pendingSettings = useRef<Partial<ReaderSettings>>({});
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Sends whatever settings are waiting out the debounce, once. */
  const flushSettings = useCallback(() => {
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = null;
    const body = pendingSettings.current;
    if (Object.keys(body).length === 0) return;
    pendingSettings.current = {};
    void updateReaderSettings(body).catch(() => {});
  }, []);
  const persistSettings = useCallback(
    (patch: Partial<ReaderSettings>) => {
      pendingSettings.current = { ...pendingSettings.current, ...patch };
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
      settingsTimer.current = setTimeout(flushSettings, 800);
    },
    [flushSettings]
  );
  // A setting changed in the last 800 ms must not be lost when the tab is hidden or the reader closes.
  useEffect(() => {
    window.addEventListener("pagehide", flushSettings);
    return () => {
      window.removeEventListener("pagehide", flushSettings);
      flushSettings();
    };
  }, [flushSettings]);

  const [stats, setStats] = useState<ReadingStats | null>(null);
  const refreshStats = useCallback(async () => {
    try {
      const r = await getReadingStats();
      if (r.ok) setStats(r.stats);
    } catch {
      // Stats are decoration: a failure just leaves the bar as it was.
    }
  }, []);
  const isReady = phase.kind === "ready";
  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => getReadingStats())
      .then((r) => {
        if (!cancelled && r.ok) setStats(r.stats);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isReady]);

  const onSession = useCallback(
    (s: ReadingStretch) => {
      void recordReaderSession({
        bookId,
        startedAt: new Date(s.startedAt).toISOString(),
        endedAt: new Date(s.endedAt).toISOString(),
        wordsRead: s.wordsRead,
        mode: s.mode,
        avgWpm: s.avgWpm,
      })
        .then((r) => {
          if (r.ok) void refreshStats();
        })
        .catch(() => {});
    },
    [bookId, refreshStats]
  );
  const onCreateHighlight = useCallback(
    async (range: { startWord: number; endWord: number; text: string }): Promise<HighlightItem | null> => {
      try {
        const r = await createHighlight({ bookId, ...range });
        return r.ok ? r.highlight : null;
      } catch {
        return null;
      }
    },
    [bookId]
  );
  const onDeleteHighlight = useCallback(async (id: string) => {
    try {
      return (await deleteHighlight(id)).ok;
    } catch {
      return false;
    }
  }, []);

  if (phase.kind === "ready") {
    return (
      <ReaderApp
        bookId={bookId}
        doc={phase.doc}
        backHref={props.backHref}
        serverPosition={props.position ? { index: props.position.wordIndex, updatedAt: Date.parse(props.position.clientUpdatedAt) || 0 } : null}
        serverSettings={props.settings}
        onPositionWrite={(index, updatedAt, wpm) => sync.push(index, updatedAt, wpm)}
        onLeave={() => sync.flush()}
        onSettingsChange={persistSettings}
        highlights={props.highlights}
        onCreateHighlight={onCreateHighlight}
        onDeleteHighlight={onDeleteHighlight}
        onSession={onSession}
        stats={stats}
        startAt={props.startAt ?? null}
      />
    );
  }

  return (
    <div
      data-testid="reader-loader"
      style={{ ...readerThemeVars(props.settings.theme ?? DEFAULT_READER_SETTINGS.theme), background: "var(--reader-bg)", color: "var(--reader-fg)" }}
      className="flex h-dvh w-full flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="max-w-md truncate text-base font-medium">{props.title}</h1>
      {phase.kind === "failed" ? (
        <>
          <p role="alert" className="max-w-sm text-sm text-[var(--reader-muted)]">
            {phase.message}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                // A ready book that failed to load may only have an expired signed URL: ask the server for a fresh one too.
                router.refresh();
                setAttempt((n) => n + 1);
              }}
              className="min-h-11 rounded-full border border-[var(--reader-border)] bg-[var(--reader-surface)] px-5 text-sm"
            >
              Try again
            </button>
            <Link href={props.backHref} className="inline-flex min-h-11 items-center rounded-full px-5 text-sm text-[var(--reader-muted)]">
              Back to library
            </Link>
          </div>
        </>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--reader-muted)]">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {phase.kind === "preparing" ? "Preparing for reading…" : "Opening…"}
        </p>
      )}
    </div>
  );
}
