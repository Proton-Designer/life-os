import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// A fresh module per test: the component caches the browser's zone list (React needs a stable snapshot), so each test starts clean.
async function load() {
  vi.resetModules();
  vi.doMock("@/app/(app)/settings/actions", () => ({ updateProfile: vi.fn(async () => {}) }));
  return (await import("../timezone-settings")).TimezoneSettings;
}

// Why this exists: /settings (Deen Mode OFF) logged "Hydration failed because the server rendered text didn't match the
// client" on EVERY load, and React threw away and rebuilt the whole page on the client (e2e: a node acted on was detached
// 150 ms after it appeared). Cause: the <select>'s options came from Intl.supportedValuesOf("timeZone"), which is DIFFERENT in
// Node (the server) and in the browser: the server listed America/Coyhaique where Chrome listed America/Creston.
const SERVER_ZONES = ["America/Chicago", "America/Coyhaique", "Europe/London"];
const BROWSER_ZONES = ["America/Chicago", "America/Creston", "Europe/London"];

function stubZones(zones: string[]) {
  vi.spyOn(Intl as unknown as { supportedValuesOf: (k: string) => string[] }, "supportedValuesOf").mockReturnValue(zones);
}
afterEach(() => vi.restoreAllMocks());

describe("TimezoneSettings hydration", () => {
  it("hydrates server markup cleanly even when the browser's timezone list differs from the server's (no recoverable error, no regenerated tree)", async () => {
    stubZones(SERVER_ZONES);
    const TimezoneSettings = await load();
    const html = renderToString(<TimezoneSettings initial="America/Chicago" />); // what the server sent
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const selectBefore = container.querySelector("select");

    stubZones(BROWSER_ZONES); // the client's Intl knows a different set
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <TimezoneSettings initial="America/Chicago" />, { onRecoverableError: (e) => errors.push(e) });
    });

    expect(errors).toEqual([]);
    expect(container.querySelector("select")).toBe(selectBefore); // the SAME node: hydrated, not regenerated
    container.remove();
  });

  it("after hydration the full list is offered, with the current zone selected", async () => {
    stubZones(BROWSER_ZONES);
    const TimezoneSettings = await load();
    const container = document.createElement("div");
    container.innerHTML = renderToString(<TimezoneSettings initial="America/Chicago" />);
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, <TimezoneSettings initial="America/Chicago" />);
    });
    const options = Array.from(container.querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(BROWSER_ZONES);
    expect(container.querySelector("select")!.value).toBe("America/Chicago");
    container.remove();
  });

  it("the server markup never depends on the zone list: just the current zone", async () => {
    stubZones(SERVER_ZONES);
    const TimezoneSettings = await load();
    const html = renderToString(<TimezoneSettings initial="America/Chicago" />);
    expect(html).toContain("America/Chicago");
    expect(html).not.toContain("America/Coyhaique");
    expect(html).not.toContain("Europe/London");
  });

  it("an account with no timezone set shows 'Not set' first", async () => {
    stubZones(BROWSER_ZONES);
    const TimezoneSettings = await load();
    const container = document.createElement("div");
    container.innerHTML = renderToString(<TimezoneSettings initial={null} />);
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, <TimezoneSettings initial={null} />);
    });
    expect(Array.from(container.querySelectorAll("option")).map((o) => o.textContent)[0]).toBe("Not set");
    container.remove();
  });
});
