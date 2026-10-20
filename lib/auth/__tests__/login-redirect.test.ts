import { describe, expect, it } from "vitest";
import { loginRedirectFor } from "../login-redirect";
import { safeNextPath } from "../safe-next";

describe("loginRedirectFor", () => {
  it("a signed-out share returns to the same url, query intact, after login", () => {
    const search = "?title=A%20post&text=hello%20world&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1";
    const to = loginRedirectFor("/read/import", search);
    const next = new URL(to, "https://x.test").searchParams.get("next");
    expect(next).toBe(`/read/import${search}`);
    expect(safeNextPath(next)).toBe(next);
  });
  it("every other page still goes to plain /login (positive control: the carve-out is narrow)", () => {
    for (const p of ["/", "/settings", "/personal/self_mastery", "/read/import-evil", "/read/abc"]) expect(loginRedirectFor(p, "?a=1"), p).toBe("/login");
  });
  it("an unsafe return path falls back to /login", () => {
    expect(loginRedirectFor("/read/import", "?x=\\evil")).toBe("/login");
    expect(loginRedirectFor("/read/import", `?x=${"a".repeat(3000)}`)).toBe("/login");
  });
});
