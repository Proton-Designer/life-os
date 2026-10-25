"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** How often the page re-reads a book that is still being processed. A book now finishes in minutes, so this is what people watch. */
export const PROCESSING_POLL_MS = 5000;

/**
 * Renders nothing. While `active` (some book on the page is uploading or processing) it asks Next to re-render the server
 * page every PROCESSING_POLL_MS, so the stage label and percentage move without a manual reload. It does NOT poll while the
 * tab is hidden (nobody is looking, and a background tab should not keep hitting the database); when the tab comes back it
 * refreshes once straight away and resumes. It stops as soon as it unmounts: the server page renders it only while a book is
 * still processing, so the refresh that shows the book ready is the last one.
 */
export function AutoRefreshWhileProcessing({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => router.refresh(), PROCESSING_POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        router.refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, router]);

  return null;
}
