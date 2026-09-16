import { describe, expect, it, vi, beforeEach } from "vitest";

const readFile = vi.fn();
vi.mock("node:fs/promises", () => ({ default: { readFile: (...args: unknown[]) => readFile(...args) }, readFile: (...args: unknown[]) => readFile(...args) }));

import { GET } from "../route";

beforeEach(() => {
  readFile.mockReset();
});

describe("GET /agent-recipes/canvas-scheduled-import", () => {
  it("serves the real doc file's content, unauthenticated", async () => {
    readFile.mockResolvedValueOnce("# Recipe: scheduled Canvas import\n\nbody");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toBe("# Recipe: scheduled Canvas import\n\nbody");
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining("canvas-scheduled-import.md"), "utf-8");
  });

  it("500s cleanly rather than crashing when the file can't be read", async () => {
    readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/markdown");
  });
});
