import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CalendarDialogTrigger } from "../calendar-dialog-trigger";

// This file tests the module-scope cache/keying/invalidation logic, not the
// idle-time prefetch (covered by topbar.test.tsx) or the exact number of
// underlying network calls a single open produces — the trigger button also
// prefetches on pointerenter/pointerdown, which real userEvent clicks
// dispatch on the way to the click itself, so a raw call count is
// timing-sensitive rather than meaningful. What's actually being verified
// below is user-visible: does it ever paint a spinner over data it already
// has, does it ever paint the wrong account's data, and does a save ever
// lose a race to a slower in-flight fetch.
beforeEach(() => {
  vi.stubGlobal("requestIdleCallback", () => 0);
  vi.stubGlobal("cancelIdleCallback", () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Every test uses its own accountKey so the module-scope cache (shared
// across this whole file, by design — see the component's own comment)
// never carries state between cases: a different key is always a cache
// miss, which is exactly the fail-closed behavior under test.
let keyCounter = 0;
function freshKey(): string {
  keyCounter += 1;
  return `test-account-${keyCounter}@example.com`;
}

const EMPTY_DATA = { items: [], undatedDeadlines: [], deen: null, business: null };

function renderTrigger(overrides: Partial<React.ComponentProps<typeof CalendarDialogTrigger>> = {}) {
  const getWeekCalendar = overrides.getWeekCalendar ?? vi.fn(async () => EMPTY_DATA);
  const accountKey = overrides.accountKey ?? freshKey();
  const utils = render(
    <CalendarDialogTrigger
      accountKey={accountKey}
      timezone="America/Chicago"
      getWeekCalendar={getWeekCalendar}
      onSaveDeen={overrides.onSaveDeen ?? vi.fn(async () => {})}
      onSaveBusiness={overrides.onSaveBusiness ?? vi.fn(async () => {})}
    />
  );
  return { ...utils, accountKey, getWeekCalendar };
}

describe("CalendarDialogTrigger", () => {
  it("shows the loading state on a genuine cold start (nothing cached for this account yet)", async () => {
    let resolveFetch!: (value: typeof EMPTY_DATA) => void;
    const getWeekCalendar = vi.fn(
      () =>
        new Promise<typeof EMPTY_DATA>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const user = userEvent.setup();
    renderTrigger({ getWeekCalendar });

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    expect(await screen.findByText("Loading…")).toBeInTheDocument();

    resolveFetch(EMPTY_DATA);
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  });

  it("paints a cached snapshot instantly on a second open — no spinner, no re-render gap", async () => {
    const getWeekCalendar = vi.fn(async () => EMPTY_DATA);
    const user = userEvent.setup();
    renderTrigger({ getWeekCalendar });

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    // Data paints immediately from cache — never shows the spinner on this second open.
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("still revalidates behind a cached paint (correctness: other screens can change this data)", async () => {
    // The trigger button also prefetches on pointerenter/pointerdown, which
    // a real click dispatches on its way to the click event itself — so a
    // single open can produce more than one underlying fetch, and which one
    // "wins" the final render is a resolution-order detail, not something
    // worth pinning down here. What matters: reopening produces a DIFFERENT,
    // later revision than the one already on screen — i.e. it's genuinely
    // asking again, not serving the same cached read forever.
    let call = 0;
    const getWeekCalendar = vi.fn(async () => {
      call += 1;
      return { ...EMPTY_DATA, undatedDeadlines: [{ id: String(call), title: `revision ${call}`, domainLabel: "School", dueDate: "2026-08-25" }] };
    });
    const user = userEvent.setup();
    renderTrigger({ getWeekCalendar });

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    await waitFor(() => expect(screen.getByText(/revision \d+/)).toBeInTheDocument());
    const firstRevisionText = screen.getByText(/revision \d+/).textContent;
    const callsAfterFirstOpen = getWeekCalendar.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    // A fresh revalidation call happened on this reopen (not served from a
    // cache that's never asked again), and its result is what's shown.
    await waitFor(() => expect(getWeekCalendar.mock.calls.length).toBeGreaterThan(callsAfterFirstOpen));
    await waitFor(() => expect(screen.getByText(/revision \d+/).textContent).not.toBe(firstRevisionText));
  });

  it("fails closed on a cross-account key: never paints a previous account's cached data under a new key", async () => {
    const keyA = freshKey();
    const keyB = freshKey();
    const getWeekCalendarA = vi.fn(async () => ({
      ...EMPTY_DATA,
      undatedDeadlines: [{ id: "a", title: "Account A task", domainLabel: "School", dueDate: "2026-08-25" }],
    }));
    const user = userEvent.setup();
    const { unmount } = renderTrigger({ accountKey: keyA, getWeekCalendar: getWeekCalendarA });
    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    await waitFor(() => expect(screen.getByText("Account A task")).toBeInTheDocument());
    unmount();

    const getWeekCalendarB = vi.fn(async () => EMPTY_DATA);
    renderTrigger({ accountKey: keyB, getWeekCalendar: getWeekCalendarB });
    await user.click(screen.getByRole("button", { name: /open calendar/i }));

    // Must fetch fresh under the new key, never paint account A's cached row.
    await waitFor(() => expect(getWeekCalendarB).toHaveBeenCalled());
    expect(screen.queryByText("Account A task")).not.toBeInTheDocument();
  });

  it("does not let a slower in-flight fetch overwrite a save that landed while it was pending (stale-write bug)", async () => {
    // Reproduces the exact race the Lead flagged: handleOpenChange fires
    // load() on every open, so a reopen-then-immediately-edit-and-save can
    // land the save while the reopen's own revalidation is still pending.
    // Nulling the cache alone doesn't defeat that in-flight promise —
    // fetchAndCache would hand back the pre-save promise and its pre-save
    // payload. A generation bump is what actually invalidates it.
    const key = freshKey();
    let resolveStaleRevalidation!: (value: typeof EMPTY_DATA) => void;
    const staleRevalidation = new Promise<typeof EMPTY_DATA>((resolve) => {
      resolveStaleRevalidation = resolve;
    });
    let call = 0;
    const getWeekCalendar = vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve(EMPTY_DATA); // initial paint, populates the cache
      if (call === 2) return staleRevalidation; // reopen's own revalidation — left pending, resolved late below
      return Promise.resolve({
        ...EMPTY_DATA,
        deen: { headline: "post-save headline", milestones: [], quranPages: 0, quranTarget: null },
      });
    });
    const onSaveDeen = vi.fn(async () => {});
    const user = userEvent.setup();
    renderTrigger({ accountKey: key, getWeekCalendar, onSaveDeen });

    // Initial open: populates the cache, then close.
    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Reopen: paints instantly from cache, kicks off a revalidation that we
    // deliberately leave pending (call #2, `staleRevalidation`).
    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    await waitFor(() => expect(call).toBeGreaterThanOrEqual(2));

    // Save while that revalidation is still in flight — this must start a
    // genuinely new fetch (call #3), not be satisfied by the pending one.
    await user.click(screen.getByRole("button", { name: "Edit Deen goal" }));
    await user.type(await screen.findByPlaceholderText("This week's headline goal"), "New headline");
    const savePromise = user.click(screen.getByRole("button", { name: "Save goal" }));
    await waitFor(() => expect(screen.getByText("post-save headline")).toBeInTheDocument());

    // Only now let the stale revalidation resolve, late, with its pre-save payload.
    resolveStaleRevalidation(EMPTY_DATA);
    await savePromise;

    // The stale payload must not have overwritten the post-save one.
    expect(screen.getByText("post-save headline")).toBeInTheDocument();
  });
});
