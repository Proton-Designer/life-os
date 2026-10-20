import { describe, it, expect, vi } from "vitest";

const prepare = vi.fn();
vi.mock("../core", () => ({ prepareReaderDocCore: (...a: unknown[]) => prepare(...a) }));
import { buildReaderDocBeforeGc } from "../best-effort";

const quiet = () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
};

describe("buildReaderDocBeforeGc", () => {
  it("resolves (never rejects) when the build throws", async () => {
    quiet();
    prepare.mockRejectedValue(new Error("boom"));
    await expect(buildReaderDocBeforeGc({} as never, "u", "b")).resolves.toBeUndefined();
  });
  it("resolves when the build returns a failure value", async () => {
    quiet();
    prepare.mockResolvedValue({ ok: false, message: "scanned" });
    await expect(buildReaderDocBeforeGc({} as never, "u", "b")).resolves.toBeUndefined();
  });
  it("gives up after the time budget instead of stalling ingestion", async () => {
    quiet();
    prepare.mockReturnValue(new Promise(() => {})); // never settles
    const t0 = Date.now();
    await buildReaderDocBeforeGc({} as never, "u", "b", 30);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
