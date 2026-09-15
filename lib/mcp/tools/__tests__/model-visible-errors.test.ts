import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { AuthInfoLike } from "../../auth-info";

/**
 * P4-01 — the MODEL must see caller-input errors. These tests run the REAL
 * `runMcpTool` wrapper around the REAL tool functions and assert on the text
 * the MCP client actually receives — not merely on what a tool throws — so
 * they fail if either the throw site's error class or the wrapper's
 * pass-through regresses.
 *
 * Positive control (recorded in the P4-01 task log): the first test below
 * ("read with an unknown entity ... Known entities") FAILED on HEAD 8d1b4cf
 * with "Something went wrong running that tool." before the fix (21 of 25
 * failed). The two "STORED ... stays generic" tests were proven the same
 * way: with the demotion in widget-manage.ts / actions-core.ts removed,
 * both fail.
 */

let currentUserClient: SupabaseClient;
vi.mock("../../session", () => ({
  mintSessionJwt: vi.fn(async () => "fake.jwt.token"),
  buildUserScopedClient: vi.fn(() => currentUserClient),
}));

const GENERIC = "Something went wrong running that tool.";
const AUTH: AuthInfoLike = { scopes: ["read", "write"], extra: { userId: "user-1", tokenId: "tok-1" } };

function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error(`Expected a text content block, got: ${JSON.stringify(block)}`);
  return block.text;
}

/** Service-role client: rate-limit count query + audit insert, both succeed. */
function makeServiceClient(): SupabaseClient {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte"]) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => resolve({ count: 0, error: null });
    chain.insert = vi.fn(() => ({ then: (resolve: (v: unknown) => void) => resolve({ error: null }) }));
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

/** User-scoped client: every query chain resolves to the same canned `{data, error}`. */
function makeUserClient(opts: { single?: unknown; list?: unknown[]; error?: unknown } = {}): SupabaseClient {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "insert", "update"]) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: opts.single ?? null, error: opts.error ?? null }));
    chain.single = vi.fn(async () => ({ data: opts.single ?? null, error: opts.error ?? null }));
    chain.range = vi.fn(async () => ({ data: opts.list ?? [], error: opts.error ?? null, count: (opts.list ?? []).length }));
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: opts.list ?? [], error: opts.error ?? null });
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

async function run(fn: (userClient: SupabaseClient, userId: string) => Promise<import("../../tool-wrapper").RunMcpToolOutcome>): Promise<CallToolResult> {
  const { runMcpTool } = await import("../../tool-wrapper");
  return runMcpTool(makeServiceClient(), AUTH, "test_tool", "test.op", "write", {}, fn);
}

beforeEach(() => {
  currentUserClient = makeUserClient();
});

