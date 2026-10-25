import { describe, it, expect, vi } from "vitest";
import { MAX_HOPS, chainingEnabled, kickNextHop, parseHop } from "../step-chain";

const client = (result: { data: unknown; error: { message: string } | null } | Error) => ({
  rpc: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});

describe("step-chain", () => {
  it("parseHop: missing or malformed is 0, positive integers are kept, anything above the cap is clamped", () => {
    expect(parseHop(null)).toBe(0);
    expect(parseHop("")).toBe(0);
    expect(parseHop("abc")).toBe(0);
    expect(parseHop("-3")).toBe(0);
    expect(parseHop("2.5")).toBe(0);
    expect(parseHop("7")).toBe(7);
    expect(parseHop("500")).toBe(MAX_HOPS);
  });

  it("chainingEnabled is on unless INGESTION_SELF_CHAIN is exactly 'off'", () => {
    expect(chainingEnabled({})).toBe(true);
    expect(chainingEnabled({ INGESTION_SELF_CHAIN: "on" })).toBe(true);
    expect(chainingEnabled({ INGESTION_SELF_CHAIN: "off" })).toBe(false);
  });

  it("kickNextHop asks for hop+1 and reports whether a kick was sent", async () => {
    const c = client({ data: true, error: null });
    expect(await kickNextHop(c as never, 3, { env: {} })).toBe(true);
    expect(c.rpc).toHaveBeenCalledWith("kick_ingestion_driver", { p_hop: 4 });
  });

  it("does not call the DB at the cap or with the kill switch on", async () => {
    const c = client({ data: true, error: null });
    const log = vi.fn();
    expect(await kickNextHop(c as never, MAX_HOPS, { env: {}, log })).toBe(false);
    expect(await kickNextHop(c as never, 1, { env: { INGESTION_SELF_CHAIN: "off" }, log })).toBe(false);
    expect(c.rpc).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1); // only the cap is worth a log line
  });

  it("an RPC error or a thrown error is logged and swallowed, never thrown", async () => {
    const log = vi.fn();
    expect(await kickNextHop(client({ data: null, error: { message: "boom" } }) as never, 0, { env: {}, log })).toBe(false);
    expect(await kickNextHop(client(new Error("network")) as never, 0, { env: {}, log })).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("a false answer from the DB (rate guard) is not an error and not a log line", async () => {
    const log = vi.fn();
    expect(await kickNextHop(client({ data: false, error: null }) as never, 0, { env: {}, log })).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });
});
