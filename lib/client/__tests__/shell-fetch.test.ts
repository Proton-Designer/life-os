// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shellFetch } from "../shell-fetch";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

afterEach(() => vi.unstubAllGlobals());

describe("shellFetch", () => {
  it("is a plain no-store GET fetch (outside the Server Action queue)", async () => {
    const f = vi.fn(async () => json([1]));
    vi.stubGlobal("fetch", f);
    expect(await shellFetch<number[]>("/api/shell/x")).toEqual([1]);
    expect(f).toHaveBeenCalledWith("/api/shell/x", expect.objectContaining({ method: "GET", cache: "no-store", credentials: "same-origin" }));
  });

  it("throws on a non-2xx answer", async () => {
    vi.stubGlobal("fetch", async () => json({ error: "x" }, { status: 401 }));
    await expect(shellFetch("/api/shell/x")).rejects.toThrow(/401/);
  });

  it("throws on a non-JSON answer (an expired session can bounce to an HTML login page)", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(shellFetch("/api/shell/x")).rejects.toThrow(/not JSON/);
  });

  it("the module imports no Server Action and is not a 'use server' file (that is the whole point)", () => {
    const src = readFileSync("lib/client/shell-fetch.ts", "utf8");
    expect(src).not.toMatch(/["']use server["']/);
    expect(src).not.toMatch(/from ["']@\/app\//);
  });
});
