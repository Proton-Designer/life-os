import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthedUser = vi.fn();
const createShare = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth", () => ({ getAuthedUser: () => getAuthedUser() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/reader/server/share", async (orig) => ({ ...(await orig<typeof import("@/lib/reader/server/share")>()), createShareImportCore: (...a: unknown[]) => createShare(...a) }));

import { NextRequest } from "next/server";
import { POST } from "../route";

function req(form: FormData, headers: Record<string, string> = {}) {
  return new NextRequest("https://app.test/api/reader/share", { method: "POST", body: form, headers });
}
function formOf(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const loc = (r: Response) => new URL(r.headers.get("location")!);

beforeEach(() => {
  getAuthedUser.mockReset();
  createShare.mockReset();
});

describe("POST /api/reader/share", () => {
  it("creates the import and redirects to the preview", async () => {
    getAuthedUser.mockResolvedValue({ id: "u1" });
    createShare.mockResolvedValue({ ok: true, bookId: "book-1" });
    const r = await POST(req(formOf({ title: "T", text: "hello there", url: "" })));
    expect(r.status).toBe(303);
    expect(loc(r).pathname + loc(r).search).toBe("/read/import?pending=book-1");
    expect(createShare).toHaveBeenCalledWith({}, "u1", expect.objectContaining({ title: "T", text: "hello there", file: null }));
  });
  it("a failed import redirects with a readable error, not JSON", async () => {
    getAuthedUser.mockResolvedValue({ id: "u1" });
    createShare.mockResolvedValue({ ok: false, message: "No text here." });
    const r = await POST(req(formOf({ text: "x" })));
    expect(r.status).toBe(303);
    expect(loc(r).searchParams.get("error")).toBe("No text here.");
  });
  it("signed-out goes to login with the import page as next, and creates nothing", async () => {
    getAuthedUser.mockResolvedValue(null);
    const r = await POST(req(formOf({ text: "x" })));
    expect(loc(r).pathname).toBe("/login");
    expect(loc(r).searchParams.get("next")).toBe("/read/import");
    expect(createShare).not.toHaveBeenCalled();
  });
  it("refuses a cross-site post (positive control: same origin passes)", async () => {
    getAuthedUser.mockResolvedValue({ id: "u1" });
    createShare.mockResolvedValue({ ok: true, bookId: "b" });
    const evil = await POST(req(formOf({ text: "x" }), { origin: "https://evil.test" }));
    expect(evil.status).toBe(403);
    expect(createShare).not.toHaveBeenCalled();
    const ok = await POST(req(formOf({ text: "x" }), { origin: "https://app.test" }));
    expect(ok.status).toBe(303);
  });
  it("rejects an oversized declared body without parsing it", async () => {
    getAuthedUser.mockResolvedValue({ id: "u1" });
    const r = await POST(req(formOf({ text: "x" }), { "content-length": String(10 * 1024 * 1024) }));
    expect(loc(r).searchParams.get("error")).toMatch(/too large/);
    expect(createShare).not.toHaveBeenCalled();
  });
});
