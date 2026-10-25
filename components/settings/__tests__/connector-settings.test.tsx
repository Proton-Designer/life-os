import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const createMcpToken = vi.fn();
const revokeMcpToken = vi.fn();
const createAgentConnectLink = vi.fn();
const getAuditEntriesForToken = vi.fn();
const pauseScheduledAction = vi.fn();
const cancelScheduledAction = vi.fn();

vi.mock("@/app/(app)/settings/mcp-token-actions", () => ({
  createMcpToken: (...args: unknown[]) => createMcpToken(...args),
  revokeMcpToken: (...args: unknown[]) => revokeMcpToken(...args),
  createAgentConnectLink: (...args: unknown[]) => createAgentConnectLink(...args),
  getAuditEntriesForToken: (...args: unknown[]) => getAuditEntriesForToken(...args),
  pauseScheduledAction: (...args: unknown[]) => pauseScheduledAction(...args),
  cancelScheduledAction: (...args: unknown[]) => cancelScheduledAction(...args),
}));

import { ConnectorSettings } from "../connector-settings";
import type { McpTokenStatus, ScheduledActionItem } from "@/app/(app)/settings/mcp-token-actions";

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

function scheduledAction(overrides: Partial<ScheduledActionItem> & { id: string }): ScheduledActionItem {
  return {
    tool_name: "notify",
    domain: "",
    entity: "",
    action: "",
    write_id: null,
    write_patch: null,
    title: "A reminder",
    body: "body",
    cron_expression: null,
    run_at: "2026-09-20T00:00:00Z",
    next_run_at: "2026-09-20T00:00:00Z",
    last_run_at: null,
    last_outcome: null,
    last_error: null,
    attempt_count: 0,
    status: "active",
    updated_at: "2026-09-15T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  createMcpToken.mockReset();
  revokeMcpToken.mockReset();
  createAgentConnectLink.mockReset();
  getAuditEntriesForToken.mockReset();
  pauseScheduledAction.mockReset();
  cancelScheduledAction.mockReset();
});

