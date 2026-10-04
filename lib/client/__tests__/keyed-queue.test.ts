import { describe, expect, it } from "vitest";
import { enqueueByKey } from "../keyed-queue";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("enqueueByKey", () => {
  it("runs same-key tasks strictly in call order, even if an earlier one is slower", async () => {
    const order: string[] = [];
    const slow = deferred();
    const a = enqueueByKey("k", async () => {
      await slow.promise;
      order.push("a");
    });
    const b = enqueueByKey("k", async () => {
      order.push("b");
    });
    await Promise.resolve();
    expect(order).toEqual([]); // b is waiting for a
    slow.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });

  it("different keys do not wait on each other", async () => {
    const order: string[] = [];
    const slow = deferred();
    const a = enqueueByKey("k1", async () => {
      await slow.promise;
      order.push("slow");
    });
    await enqueueByKey("k2", async () => {
      order.push("fast");
    });
    expect(order).toEqual(["fast"]);
    slow.resolve();
    await a;
  });

  it("a failed task rejects its own caller but does not block the next task for the key", async () => {
    const first = enqueueByKey("k", async () => {
      throw new Error("boom");
    });
    const second = enqueueByKey("k", async () => "ok");
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });
});
