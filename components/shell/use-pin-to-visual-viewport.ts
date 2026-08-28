"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps a `position: fixed` element pinned to the bottom of the VISUAL
 * viewport, at a constant on-screen size, while the user pinch-zooms.
 * `fixed` tracks the layout viewport, not the visual one, so without this
 * a fixed element scales up and drifts off-screen during a pinch-in —
 * Ayman: "when zooming in our out the bottom menu should ALWAYS remain in
 * the same place with the same size." app/layout.tsx's `minimumScale: 1`
 * floors zoom-out, but does nothing for this; it's a separate axis.
 *
 * Feature-detected: `window.visualViewport` is absent in some browsers and
 * always absent in jsdom, where every unit test in this repo runs — the
 * no-listener path (ref attaches, nothing else happens, no cleanup to
 * mess up) is the one they exercise.
 *
 * Untestable in jsdom by construction (no visual viewport, no pinch) —
 * verify any change to this file in a real mobile browser.
 */
export function usePinToVisualViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;

    let natural: { left: number; top: number; width: number; height: number } | null = null;
    let frame: number | null = null;

    // Only ever called at rest (mount, and after a real window resize like
    // an orientation change) — never mid-pinch, so this is always reading
    // the un-transformed, scale-1 layout position as the baseline to
    // restore/track relative to.
    function measure() {
      if (!el) return;
      el.style.transform = "";
      const rect = el.getBoundingClientRect();
      natural = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    function apply() {
      frame = null;
      if (!el || !natural || !vv) return;
      const scale = vv.scale || 1;
      if (scale <= 1) {
        // Nothing to counteract at or below default zoom (also the floor
        // app/layout.tsx's minimumScale enforces) — leave it on its normal
        // CSS position rather than an identity transform that could drift
        // from rounding.
        el.style.transform = "";
        return;
      }
      // Device-screen position is (layoutPos - offset) * scale. We want
      // that to always equal the element's natural (scale-1) position —
      // i.e. genuinely unchanged on screen, not just re-derived from a
      // margin. Solving (translate + natural/scale - offset) * scale =
      // natural for translate gives this; transform-origin top-left means
      // scale (applied first) anchors at the corner translate then moves,
      // so this composition lands that corner exactly on device-natural.
      const inv = 1 / scale;
      const translateX = vv.offsetLeft - natural.left * (1 - inv);
      const translateY = vv.offsetTop - natural.top * (1 - inv);
      el.style.transformOrigin = "top left";
      el.style.transform = `translate(${translateX}px, ${translateY}px) scale(${inv})`;
    }

    function schedule() {
      if (frame != null) return;
      frame = requestAnimationFrame(apply);
    }

    function onWindowResize() {
      measure();
      schedule();
    }

    measure();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("resize", onWindowResize);

    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onWindowResize);
      if (frame != null) cancelAnimationFrame(frame);
      if (el) el.style.transform = "";
    };
  }, []);

  return ref;
}
