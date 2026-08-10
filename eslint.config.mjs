import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Standard convention for intentionally-unused params (interface
      // shape requires them; body doesn't use them).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Tool-managed state directories, not project source.
    ".remember/**",
    ".superpowers/**",
    // Static assets served directly to the browser, not part of the app
    // bundle — the service worker in particular runs in its own global
    // scope (self, not window) and isn't meant to follow app lint rules.
    "public/**",
  ]),
]);

export default eslintConfig;
