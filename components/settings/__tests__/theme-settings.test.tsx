import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";
import { resetThemeRootForTests } from "@/lib/client/theme-root";

const setThemePreset = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/app/(app)/settings/theme-actions", () => ({
  setThemePreset: (...args: unknown[]) => setThemePreset(...args),
  refreshThemeViews: vi.fn(async () => {}),
}));

import { ThemeSettings } from "../theme-settings";

const rootPreset = () => document.documentElement.getAttribute("data-theme-preset");

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ThemeSettings", () => {
  beforeEach(() => {
    resetKeyedQueuesForTests();
    resetThemeRootForTests();
    document.documentElement.removeAttribute("data-theme-preset");
    setThemePreset.mockReset();
    setThemePreset.mockImplementation(async () => {});
  });

  it("renders Midnight first and the other 4 presets, marking the initial one Current", () => {
    render(<ThemeSettings initial="oxblood" />);
    const labels = screen.getAllByRole("button").map((b) => b.querySelector("span")?.textContent);
    expect(labels).toEqual(["Midnight", "Ocean", "Forest", "Sunset", "Mono"]);
    expect(screen.getByRole("button", { name: /Midnight/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("a click restyles the root IMMEDIATELY (before the save resolves) and nothing is disabled", async () => {
    const save = deferred();
    setThemePreset.mockImplementationOnce(() => save.promise);
    const user = userEvent.setup();
    render(<ThemeSettings initial="oxblood" />);

    await user.click(screen.getByRole("button", { name: /Ocean/ }));

    expect(rootPreset()).toBe("ocean");
    expect(screen.getByRole("button", { name: /Ocean/ })).toHaveAttribute("aria-pressed", "true");
    for (const b of screen.getAllByRole("button")) expect(b).toBeEnabled();
    await act(async () => save.resolve());
  });

  it("rapid clicks across presets end on the LAST one, persisted in click order", async () => {
    const first = deferred();
    setThemePreset.mockImplementationOnce(() => first.promise);
    const user = userEvent.setup();
    render(<ThemeSettings initial="oxblood" />);

    await user.click(screen.getByRole("button", { name: /Ocean/ }));
    await user.click(screen.getByRole("button", { name: /Forest/ }));
    await user.click(screen.getByRole("button", { name: /Sunset/ }));
    expect(rootPreset()).toBe("sunset");
    await act(async () => first.resolve());
    await waitFor(() => expect(setThemePreset).toHaveBeenCalledTimes(3));
    expect(setThemePreset.mock.calls.map((c) => c[0])).toEqual(["ocean", "forest", "sunset"]);
    expect(rootPreset()).toBe("sunset");
  });

  it("clicking the already-selected preset saves nothing", async () => {
    const user = userEvent.setup();
    render(<ThemeSettings initial="oxblood" />);
    await user.click(screen.getByRole("button", { name: /Midnight/ }));
    expect(setThemePreset).not.toHaveBeenCalled();
  });

  it("a failed save puts the app back on the last saved preset and shows an error", async () => {
    setThemePreset.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<ThemeSettings initial="oxblood" />);

    await user.click(screen.getByRole("button", { name: /Forest/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByRole("button", { name: /Midnight/ })).toHaveAttribute("aria-pressed", "true");
    expect(rootPreset()).toBe("oxblood");
  });
});
