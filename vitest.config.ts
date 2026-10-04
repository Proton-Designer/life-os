import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Two projects, one run. `.tsx` tests render components and get jsdom; `.ts`
// tests are logic and run in plain Node, which costs ~1/2.7 the CPU (measured
// 2026-10-04: 37 lib files, 25.3s vs 9.5s user+sys) -- jsdom for all 590 files
// was the main reason a full run pinned every core. A `.ts` test that needs a
// DOM (document/window/localStorage) opts in with a first-line
// `// @vitest-environment jsdom` docblock; without it, it fails loudly with
// "document is not defined", never silently.
const shared = {
  globals: true,
  setupFiles: ["./vitest.setup.ts"],
  exclude: ["node_modules", ".next", "e2e", ".claude/**"],
};

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      { extends: true, test: { ...shared, name: "dom", environment: "jsdom", include: ["**/__tests__/**/*.test.tsx"] } },
      { extends: true, test: { ...shared, name: "node", environment: "node", include: ["**/__tests__/**/*.test.ts"] } },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // See test-stubs/server-only.ts: keeps the real build-time guard while
      // letting server-only modules be unit tested.
      "server-only": path.resolve(__dirname, "./test-stubs/server-only.ts"),
    },
  },
});
