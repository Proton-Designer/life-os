"use client";

import { useLayoutEffect } from "react";
import { syncServerThemePreset } from "@/lib/client/theme-root";

/** Keeps <html data-theme-preset> in step with the server-rendered preference on client navigations (see lib/client/theme-root.ts for why a tab-local choice wins). */
export function ThemeRootSync({ preset }: { preset: string }) {
  useLayoutEffect(() => {
    syncServerThemePreset(preset);
  }, [preset]);
  return null;
}
