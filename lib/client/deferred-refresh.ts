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
// Pending refreshes keyed by `key` (default: the function itself): DIFFERENT surfaces (Deen,
// Home, Business...) scheduled in the same window must ALL run, while the same surface
// scheduled many times runs once. (A single "latest" slot silently dropped the earlier
// surface's revalidation.) Callers whose closure is re-created per call pass a stable key.
const pending = new Map<unknown, () => void>();

export function scheduleRouteRefresh(refresh: () => void, delayMs = 400, key: unknown = refresh): void {
  pending.set(key, refresh);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const runs = [...pending.values()];
    pending.clear();
    for (const run of runs) run();
  }, delayMs);
}

export function resetDeferredRefreshForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending.clear();
}