describe("read — caller-input errors reach the model verbatim", () => {
  it("read with an unknown entity names the Known entities (positive control)", async () => {
    const { readTool } = await import("../read");
    const result = await run((c, u) => readTool(c, u, { domain: "deen", entity: "not_a_real_entity" }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Known entities:");
    expect(textOf(result)).toContain("prayer");
  });

  it("read with an unknown domain names the domain and points at list_capabilities", async () => {
    const { readTool } = await import("../read");
    const result = await run((c, u) => readTool(c, u, { domain: "nope", entity: "x" }));
    expect(textOf(result)).toMatch(/Unknown domain "nope".*list_capabilities/);
  });

  it("read with a bad `fields` name lists the Available columns", async () => {
    const { readTool } = await import("../read");
    const result = await run((c, u) => readTool(c, u, { domain: "deen", entity: "prayer", fields: ["secret_col"] }));
    expect(textOf(result)).toMatch(/secret_col.*Available: date, prayer_name/);
  });

  it("read with a non-filterable filter lists the Filterable columns", async () => {
    const { readTool } = await import("../read");
    const result = await run((c, u) => readTool(c, u, { domain: "deen", entity: "prayer", filter: { logged_at: "x" } }));
    expect(textOf(result)).toMatch(/"logged_at" is not filterable.*Filterable: date, prayer_name, status/);
  });

  it("read with an invalid detail names the valid set", async () => {
    const { readTool } = await import("../read");
    const result = await run((c, u) => readTool(c, u, { domain: "deen", entity: "prayer", detail: "everything" as never }));
    expect(textOf(result)).toBe('Invalid detail "everything". Must be one of: ids, summary, full.');
  });

  it("read by an id that doesn't exist is a ToolNotFoundError the model can see", async () => {
    const { readTool } = await import("../read");
    const { ToolNotFoundError } = await import("../../tool-input-error");
    currentUserClient = makeUserClient({ single: null });
    await expect(readTool(currentUserClient, "user-1", { domain: "deen", entity: "prayer", id: "p-404" })).rejects.toBeInstanceOf(ToolNotFoundError);
    const result = await run((c, u) => readTool(c, u, { domain: "deen", entity: "prayer", id: "p-404" }));
    expect(textOf(result)).toBe('No prayer found with id "p-404".');
  });

  it("a DB/PostgREST error from read STAYS generic", async () => {
    const { readTool } = await import("../read");
    currentUserClient = makeUserClient({ error: { message: 'column prayer_logs.secret does not exist' } });
    const result = await run((c, u) => readTool(c, u, { domain: "deen", entity: "prayer" }));
    expect(textOf(result)).toBe(GENERIC);
  });
});

describe("write / list_capabilities — caller-input errors reach the model verbatim", () => {
  it("write with an unknown action lists the Available actions", async () => {
    const { writeTool } = await import("../write");
    const result = await run((c, u) => writeTool(c, u, { domain: "deen", entity: "prayer", action: "explode" }));
    expect(textOf(result)).toMatch(/Unknown action "explode" for deen\.prayer\. Available actions: .*log/);
  });

  it("write with an unknown writable entity lists the Writable entities", async () => {
    const { writeTool } = await import("../write");
    const result = await run((c, u) => writeTool(c, u, { domain: "deen", entity: "nope", action: "log" }));
    expect(textOf(result)).toMatch(/Unknown writable entity "nope" for domain "deen"\. Writable entities: /);
  });

  it("write to a domain with no writable entities says so", async () => {
    const { writeTool } = await import("../write");
    const result = await run((c, u) => writeTool(c, u, { domain: "nope", entity: "x", action: "y" }));
    expect(textOf(result)).toMatch(/No writable entities for domain "nope"/);
  });

  it("list_capabilities with an unknown domain lists the Known domains", async () => {
    const { listCapabilitiesTool } = await import("../list-capabilities");
    const result = await run(() => listCapabilitiesTool("nope"));
    expect(textOf(result)).toMatch(/Unknown domain "nope"\. Known domains: .*deen/);
  });
});

describe("widget_manage — validation errors reach the model verbatim", () => {
  it("an invalid widget kind names the valid kinds", async () => {
    const { widgetManageTool } = await import("../widget-manage");
    const result = await run((c, u) => widgetManageTool(c, u, { action: "create", patch: { kind: "pie", title: "t" } }));
    expect(textOf(result)).toBe('kind must be one of: metric_card, list, progress_against_goal, sparkline, streak. Got: "pie".');
  });

  it("an invalid display names the rule", async () => {
    const { widgetManageTool } = await import("../widget-manage");
    const result = await run((c, u) =>
      widgetManageTool(c, u, { action: "create", patch: { kind: "list", title: "t", data_source: { domain: "deen", entity: "prayer" }, display: { titleField: "nope" } } }),
    );
    expect(textOf(result)).toMatch(/display\.titleField "nope" is not a column.*Available: date, prayer_name/);
  });

  it("an unknown data_source entity names the Known entities", async () => {
    const { widgetManageTool } = await import("../widget-manage");
    const result = await run((c, u) => widgetManageTool(c, u, { action: "create", patch: { kind: "list", title: "t", data_source: { domain: "deen", entity: "nope" } } }));
    expect(textOf(result)).toMatch(/Unknown entity "nope" for domain "deen" in data_source\. Known entities: /);
  });

  it("update without an id asks for the top-level id", async () => {
    const { widgetManageTool } = await import("../widget-manage");
    const result = await run((c, u) => widgetManageTool(c, u, { action: "update", patch: { title: "x" } }));
    expect(textOf(result)).toBe("This action requires the top-level `id` of the widget.");
  });

  it("a widget id that doesn't exist is a visible not-found", async () => {
    const { widgetManageTool } = await import("../widget-manage");
    currentUserClient = makeUserClient({ single: null });
    const result = await run((c, u) => widgetManageTool(c, u, { action: "delete", id: "w-404" }));
    expect(textOf(result)).toBe('No widget with id "w-404".');
  });

  it("re-validating a STORED (DB-read) data_source stays generic — its message would echo database values", async () => {
    const { widgetManageTool } = await import("../widget-manage");
    currentUserClient = makeUserClient({
      single: { id: "w1", kind: "list", title: "t", data_source: { domain: "stored_secret_domain", entity: "x" }, display: { titleField: "date" }, slot: "home", position: 0, status: "active", updated_at: null },
    });
    const result = await run((c, u) => widgetManageTool(c, u, { action: "update", id: "w1", patch: { display: { titleField: "date" } } }));
    expect(textOf(result)).toBe(GENERIC);
  });

  it("a STORED (DB-read) widget kind that fails validation stays generic", async () => {
    const { widgetManageTool } = await import("../widget-manage");
    currentUserClient = makeUserClient({
      single: { id: "w1", kind: "stored_secret_kind", title: "t", data_source: { domain: "deen", entity: "prayer" }, display: {}, slot: "home", position: 0, status: "active", updated_at: null },
    });
    const result = await run((c, u) => widgetManageTool(c, u, { action: "delete", id: "w1" }));
    expect(textOf(result)).toBe(GENERIC);
  });
});

describe("scheduler_manage — schedule validation errors reach the model verbatim", () => {
  it("an invalid cron expression names the accepted shapes and echoes the caller's value", async () => {
    const { schedulerManageTool } = await import("../scheduler-manage");
    const result = await run((c, u) =>
      schedulerManageTool(c, u, "tok-1", { action: "create", patch: { tool_name: "write", domain: "settings", entity: "profile", action: "update", cron_expression: "every day" } }),
    );
    expect(textOf(result)).toMatch(/patch\.cron_expression must be "MM HH \* \* \*".*Got: "every day"/);
  });

  it("a past run_at is refused visibly", async () => {
    const { schedulerManageTool } = await import("../scheduler-manage");
    // Use any idempotent action so the run_at check (not the idempotency gate) is what fires.
    const { WRITE_REGISTRY } = await import("../../write-registry");
    let target: { domain: string; entity: string; action: string } | null = null;
    for (const domainDef of Object.values(WRITE_REGISTRY)) {
      for (const entityDef of Object.values(domainDef.entities)) {
        for (const actionDef of Object.values(entityDef.actions)) {
          if (!target && actionDef.idempotent === true) target = { domain: domainDef.domain, entity: entityDef.entity, action: actionDef.action };
        }
      }
    }
    expect(target).not.toBeNull();
    const result = await run((c, u) => schedulerManageTool(c, u, "tok-1", { action: "create", patch: { tool_name: "write", ...target!, run_at: "2001-01-01T00:00:00Z" } }));
    expect(textOf(result)).toBe("patch.run_at must be in the future.");
  });

  it("an unknown scheduled write action points at list_capabilities", async () => {
    const { schedulerManageTool } = await import("../scheduler-manage");
    const result = await run((c, u) => schedulerManageTool(c, u, "tok-1", { action: "create", patch: { tool_name: "write", domain: "deen", entity: "prayer", action: "explode", cron_expression: "00 07 * * *" } }));
    expect(textOf(result)).toMatch(/Unknown write action "deen\.prayer\.explode"/);
  });

  it("a bad tool_name echoes the caller's value", async () => {
    const { schedulerManageTool } = await import("../scheduler-manage");
    const result = await run((c, u) => schedulerManageTool(c, u, "tok-1", { action: "create", patch: { tool_name: "read" } }));
    expect(textOf(result)).toBe('patch.tool_name must be "write" or "notify". Got: "read".');
  });

  it("cancel without an id asks for the top-level id", async () => {
    const { schedulerManageTool } = await import("../scheduler-manage");
    const result = await run((c, u) => schedulerManageTool(c, u, "tok-1", { action: "cancel" }));
    expect(textOf(result)).toBe("This action requires the top-level `id` of the scheduled action.");
  });

  it("cancelling an id that doesn't exist is a visible not-found", async () => {
    const { schedulerManageTool } = await import("../scheduler-manage");
    currentUserClient = makeUserClient({ single: null });
    const result = await run((c, u) => schedulerManageTool(c, u, "tok-1", { action: "cancel", id: "s-404" }));
    expect(textOf(result)).toBe('No scheduled action found with id "s-404".');
  });

  it("a missing token id (an internal invariant, not caller input) stays generic", async () => {
    const { schedulerManageTool } = await import("../scheduler-manage");
    const result = await run((c, u) => schedulerManageTool(c, u, null, { action: "create", patch: { tool_name: "write" } }));
    expect(textOf(result)).toBe(GENERIC);
  });
});
