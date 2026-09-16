import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/settings/api-key-actions", () => ({
  saveApiKey: vi.fn(),
  removeApiKey: vi.fn(),
  testStoredKey: vi.fn(),
}));

import { ApiKeySettings, type ProviderInfo } from "../api-key-settings";
import type { KeyStatus } from "@/app/(app)/settings/api-key-actions";

const PROVIDERS: ProviderInfo[] = [
  { id: "deepseek", label: "DeepSeek", consoleUrl: "https://deepseek.example", unlocks: "Cheap everyday model." },
  { id: "anthropic", label: "Claude", consoleUrl: "https://claude.example", unlocks: "Flagship model." },
  { id: "openai", label: "OpenAI", consoleUrl: "https://openai.example", unlocks: "GPT models." },
];

// UX-04: six always-open provider blocks was one of the pass-1 audit's
// concrete "feature dump" findings (UX-AUDIT-pass1.md). Collapsing each
// into an expandable row, open by default only when connected, is
// presentation-only -- no save/remove/test logic changes.
describe("ApiKeySettings collapsing (UX-04)", () => {
  it("starts a provider with no stored key collapsed -- its key-entry form is not in the document", () => {
    render(<ApiKeySettings providers={PROVIDERS} initialStatuses={[]} storageConfigured />);
    expect(screen.queryByLabelText(/Paste your DeepSeek API key/)).not.toBeInTheDocument();
  });

  it("clicking a collapsed provider's row reveals its key-entry form", async () => {
    const user = userEvent.setup();
    render(<ApiKeySettings providers={PROVIDERS} initialStatuses={[]} storageConfigured />);
    await user.click(screen.getByRole("button", { name: /DeepSeek/ }));
    expect(screen.getByLabelText(/Paste your DeepSeek API key/)).toBeInTheDocument();
  });

  it("starts a connected provider expanded -- its status and Remove/Test controls are visible without a click", () => {
    const stored: KeyStatus[] = [{ provider: "anthropic", last4: "abcd", label: null, addedAt: "2026-09-15T00:00:00Z" }];
    render(<ApiKeySettings providers={PROVIDERS} initialStatuses={stored} storageConfigured />);
    expect(screen.getByText(/connected · ····abcd/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("every provider label is still visible even when collapsed -- nothing is hidden, just its detail", () => {
    render(<ApiKeySettings providers={PROVIDERS} initialStatuses={[]} storageConfigured />);
    for (const p of PROVIDERS) {
      expect(screen.getByText(p.label)).toBeInTheDocument();
    }
  });
});
