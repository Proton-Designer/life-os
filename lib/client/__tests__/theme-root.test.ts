// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyThemePreset, resetThemeRootForTests, syncServerThemePreset } from "../theme-root";

const root = () => document.documentElement.getAttribute("data-theme-preset");

describe("theme-root", () => {
  beforeEach(() => {
    resetThemeRootForTests();
    document.documentElement.removeAttribute("data-theme-preset");
    document.head.innerHTML = '<meta name="theme-color" content="#0a0a0c">';
  });

  it("applyThemePreset sets <html data-theme-preset> and the theme-color meta", () => {
    applyThemePreset("ocean");
    expect(root()).toBe("ocean");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#06141b");
  });

  it("the server value applies until the user has chosen; a stale server value never overrides a tab-local choice", () => {
    syncServerThemePreset("forest");
    expect(root()).toBe("forest");
    applyThemePreset("sunset");
    syncServerThemePreset("forest"); // stale payload arrives later
    expect(root()).toBe("sunset");
  });

  it("an unknown or missing server value resolves to Midnight", () => {
    syncServerThemePreset("garbage");
    expect(root()).toBe("oxblood");
    syncServerThemePreset(undefined);
    expect(root()).toBe("oxblood");
  });
});
