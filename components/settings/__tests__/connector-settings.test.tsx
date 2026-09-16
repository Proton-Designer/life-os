import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/settings/mcp-token-actions", () => ({
  createMcpToken: vi.fn(),
  revokeMcpToken: vi.fn(),
}));

import { ConnectorSettings } from "../connector-settings";
import type { McpTokenStatus } from "@/app/(app)/settings/mcp-token-actions";

function token(overrides: Partial<McpTokenStatus> & { id: string }): McpTokenStatus {
  return {
    label: "A token",
    last4: "abcd",
    scopes: ["read"],
    createdAt: "2026-09-15T00:00:00Z",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    clientKind: "pat",
    ...overrides,
  };
}

// UX-04: the pass-1 audit found this list rendering ~25 rows permanently
// visible (QA-verification tokens accumulated on a shared fixture account) --
// the create-token form is the one action a user actually needs open by
// default; the existing-tokens list is what has no natural size cap and is
// what made the page tall.
describe("ConnectorSettings token-list reveal (UX-04)", () => {
  it("keeps the create-token form visible without any click", () => {
    render(<ConnectorSettings initialTokens={[token({ id: "t1" })]} />);
    expect(screen.getByLabelText(/Label \(so you can tell tokens apart later\)/)).toBeInTheDocument();
  });

  it("starts the existing-tokens list collapsed -- a token's label is not in the document until revealed", () => {
    render(<ConnectorSettings initialTokens={[token({ id: "t1", label: "My laptop" })]} />);
    expect(screen.queryByText("My laptop")).not.toBeInTheDocument();
  });

  it("reveals the list on click, showing every token", async () => {
    const user = userEvent.setup();
    render(<ConnectorSettings initialTokens={[token({ id: "t1", label: "My laptop" }), token({ id: "t2", label: "CI box" })]} />);
    await user.click(screen.getByRole("button", { name: /2 tokens/i }));
    expect(screen.getByText("My laptop")).toBeInTheDocument();
    expect(screen.getByText("CI box")).toBeInTheDocument();
  });

  it("shows the plain 'No tokens yet.' message directly, with nothing to reveal, when there are none", () => {
    render(<ConnectorSettings initialTokens={[]} />);
    expect(screen.getByText("No tokens yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tokens/i })).not.toBeInTheDocument();
  });
});
