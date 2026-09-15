import { describe, expect, it } from "vitest";
import { findTokenInQuery, parseRestRoute, RESERVED_TOP_SEGMENTS } from "../parse-path";
import { REGISTRY } from "@/lib/mcp/registry";
import { WRITE_REGISTRY } from "@/lib/mcp/write-registry";

/**
 * P4-17: the REST path grammar is a pure function from (method, segments,
 * query, body) to the SAME {tool, args} an MCP client would send. Red first:
 * written before lib/agent-api/rest/parse-path.ts existed.
 */

const q = (s = "") => new URLSearchParams(s);
const parse = (method: "GET" | "POST", path: string, query = "", body?: unknown) =>
  parseRestRoute({ method, segments: path.split("/").filter(Boolean), query: q(query), body });

describe("parseRestRoute — resources map onto MCP tool args", () => {
  it("GET root and GET me", () => {
    expect(parse("GET", "")).toEqual({ ok: true, route: { kind: "root" } });
    expect(parse("GET", "me")).toEqual({ ok: true, route: { kind: "me" } });
  });

  it("GET capabilities with and without ?domain=", () => {
    expect(parse("GET", "capabilities")).toEqual({ ok: true, route: { kind: "tool", tool: "list_capabilities", args: {} } });
    expect(parse("GET", "capabilities", "domain=deen")).toEqual({ ok: true, route: { kind: "tool", tool: "list_capabilities", args: { domain: "deen" } } });
  });

  it("GET {domain}/{entity} is a read list with detail, fields, cursor and filter[col]", () => {
    expect(parse("GET", "deen/prayer", "detail=full&fields=date,%20status&cursor=MjA&filter[date]=2026-09-08&filter[status]=on_time")).toEqual({
      ok: true,
      route: {
        kind: "tool",
        tool: "read",
        args: { domain: "deen", entity: "prayer", detail: "full", fields: ["date", "status"], cursor: "MjA", filter: { date: "2026-09-08", status: "on_time" } },
      },
    });
    expect(parse("GET", "deen/prayer")).toEqual({ ok: true, route: { kind: "tool", tool: "read", args: { domain: "deen", entity: "prayer" } } });
  });

  it("GET list reads take limit (as a number) and filter[col][gte|lte] ranges (P4-04 read args)", () => {
    expect(parse("GET", "deen/prayer", "limit=5&filter[date][gte]=2026-09-01&filter[date][lte]=2026-09-07")).toEqual({
      ok: true,
      route: { kind: "tool", tool: "read", args: { domain: "deen", entity: "prayer", limit: 5, filter: { date: { gte: "2026-09-01", lte: "2026-09-07" } } } },
    });
    // A non-integer limit is passed through as text so the shared zod schema rejects it with its own message.
    expect(parse("GET", "deen/prayer", "limit=lots")).toMatchObject({ ok: true, route: { args: { limit: "lots" } } });
    // Unknown bound names reach the schema too (its .strict() rejects them), rather than being dropped here.
    expect(parse("GET", "deen/prayer", "filter[date][gt]=x")).toMatchObject({ ok: true, route: { args: { filter: { date: { gt: "x" } } } } });
    // Equality and a range on the same column is ambiguous.
    expect(parse("GET", "deen/prayer", "filter[date]=a&filter[date][gte]=b")).toMatchObject({ ok: false, code: "invalid_input" });
    expect(parse("GET", "deen/prayer/p1", "limit=5")).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("GET {domain}/{entity}/{id} is a read by id (no cursor/filter allowed)", () => {
    expect(parse("GET", "deen/prayer/p1", "fields=date")).toEqual({ ok: true, route: { kind: "tool", tool: "read", args: { domain: "deen", entity: "prayer", id: "p1", fields: ["date"] } } });
    const bad = parse("GET", "deen/prayer/p1", "cursor=abc");
    expect(bad).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("POST {domain}/{entity}/{action} is a write, body {id?, patch?}", () => {
    expect(parse("POST", "deen/prayer/log", "", { patch: { prayer_name: "fajr" } })).toEqual({
      ok: true,
      route: { kind: "tool", tool: "write", args: { domain: "deen", entity: "prayer", action: "log", patch: { prayer_name: "fajr" } } },
    });
    expect(parse("POST", "work/task/complete", "", { id: "t1" })).toEqual({
      ok: true,
      route: { kind: "tool", tool: "write", args: { domain: "work", entity: "task", action: "complete", id: "t1" } },
    });
    expect(parse("POST", "work/task/complete", "", undefined)).toEqual({
      ok: true,
      route: { kind: "tool", tool: "write", args: { domain: "work", entity: "task", action: "complete" } },
    });
  });

  it("a write body with patch fields at the top level is refused with a hint, not silently dropped", () => {
    const r = parse("POST", "deen/prayer/log", "", { prayer_name: "fajr" });
    expect(r).toMatchObject({ ok: false, code: "invalid_input" });
    if (!r.ok) expect(r.message).toMatch(/prayer_name.*patch/);
  });

  it("manage/widgets and manage/schedules map onto widget_manage / scheduler_manage", () => {
    expect(parse("GET", "manage/widgets")).toEqual({ ok: true, route: { kind: "tool", tool: "widget_manage", args: { action: "list" } } });
    expect(parse("POST", "manage/widgets", "", { patch: { kind: "list" } })).toEqual({ ok: true, route: { kind: "tool", tool: "widget_manage", args: { action: "create", patch: { kind: "list" } } } });
    expect(parse("POST", "manage/widgets/w1/update", "", { patch: { title: "x" } })).toEqual({ ok: true, route: { kind: "tool", tool: "widget_manage", args: { action: "update", id: "w1", patch: { title: "x" } } } });
    expect(parse("POST", "manage/widgets/w1/delete")).toEqual({ ok: true, route: { kind: "tool", tool: "widget_manage", args: { action: "delete", id: "w1" } } });
    expect(parse("GET", "manage/schedules")).toEqual({ ok: true, route: { kind: "tool", tool: "scheduler_manage", args: { action: "list" } } });
    expect(parse("POST", "manage/schedules/s1/pause")).toEqual({ ok: true, route: { kind: "tool", tool: "scheduler_manage", args: { action: "pause", id: "s1" } } });
    expect(parse("POST", "manage/schedules/s1/delete")).toMatchObject({ ok: false, code: "route_not_found" });
  });

  it("POST actions {tool, args} passes MCP args through verbatim", () => {
    expect(parse("POST", "actions", "", { tool: "read", args: { domain: "deen", entity: "prayer" } })).toEqual({
      ok: true,
      route: { kind: "tool", tool: "read", args: { domain: "deen", entity: "prayer" } },
    });
    expect(parse("POST", "actions", "", { tool: "list_capabilities" })).toEqual({ ok: true, route: { kind: "tool", tool: "list_capabilities", args: {} } });
    const unknown = parse("POST", "actions", "", { tool: "drop_tables", args: {} });
    expect(unknown).toMatchObject({ ok: false, code: "invalid_input" });
    if (!unknown.ok) expect(unknown.message).toContain("list_capabilities, read, write, widget_manage, scheduler_manage");
  });
});

describe("parseRestRoute — refusals", () => {
  it("wrong method → method_not_allowed with the allowed method named", () => {
    expect(parse("POST", "me")).toMatchObject({ ok: false, code: "method_not_allowed", allow: "GET" });
    expect(parse("GET", "actions")).toMatchObject({ ok: false, code: "method_not_allowed", allow: "POST" });
    expect(parse("POST", "deen/prayer")).toMatchObject({ ok: false, code: "method_not_allowed", allow: "GET" });
    expect(parse("POST", "")).toMatchObject({ ok: false, code: "method_not_allowed", allow: "GET" });
  });

  it("too-short or too-long paths → route_not_found", () => {
    expect(parse("GET", "deen")).toMatchObject({ ok: false, code: "route_not_found" });
    expect(parse("GET", "deen/prayer/p1/extra")).toMatchObject({ ok: false, code: "route_not_found" });
    expect(parse("GET", "manage")).toMatchObject({ ok: false, code: "route_not_found" });
  });

  it("an unknown query parameter is refused, naming the allowed ones", () => {
    const r = parse("GET", "deen/prayer", "page_size=500");
    expect(r).toMatchObject({ ok: false, code: "invalid_input" });
    if (!r.ok) expect(r.message).toMatch(/page_size.*detail, fields, cursor, limit, filter\[/);
    expect(parse("POST", "deen/prayer/log", "x=1", {})).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("a non-object JSON body is refused", () => {
    expect(parse("POST", "deen/prayer/log", "", [1, 2])).toMatchObject({ ok: false, code: "invalid_input" });
    expect(parse("POST", "actions", "", "read")).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("a duplicated filter column is refused rather than silently taking one", () => {
    expect(parse("GET", "deen/prayer", "filter[date]=a&filter[date]=b")).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

describe("findTokenInQuery — a credential in the URL is never accepted", () => {
  it("flags token-named params and any lifeos_pat_ value", () => {
    expect(findTokenInQuery(q("access_token=abc"))).toBe("access_token");
    expect(findTokenInQuery(q("token=abc"))).toBe("token");
    expect(findTokenInQuery(q("api_key=abc"))).toBe("api_key");
    expect(findTokenInQuery(q("filter[title]=lifeos_pat_xyz"))).toBe("filter[title]");
    expect(findTokenInQuery(q("detail=full&cursor=abc"))).toBeNull();
  });
});

describe("reserved top-level segments never shadow a registry domain", () => {
  it("no REGISTRY / WRITE_REGISTRY domain is named like a reserved REST segment", () => {
    const domains = new Set([...Object.keys(REGISTRY), ...Object.keys(WRITE_REGISTRY)]);
    for (const reserved of RESERVED_TOP_SEGMENTS) expect(domains.has(reserved)).toBe(false);
    expect(RESERVED_TOP_SEGMENTS).toEqual(expect.arrayContaining(["me", "capabilities", "actions", "manage"]));
  });
});