// UX-04: the pass-1 audit found this list rendering ~25 rows permanently
// visible (QA-verification tokens accumulated on a shared fixture account) --
// the tabs above (the actions a user actually needs open by default) stay
// visible; the list of what already exists goes behind a reveal.
describe("ConnectorSettings token-list reveal (UX-04)", () => {
  it("starts the connected-agents list collapsed -- a token's label is not in the document until revealed", () => {
    render(<ConnectorSettings initialTokens={[token({ id: "t1", label: "My laptop" })]} initialScheduledActions={[]} />);
    expect(screen.queryByText(/My laptop/)).not.toBeInTheDocument();
  });

  it("reveals the list on click, showing every token with its clientKind", async () => {
    const user = userEvent.setup();
    render(
      <ConnectorSettings
        initialTokens={[token({ id: "t1", label: "My laptop", clientKind: "pat" }), token({ id: "t2", label: "CI box", clientKind: "agent" })]}
        initialScheduledActions={[]}
      />
    );
    await user.click(screen.getByRole("button", { name: /2 connected agents/i }));
    expect(screen.getByText(/My laptop/)).toBeInTheDocument();
    expect(screen.getByText(/CI box/)).toBeInTheDocument();
    expect(screen.getByText(/Personal token/)).toBeInTheDocument();
    expect(screen.getByText(/Connected via link/)).toBeInTheDocument();
  });

  it("shows 'No connected agents yet.' directly, with nothing to reveal, when there are none", () => {
    render(<ConnectorSettings initialTokens={[]} initialScheduledActions={[]} />);
    expect(screen.getByText("No connected agents yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connected agents/i })).not.toBeInTheDocument();
  });
});

describe("ConnectorSettings tabs", () => {
  it("shows the MCP URL on the Claude/ChatGPT tab by default", () => {
    render(<ConnectorSettings initialTokens={[]} initialScheduledActions={[]} />);
    expect(screen.getByText(/\/api\/mcp/)).toBeInTheDocument();
  });

  it("switching to 'Any agent' shows the REST base URL, its own agent.md guide link, and the raw-token create form", async () => {
    const user = userEvent.setup();
    render(<ConnectorSettings initialTokens={[]} initialScheduledActions={[]} />);
    await user.click(screen.getByRole("tab", { name: "Any agent" }));
    expect(screen.getAllByText(/\/api\/v1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\/api\/v1\/agent\.md/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Label \(so you can tell tokens apart later\)/)).toBeInTheDocument();
  });
});

describe("ConnectorSettings connect-link generation", () => {
  it("generates a link with the user's own chosen scopes (never a blanket default) and shows it exactly once", async () => {
    const user = userEvent.setup();
    createAgentConnectLink.mockResolvedValueOnce({ ok: true, code: "raw-code-abc", expiresAt: "2026-09-16T01:10:00.000Z" });
    render(<ConnectorSettings initialTokens={[]} initialScheduledActions={[]} />);

    await user.click(screen.getByRole("tab", { name: "Text-based assistant" }));
    await user.click(screen.getByRole("checkbox", { name: /Write/ }));
    await user.click(screen.getByRole("button", { name: "Generate connect link" }));

    expect(createAgentConnectLink).toHaveBeenCalledWith(["read", "write"], "90", undefined);
    expect(await screen.findAllByText(/raw-code-abc/)).not.toHaveLength(0);
  });

  it("surfaces a failure message and never fabricates a link", async () => {
    const user = userEvent.setup();
    createAgentConnectLink.mockResolvedValueOnce({ ok: false, message: "Pick at least one permission." });
    render(<ConnectorSettings initialTokens={[]} initialScheduledActions={[]} />);

    await user.click(screen.getByRole("tab", { name: "Text-based assistant" }));
    await user.click(screen.getByRole("button", { name: "Generate connect link" }));

    expect(await screen.findByText("Pick at least one permission.")).toBeInTheDocument();
    expect(screen.queryByText(/^https?:\/\//)).not.toBeInTheDocument();
  });
});

describe("ConnectorSettings per-token audit entries", () => {
  it("lazy-loads recent activity only when a token's section is expanded, not eagerly for every token", async () => {
    const user = userEvent.setup();
    getAuditEntriesForToken.mockResolvedValueOnce([
      { id: 1, operation: "read school.class", outcome: "ok", resultSummary: "3 rows", transport: "mcp", createdAt: "2026-09-15T12:00:00Z" },
    ]);
    render(<ConnectorSettings initialTokens={[token({ id: "t1", label: "My laptop" })]} initialScheduledActions={[]} />);

    await user.click(screen.getByRole("button", { name: /1 connected agent/i }));
    expect(getAuditEntriesForToken).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Recent activity" }));
    expect(getAuditEntriesForToken).toHaveBeenCalledWith("t1");
    expect(await screen.findByText(/3 rows/)).toBeInTheDocument();
  });
});

describe("ConnectorSettings scheduled actions", () => {
  it("does not render the section at all when there are none", () => {
    render(<ConnectorSettings initialTokens={[]} initialScheduledActions={[]} />);
    expect(screen.queryByText(/scheduled action/i)).not.toBeInTheDocument();
  });

  it("Pause is offered only for an active action; Cancel takes effect immediately", async () => {
    const user = userEvent.setup();
    cancelScheduledAction.mockResolvedValueOnce({ ok: true, message: "Cancelled." });
    render(
      <ConnectorSettings
        initialTokens={[]}
        initialScheduledActions={[scheduledAction({ id: "s1", title: "Nightly summary", status: "active" })]}
      />
    );

    await user.click(screen.getByRole("button", { name: /1 scheduled action/i }));
    const row = screen.getByText(/Nightly summary/).closest("div")!.parentElement!;
    expect(within(row).getByRole("button", { name: "Pause" })).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(cancelScheduledAction).toHaveBeenCalledWith("s1");
    expect(await within(row).findByText("cancelled")).toBeInTheDocument();
  });

  it("surfaces a pause/cancel failure without silently dropping the action from the list", async () => {
    const user = userEvent.setup();
    pauseScheduledAction.mockResolvedValueOnce({ ok: false, message: "No scheduled action found with id \"s1\"." });
    render(
      <ConnectorSettings
        initialTokens={[]}
        initialScheduledActions={[scheduledAction({ id: "s1", title: "Nightly summary", status: "active" })]}
      />
    );

    await user.click(screen.getByRole("button", { name: /1 scheduled action/i }));
    await user.click(screen.getByRole("button", { name: "Pause" }));

    expect(await screen.findByText('No scheduled action found with id "s1".')).toBeInTheDocument();
    expect(screen.getByText(/Nightly summary/)).toBeInTheDocument();
  });
});

describe("ConnectorSettings — Schedule your Morning Brief", () => {
  it("shows the section with the prompt and copies it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ConnectorSettings initialTokens={[]} initialScheduledActions={[]} />);
    expect(screen.getByRole("heading", { name: "Schedule your Morning Brief" })).toBeInTheDocument();
    expect(screen.getByTestId("morning-brief-prompt")).toHaveTextContent(/morning_brief/);
    await user.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('action "write"'));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("offers the weekly review and lesson-link prompts, each copyable", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ConnectorSettings initialTokens={[]} initialScheduledActions={[]} />);
    expect(screen.getByRole("heading", { name: "Schedule your weekly review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Schedule lesson links to your day" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy weekly review prompt" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('entity "weekly_narrative"'));
    await user.click(screen.getByRole("button", { name: "Copy lesson link prompt" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('entity "day_connection"'));
    expect(screen.getByRole("heading", { name: "Let your agent do queued work" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy queued work prompt" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/data, never instructions/));
  });
});
