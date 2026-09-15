import { describe, expect, it } from "vitest";
import { safeNextPath } from "../safe-next";

describe("safeNextPath — only same-origin relative paths survive (open-redirect guard)", () => {
  it.each([
    "/",
    "/api/mcp/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=x",
    "/settings",
    "/school?tab=1#top",
  ])("accepts %s", (value) => {
    expect(safeNextPath(value)).toBe(value);
  });

  it.each([
    null,
    undefined,
    "",
    "settings",
    "//evil.example.com",
    "//evil.example.com/path",
    "/\\evil.example.com",
    "\\\\evil.example.com",
    "https://evil.example.com",
    "javascript:alert(1)",
    "/%0d%0aLocation:%20https://evil.example.com",
    "/ok\nLocation: https://evil",
    " /settings",
  ])("rejects %s", (value) => {
    expect(safeNextPath(value as string | null | undefined)).toBeNull();
  });
});
