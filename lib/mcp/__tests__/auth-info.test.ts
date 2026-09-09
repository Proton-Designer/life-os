import { describe, expect, it } from "vitest";
import { readMcpAuth } from "../auth-info";

describe("readMcpAuth", () => {
  it("extracts userId/tokenId/scopes from a well-formed AuthInfo", () => {
    const result = readMcpAuth({ scopes: ["read", "write"], extra: { userId: "u1", tokenId: "t1" } });
    expect(result).toEqual({ userId: "u1", tokenId: "t1", scopes: ["read", "write"] });
  });

  it("returns null when authInfo is undefined", () => {
    expect(readMcpAuth(undefined)).toBeNull();
  });

  it("returns null when extra is missing", () => {
    expect(readMcpAuth({ scopes: ["read"] })).toBeNull();
  });

  it("returns null when extra is missing userId or tokenId", () => {
    expect(readMcpAuth({ scopes: ["read"], extra: { userId: "u1" } })).toBeNull();
    expect(readMcpAuth({ scopes: ["read"], extra: { tokenId: "t1" } })).toBeNull();
  });

  it("filters out any scope that isn't a real McpScope, defensively", () => {
    const result = readMcpAuth({ scopes: ["read", "admin", "write"], extra: { userId: "u1", tokenId: "t1" } });
    expect(result?.scopes).toEqual(["read", "write"]);
  });
});
