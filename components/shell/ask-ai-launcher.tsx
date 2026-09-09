"use client";

import { ExternalLink, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// System B (2026-09): quick, low-friction access to the AI platform Ayman is
// already subscribed to — plain https:// links only, no embed (chatgpt.com
// and claude.ai send X-Frame-Options: SAMEORIGIN, gemini.google.com sends
// DENY — an iframe cannot work here, verified directly against response
// headers) and no custom "is the app installed?" detection JavaScript (iOS
// Universal Links / Android App Links already do that at the OS level; hand
// -rolled detection is the fragile timing hack this mechanism exists to
// avoid). See docs/superpowers/specs/2026-09-09-ai-integration-handoff.md §4.
//
// Deliberately no per-platform copy about native-app hand-off: Claude
// documents that https://claude.ai links open its app when installed, but
// ChatGPT's equivalent behavior is undocumented and Gemini's is unverified
// (handoff doc §4) — promising it in UI copy for ChatGPT specifically would
// be a claim nobody can back up, so every row just names the platform.
export const AI_PLATFORMS = [
  { key: "claude", label: "Claude", href: "https://claude.ai/new" },
  { key: "chatgpt", label: "ChatGPT", href: "https://chatgpt.com/" },
  { key: "gemini", label: "Gemini", href: "https://gemini.google.com/app" },
] as const;

/**
 * The three platform links, styled to match the existing "More" popover rows
 * in mobile-island.tsx (same classes) so it reads as one list, not a bolted
 * -on section. Rendered directly into an already-open popover — no nested
 * popover-in-popover, which avoids a second layer of Radix portal/z-index
 * interactions for three links.
 */
export function AskAiLinks() {
  return (
    <>
      {AI_PLATFORMS.map((platform) => (
        <a
          key={platform.key}
          href={platform.href}
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
        >
          <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
          {platform.label}
        </a>
      ))}
    </>
  );
}

/**
 * Self-contained trigger + popover for the desktop sidebar (AppSidebar),
 * which has no existing "more" affordance to fold into the way
 * mobile-island.tsx does. `variant` mirrors SidebarNav's icon-rail/expanded
 * split so it sits visually with the rest of that shell.
 */
export function AskAiLauncher({ variant }: { variant: "icon-rail" | "expanded" }) {
  const iconOnly = variant === "icon-rail";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ask AI"
          className={cn(
            "flex items-center gap-3 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground",
            iconOnly ? "size-10 justify-center" : "w-full px-3 py-2"
          )}
        >
          <Sparkles className="size-4 shrink-0" />
          <span className={iconOnly ? "sr-only" : undefined}>Ask AI</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-40 p-1"
        side={iconOnly ? "right" : "top"}
        align={iconOnly ? "start" : "center"}
      >
        <AskAiLinks />
      </PopoverContent>
    </Popover>
  );
}
