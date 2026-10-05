import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeRootScript } from "../theme-root-script";
import { PRESET_PREVIEW } from "@/lib/theme-presets";

/**
 * React DOM (the copy Next ships, react-dom-client.development.js) logs "Encountered a script tag while rendering React
 * component" for a client-rendered <script> unless isScriptDataBlock(props): a non-empty `type` that is not a JavaScript
 * MIME (and not module/importmap/speculationrules). This mirrors that rule; the stock react-dom vitest resolves has no such
 * warning, so the rule itself is what this pins.
 */
const JS_TYPES = ["application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript", "text/ecmascript", "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2", "text/javascript1.3", "text/javascript1.4", "text/javascript1.5", "text/jscript", "text/livescript", "text/x-ecmascript", "text/x-javascript"];
const isScriptDataBlock = (type: string | null) => {
  if (!type) return false;
  const t = type.toLowerCase();
  return !(t === "module" || t === "importmap" || t === "speculationrules" || JS_TYPES.includes(t));
};

describe("ThemeRootScript", () => {
  it("client render: an inert data block, which React does not warn about (positive control: a plain or text/javascript script is not one and WOULD warn)", () => {
    expect(isScriptDataBlock(null)).toBe(false);
    expect(isScriptDataBlock("text/javascript")).toBe(false);
    const { container } = render(<ThemeRootScript preset="ocean" />);
    expect(isScriptDataBlock(container.querySelector("script")!.getAttribute("type"))).toBe(true);
  });

  it("client render never executes: the attribute is not set by rendering it", () => {
    document.documentElement.removeAttribute("data-theme-preset");
    render(<ThemeRootScript preset="ocean" />);
    expect(document.documentElement.getAttribute("data-theme-preset")).toBeNull();
  });
});

describe("ThemeRootScript on the server (what the browser parses)", () => {
  it("is an executable script with no type attribute, setting the preset and theme-color before paint", () => {
    const g = globalThis as { window?: unknown };
    const saved = g.window;
    delete g.window; // simulate the server: no window
    try {
      const html = renderToString(<ThemeRootScript preset="ocean" />);
      expect(html).toContain("<script");
      expect(html).not.toContain('type="application/json"');
      expect(html).toContain('data-theme-preset');
      expect(html).toContain("ocean");
      expect(html).toContain(PRESET_PREVIEW.ocean.bg);
    } finally {
      g.window = saved;
    }
  });
});
