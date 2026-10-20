"use client";

import { useEffect } from "react";

// Freezes the page behind a full-screen view. `overflow: hidden` alone does not stop iOS/iPadOS Safari from scrolling
// the page under a fixed layer, so the body is pinned in place and the scroll position restored on release. This is
// the commit-5bdb53c technique from LockInOverlay as a shared hook; locks are counted so overlapping users restore
// in the right order (the first to lock saves the page state, the last to release puts it back).
let lockCount = 0;
let restore: (() => void) | null = null;

function acquire(): void {
  lockCount++;
  if (lockCount > 1) return;
  const { body, documentElement: html } = document;
  const scrollY = window.scrollY;
  const prev = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overscroll: html.style.overscrollBehavior,
  };
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  html.style.overscrollBehavior = "none";
  restore = () => {
    body.style.position = prev.position;
    body.style.top = prev.top;
    body.style.left = prev.left;
    body.style.right = prev.right;
    body.style.width = prev.width;
    html.style.overscrollBehavior = prev.overscroll;
    window.scrollTo(0, scrollY);
  };
}

function release(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && restore) {
    restore();
    restore = null;
  }
}

export function useBodyPin(active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    acquire();
    return release;
  }, [active]);
}

/** Test seam: forget any lock state a failed test left behind. */
export function resetBodyPinForTests(): void {
  if (restore) restore();
  restore = null;
  lockCount = 0;
}
