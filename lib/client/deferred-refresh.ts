/**
 * One trailing-edge, module-level debounce for `router.refresh()`.
 *
 * Why not `revalidatePath` inside every tap's Server Action: that makes the
 * action's response wait for a full server re-render of the page (1-3 s for
 * Deen / Home), and Next dispatches Server Actions one at a time, so rapid
 * taps queue behind those re-renders. Instead the controls update from local
 * state at once, the write is a lean action, and ONE refresh runs after the
 * burst settles (the `refreshDeenViews` Server Action: revalidatePath once). Module-level (not component state) so it still fires if the
 * dialog that started it has closed or the user navigated away. It must be a
 * `revalidatePath` (not `router.refresh()`): only that purges the client Router
 * Cache for OTHER routes, e.g. Home after tapping on /deen.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
let latest: (() => void) | null = null;

export function scheduleRouteRefresh(refresh: () => void, delayMs = 400): void {
  latest = refresh;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const run = latest;
    latest = null;
    run?.();
  }, delayMs);
}
