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
      // Keep the same bottom margin the element already has at rest,
      // measured against the layout viewport, but re-anchored to the
      // currently-visible (possibly panned) region.
      const bottomMargin = window.innerHeight - natural.top - natural.height;
      const desiredLeft = vv.offsetLeft + (vv.width - natural.width) / 2;
      const desiredTop = vv.offsetTop + vv.height - bottomMargin - natural.height;
      // transform-origin is top left, so scale (applied first, right-to-
      // left) anchors at the element's own top-left corner and doesn't
      // move it — translate then carries that exact corner from its
      // natural position to the desired one. Scaling by 1/scale shrinks
      // the element's layout box so that, after the page's own pinch
      // magnification is applied on top, its rendered size cancels back
      // out to constant.
      el.style.transformOrigin = "top left";
      el.style.transform = `translate(${desiredLeft - natural.left}px, ${desiredTop - natural.top}px) scale(${1 / scale})`;
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
