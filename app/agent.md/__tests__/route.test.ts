import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("GET /agent.md", () => {
  it("200s markdown, unauthenticated, built from the request's own origin", async () => {
    const response = await GET(new Request("https://lifeos.example.com/agent.md"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    const body = await response.text();
    expect(body).toContain("https://lifeos.example.com/api/mcp");
    expect(body).toContain("https://lifeos.example.com/api/v1");
  });
});
