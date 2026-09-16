import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("GET /llms.txt", () => {
  it("200s the SAME generic doc /agent.md serves, unauthenticated", async () => {
    const response = await GET(new Request("https://lifeos.example.com/llms.txt"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    const body = await response.text();
    expect(body).toContain("https://lifeos.example.com/api/mcp");
  });
});
